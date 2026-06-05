import { Buffer } from "node:buffer";
import type { Duplex } from "node:stream";
import type { AppState, Session, SessionEndReason } from "@parasor/shared";
import { ConnectionLifecycle } from "./connection-lifecycle.js";
import { raceHandshakeWithTimeout } from "./handshake-timeout-race.js";
import { HeadlessTerminalStateCache } from "./headless-terminal-state-cache.js";
import { validateHelloAck } from "./hello-ack-validator.js";
import type {
  AttachClientCapabilities,
  AttachClientResponse,
  AttachClientResult,
  AttachClientSink,
  CreateSessionInput,
  PtyHost,
} from "./host.js";
import {
  decodeGenerationStreamPayload,
  decodeStreamPayload,
  encodeFrame,
  encodeGenerationStreamPayload,
  type Frame,
  FrameError,
  FrameParser,
  FrameType,
} from "./host-protocol/frames.js";
import {
  type CreateAckPayload,
  type CreateReqPayload,
  type DetachClientPayload,
  type DisposeReqPayload,
  decodeJsonPayload,
  encodeJsonPayload,
  type FlowControlPayload,
  type HelloPayload,
  type InitClientAckPayload,
  type InitClientReqPayload,
  type NackCode,
  type NackPayload,
  type PersistProjectDomainsReqPayload,
  PROTOCOL_VERSION,
  type RefreshPayload,
  type ResizePayload,
  type RestartAckPayload,
  type RestartReqPayload,
  type SessionExitPayload,
  type SessionListPayload,
  type SessionUpdatePayload,
  type SetPinnedPayload,
  type SetPtyEnvPayload,
  type SetTitlePayload,
} from "./host-protocol/messages.js";
import { RequestCorrelator } from "./request-correlator.js";
import type { ScrollbackLog } from "./scrollback-log.js";
import { stripQueryEscapes } from "./scrollback-sanitize.js";
import { SessionMirror } from "./session-mirror.js";

const DEFAULT_DAEMON_LEGACY_REPLAY_MAX_BYTES = 256 * 1024;
const DEFAULT_HEADLESS_REPLAY_SCROLLBACK_LINES = 10_000;
const DEFAULT_HEADLESS_REPLAY_MAX_BYTES =
  DEFAULT_DAEMON_LEGACY_REPLAY_MAX_BYTES;
const DEFAULT_HEADLESS_STATE_MAX_SESSIONS = 8;
const DEFAULT_HEADLESS_STATE_TTL_MS = 10 * 60_000;

function readPositiveIntegerEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function readBooleanEnv(name: string): boolean | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on")
    return true;
  if (value === "0" || value === "false" || value === "no" || value === "off")
    return false;
  return null;
}

function readHeadlessReplayEnabled(): boolean {
  return (
    readBooleanEnv("PARASOR_HEADLESS_REPLAY") ??
    readBooleanEnv("PARASOR_EXPERIMENT_HEADLESS_REPLAY") ??
    true
  );
}

function utf8Tail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  const slice = buf.subarray(buf.length - maxBytes);
  let start = 0;
  while (start < slice.length && start < 3 && (slice[start] & 0xc0) === 0x80) {
    start++;
  }
  return slice.subarray(start).toString("utf8");
}

/*
 * RemotePtyHost -- server-side IPC frontend that talks to PtyHostDaemon
 * over a Unix-domain socket (tests: any `Duplex`). Implements `PtyHost`
 * by translating each method into the wire frames defined in  and
 * keeping a local mirror of session state for the sync read accessors
 * (`list` / `get` / `listByProject`) per the  consistency contract.
 *
 * Design choices:
 *  - Composition, not inheritance -- RemotePtyHost is a peer of
 *    `InProcessPtyHost`, not a subclass. Daemon-side composes over
 *    InProcessPtyHost; server-side composes over the wire.
 *  - Request/ACK pairs use a monotonic `requestId` plus a `pending`
 *    map; the daemon mirrors the requestId in its ACK or NACK so we
 *    can resolve/reject the right caller.
 *  - Fire-and-forget mutators (write/resize/setTitle/setPinned/...)
 *    update the mirror optimistically. The mirror may lag the daemon for a
 *    tick; SESSION_UPDATE broadcasts reconcile any divergence.
 *  - Per-session, per-clientId listener map for DATA fan-out. The
 *    daemon broadcasts ONE DATA frame per session output; the server
 *    demuxes to the WebSocket clients that opened each session.
 *  - Scrollback delivery on first INIT_CLIENT is intentionally NOT handled
 *    here; the daemon owns persisted session state and chunked log access.
 */

export type RemotePtyHostErrorCode =
  | NackCode
  | "ipc-timeout"
  | "connection-dropped"
  | "reconnecting"
  | "handshake-timeout";

export class RemotePtyHostError extends Error {
  constructor(
    public readonly code: RemotePtyHostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RemotePtyHostError";
  }
}

export interface RemotePtyHostDeps {
  socket: Duplex;
  /** PID stamped into HELLO so daemon logs / `parasor pty-host status` can attribute. */
  serverPid?: number;
  /** Per-request timeout. Defaults to 30s -- write/resize are fire-and-forget so this only
   *  bites Promise<X>-returning methods (create/restart/dispose/...). */
  requestTimeoutMs?: number;
  /**
   * Cap how long `connect()` waits for HELLO_ACK + initial SESSION_LIST.
   * Defaults to 10s. Without this, a daemon that accept()s the socket
   * but never replies pins server boot forever (codex round 2 HIGH).
   */
  handshakeTimeoutMs?: number;
  /**
   * Per-session disk-backed scrollback log. When supplied, every DATA
   * frame from the daemon is appended so a re-attaching xterm (terminal
   * re-mount on tab switch, server restart while daemon survives) gets
   * its viewport rehydrated via `replay:"full"`. Without it, the WS
   * client receives a blank terminal until fresh output arrives -- that
   * was the user-visible regression behind the daemon-mode fix.
   */
  scrollbackLog?: ScrollbackLog | null;
  /**
   * Daemon mode currently falls back to legacy JSON `replay:"full"`.
   * Bound that payload separately from ScrollbackLog's on-disk tail so
   * persisted scrollback can stay large without forcing every attach to
   * transfer and render multi-megabyte snapshots.
   */
  daemonLegacyReplayMaxBytes?: number;
}

interface AttachedClient {
  listener: (data: string) => void;
  /**
   * Attach fencing fence -- server-side monotonic stamp. Echoed in
   * `INIT_CLIENT_REQ` so the daemon can stamp the same value on its
   * own attachedClients entry, then re-sent in `DETACH_CLIENT` so a
   * stale onClose firing after a fresh same-`clientId` reattach
   * cannot evict the new listener on either side of the IPC.
   */
  attachToken: number;
}

const ACK_FRAME_TYPES: ReadonlySet<number> = new Set<number>([
  FrameType.CREATE_ACK,
  FrameType.RESTART_ACK,
  FrameType.DISPOSE_ACK,
  FrameType.DISPOSE_ALL_ACK,
  FrameType.SHUTDOWN_ALL_ACK,
  FrameType.INIT_CLIENT_ACK,
  FrameType.PERSIST_PROJECT_DOMAINS_ACK,
]);

export class RemotePtyHost implements PtyHost {
  private readonly socket: Duplex;
  private readonly parser = new FrameParser();
  private readonly requestTimeoutMs: number;
  private readonly scrollbackLog: ScrollbackLog | null;
  private readonly daemonLegacyReplayMaxBytes: number;
  private readonly headlessReplayEnabled: boolean;
  private readonly headlessReplayScrollbackLines: number;
  private readonly headlessReplayMaxBytes: number;
  private readonly headlessStateCache: HeadlessTerminalStateCache | null;
  /**
   * owns the `connecting ->
   * snapshot-pending -> ready / dropped` transitions, the connectionId +
   * generation stamped at HELLO_ACK time, and the deferred handshake
   * Promise. Socket-agnostic by construction; this host drives transitions
   * and reads the stamped headers when emitting frames.
   * See {@link ConnectionLifecycle}.
   */
  private readonly lifecycle = new ConnectionLifecycle();
  /**
   * Request/response correlation: monotonic requestId, the pending-id Map,
   * per-request timeout scheduling, and ACK/NACK/drop dispatch. Socket-
   * agnostic by construction; state-machine guards and wire encoding live
   * on this host. See {@link RequestCorrelator}.
   */
  private readonly correlator: RequestCorrelator;
  /**
   * Local view-state of daemon-owned sessions plus the PTY generation gate per-session
   * generation latch. Pure, socket-free reconciliation lives in
   * {@link SessionMirror}; this shell only feeds it decoded frames.
   */
  private readonly mirror = new SessionMirror();
  private readonly attached = new Map<string, Map<string, AttachedClient>>();
  /** Attach fencing -- server-local monotonic counter for attach-token mintage. */
  private nextAttachToken = 1;
  /**
   * Session IDs we have ever appended scrollback for. Tracked separately
   * from `mirror` so disposeAll() can purge files even if the daemon's
   * SESSION_LIST snapshot lagged behind a DATA broadcast at shutdown
   * time. Cleared on `dispose(id)` / `disposeAll()`.
   */
  private readonly scrollbackOwnedIds = new Set<string>();
  private ptyEnv: Record<string, string> = {};
  private dataListeners: ((
    sessionId: string,
    data: string,
    generation: number,
  ) => void)[] = [];
  private inputListeners: ((sessionId: string, data: string) => void)[] = [];

  onSessionExit:
    | ((id: string, generation: number, reason: SessionEndReason) => void)
    | null = null;

  /**
   * Build + handshake in one step. Use this from production code; tests
   * may want to drive HELLO_ACK manually and can poke `_internal` instead.
   */
  static async connect(deps: RemotePtyHostDeps): Promise<RemotePtyHost> {
    const host = new RemotePtyHost(deps);
    /*
     * a daemon that accept()s the socket but
     * never sends HELLO_ACK / SESSION_LIST would hang server boot
     * indefinitely. Race the handshake against a deadline; on timeout
     * destroy the socket (which fires the `error` listener attached in
     * the constructor -> handleDrop -> rejectHandshake), then surface a
     * typed `handshake-timeout` error to the caller.
     */
    await raceHandshakeWithTimeout({
      awaiter: host.lifecycle.awaitReady,
      timeoutMs: deps.handshakeTimeoutMs ?? 10_000,
      onTimeout: () => deps.socket.destroy(),
      buildTimeoutError: (timeoutMs) =>
        new RemotePtyHostError(
          "handshake-timeout",
          `parasor-pty-host handshake did not complete within ${timeoutMs}ms`,
        ),
    });
    return host;
  }

  constructor(deps: RemotePtyHostDeps) {
    this.socket = deps.socket;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? 30_000;
    this.scrollbackLog = deps.scrollbackLog ?? null;
    const configuredDaemonLegacyReplayMaxBytes =
      deps.daemonLegacyReplayMaxBytes;
    this.daemonLegacyReplayMaxBytes =
      (typeof configuredDaemonLegacyReplayMaxBytes === "number" &&
      Number.isSafeInteger(configuredDaemonLegacyReplayMaxBytes) &&
      configuredDaemonLegacyReplayMaxBytes > 0
        ? configuredDaemonLegacyReplayMaxBytes
        : null) ??
      readPositiveIntegerEnv("PARASOR_DAEMON_LEGACY_REPLAY_MAX_BYTES") ??
      DEFAULT_DAEMON_LEGACY_REPLAY_MAX_BYTES;
    this.headlessReplayEnabled = readHeadlessReplayEnabled();
    this.headlessReplayScrollbackLines =
      readPositiveIntegerEnv("PARASOR_HEADLESS_REPLAY_SCROLLBACK_LINES") ??
      DEFAULT_HEADLESS_REPLAY_SCROLLBACK_LINES;
    this.headlessReplayMaxBytes =
      readPositiveIntegerEnv("PARASOR_HEADLESS_REPLAY_MAX_BYTES") ??
      DEFAULT_HEADLESS_REPLAY_MAX_BYTES;
    this.headlessStateCache = this.headlessReplayEnabled
      ? new HeadlessTerminalStateCache({
          cols: 80,
          rows: 24,
          scrollbackLines: this.headlessReplayScrollbackLines,
          maxBytes: this.headlessReplayMaxBytes,
          maxSessions:
            readPositiveIntegerEnv("PARASOR_HEADLESS_STATE_MAX_SESSIONS") ??
            DEFAULT_HEADLESS_STATE_MAX_SESSIONS,
          ttlMs:
            readPositiveIntegerEnv("PARASOR_HEADLESS_STATE_TTL_MS") ??
            DEFAULT_HEADLESS_STATE_TTL_MS,
        })
      : null;
    this.correlator = new RequestCorrelator({
      timeoutMs: this.requestTimeoutMs,
      buildTimeoutError: (requestId, timeoutMs) =>
        new RemotePtyHostError(
          "ipc-timeout",
          `request ${requestId} timed out after ${timeoutMs}ms`,
        ),
      send: (type, requestId, payload) => this.send(type, requestId, payload),
    });

    this.socket.on("data", (chunk: Buffer) => this.handleChunk(chunk));
    this.socket.on("close", () => this.handleDrop("connection closed"));
    this.socket.on("error", () => this.handleDrop("socket error"));

    this.sendHello(deps.serverPid ?? process.pid);
  }

  // --- handshake ---

  private sendHello(serverPid: number): void {
    const payload: HelloPayload = {
      protocolVersion: PROTOCOL_VERSION,
      serverPid,
    };
    this.socket.write(
      encodeFrame({
        type: FrameType.HELLO,
        connectionId: 0,
        generation: 0n,
        requestId: 1,
        payload: encodeJsonPayload(payload),
      }),
    );
  }

  // --- frame ingestion ---

  private handleChunk(chunk: Buffer): void {
    let frames: Frame[];
    try {
      frames = this.parser.push(chunk);
    } catch (err) {
      this.handleDrop(
        err instanceof FrameError ? `parser: ${err.message}` : "parser failure",
      );
      return;
    }
    for (const frame of frames) {
      if (this.lifecycle.isDropped) return;
      this.dispatch(frame);
    }
  }

  private dispatch(frame: Frame): void {
    if (frame.type === FrameType.HELLO_ACK) {
      this.onHelloAck(frame);
      return;
    }
    if (frame.type === FrameType.NACK) {
      this.onNack(frame);
      return;
    }
    /*
     * Permit SESSION_LIST during snapshot-pending -- that frame *completes*
     * the handshake. Everything else (ACKs, SESSION_UPDATE/EXIT, DATA,
     * SESSION_INPUT) requires `ready`: requests are gated behind
     * handshakePromise so no ACK should arrive early, and broadcasts
     * before the initial snapshot would land in an empty mirror.
     */
    if (this.lifecycle.current === "snapshot-pending") {
      if (frame.type === FrameType.SESSION_LIST) {
        this.applySessionList(frame);
      }
      return;
    }
    if (!this.lifecycle.isReady) return;

    if (ACK_FRAME_TYPES.has(frame.type)) {
      // Stale acks (peer slow / fenced) return false from the correlator
      // and are silently dropped -- same behavior as the prior inline lookup.
      this.correlator.ack(frame);
      return;
    }

    switch (frame.type) {
      case FrameType.SESSION_UPDATE:
        this.applySessionUpdate(frame);
        return;
      case FrameType.SESSION_LIST:
        this.applySessionList(frame);
        return;
      case FrameType.SESSION_EXIT:
        this.applySessionExit(frame);
        return;
      case FrameType.DATA:
        this.applyData(frame);
        return;
      case FrameType.SESSION_INPUT:
        this.applySessionInput(frame);
        return;
      default:
        // Unknown daemon->server frame type. Log-equivalent is no-op
        // since we don't have a console channel here; the daemon would
        // never send something we don't know during normal operation.
        return;
    }
  }

  private onHelloAck(frame: Frame): void {
    if (this.lifecycle.current !== "connecting") return;
    const result = validateHelloAck(frame.payload, PROTOCOL_VERSION);
    if (!result.ok) {
      this.lifecycle.drop(new RemotePtyHostError(result.code, result.message));
      return;
    }
    /*
     * Design contract: handshake "ready" is HELLO_ACK + first SESSION_LIST applied.
     * applyHelloAck transitions to snapshot-pending; the resolve fires from
     * applySessionList -> lifecycle.markReady once the initial snapshot lands.
     */
    this.lifecycle.applyHelloAck(result.connectionId, result.generation);
  }

  private onNack(frame: Frame): void {
    let body: NackPayload;
    try {
      body = decodeJsonPayload<NackPayload>(frame.payload);
    } catch {
      this.handleDrop("undecodable NACK");
      return;
    }
    if (frame.requestId !== 0) {
      // requestId=0 is handled below as a connection-level NACK; otherwise
      // delegate to the correlator. Stale ids (peer slow / fenced) are a
      // no-op -- same behavior as the prior inline lookup.
      this.correlator.nack(
        frame.requestId,
        new RemotePtyHostError(body.code, body.message),
      );
      return;
    }
    /*
     * requestId=0 NACK is a connection-level fault: handshake-required,
     * version-mismatch, evicted, daemon-shutting-down, or a malformed
     * frame the daemon refused. Either way, the wire is dead -- drop and
     * let the supervisor rebuild.
     */
    if (this.lifecycle.isAwaitingHandshake) {
      // Reject the awaiter with the daemon's specific NACK code BEFORE
      // handleDrop runs -- Promise rejection is idempotent so the subsequent
      // drop()'s "connection-dropped" reject is a no-op, preserving the
      // daemon-specific error on the connect() awaiter side.
      this.lifecycle.rejectHandshakeOnly(
        new RemotePtyHostError(body.code, body.message),
      );
    }
    this.handleDrop(`daemon NACK: ${body.code} ${body.message}`);
  }

  // --- broadcast handlers (mirror reconciliation + listener fan-out) ---

  private applySessionUpdate(frame: Frame): void {
    const body = decodeJsonPayload<SessionUpdatePayload>(frame.payload);
    this.mirror.upsert(body.session);
  }

  private applySessionList(frame: Frame): void {
    const body = decodeJsonPayload<SessionListPayload>(frame.payload);
    this.mirror.applyList(body.sessions);
    // Idempotent: markReady returns false on any state other than
    // snapshot-pending, so later SESSION_LIST broadcasts just update the
    // mirror without re-resolving the handshake.
    this.lifecycle.markReady();
  }

  private applySessionExit(frame: Frame): void {
    const body = decodeJsonPayload<SessionExitPayload>(frame.payload);
    this.mirror.applyExit(body.sessionId, body.endReason);
    this.onSessionExit?.(
      body.sessionId,
      body.sessionGeneration,
      body.endReason,
    );
  }

  private applyData(frame: Frame): void {
    /*
     * PTY generation gate: DATA frames now carry a `[idLen][sessionId][gen:u32 BE][data]`
     * payload (PROTOCOL_VERSION 2.0.0). The generation is recorded into
     * `latestGeneration` so the binary `attachClient` adapter can read
     * the live value when wrapping `sink.onChunk`, and is forwarded to
     * `dataListeners` (the WS handler stamps it into OUTPUT frames so
     * the client echoes it back on INPUT). String per-client listeners
     * stay generation-agnostic -- those are the legacy non-binary attach
     * path that does not feed back into the input gate.
     */
    const decoded = decodeGenerationStreamPayload(frame.payload);
    const data = decoded.data.toString("utf8");
    /*
     * PTY generation gate: advance the monotonic generation latch and learn whether this
     * chunk is stale. The daemon's in-process host can flush an old-generation
     * batch AFTER auto-resume bumps the generation (the setImmediate that
     * captured generationAtSpawn fires post-respawn); those late chunks arrive
     * tagged with the old gen. The mirror only moves the latch forward, so the
     * next INPUT frame echoes the current gen rather than the stale one.
     */
    const { stale: isStale } = this.mirror.recordDataGeneration(
      decoded.sessionId,
      decoded.generation,
    );
    /*
     * PTY generation gate: stale-gen DATA must not reach attached clients
     * or scrollback in daemon mode. The in-process side already gates
     * its `attachedClients` broadcast on `generationStillCurrent` so
     * old-PTY bytes never hit a client xterm; the daemon symmetric path
     * is here. If we forwarded a stale chunk, the per-client wrapper in
     * `attachClient()` would read the latch value and re-tag those bytes
     * with the NEW gen -- defeating the whole PTY generation gate fence. Worse: scrollback
     * would record stale bytes AFTER fresh ones, corrupting the on-disk
     * replay order. Drop the fanout / scrollback when stale; keep
     * `dataListeners` so debug / recording observers still see every byte
     * tagged with its true emit-time generation (they self-decide on staleness).
     */
    if (!isStale) {
      void this.headlessStateCache
        ?.writeExisting(decoded.sessionId, data)
        .catch((err) => {
          console.warn(
            `[terminal] headless state update failed for session=${decoded.sessionId.slice(0, 8)}: ${(err as Error).message}`,
          );
          this.headlessStateCache?.delete(decoded.sessionId);
        });
      const clients = this.attached.get(decoded.sessionId);
      if (clients) {
        for (const client of clients.values()) {
          try {
            client.listener(data);
          } catch {
            // listener faults are not fatal; isolate so one bad client
            // doesn't break broadcast for siblings.
          }
        }
      }
    }
    for (const listener of this.dataListeners) {
      try {
        listener(decoded.sessionId, data, decoded.generation);
      } catch {
        /* same isolation */
      }
    }
    /*
     * Persist every fresh DATA chunk to the per-session disk log so a
     * re-mounting xterm (tab switch, dev-server reload while the daemon
     * survives) can rehydrate via `replay:"full"`. The daemon owns PTY
     * lifetime in this mode; without our own append the server has no
     * way to feed scrollback back to a fresh client. Buffered+throttled
     * inside ScrollbackLog so the broadcast hot path stays cheap.
     * Stale-gen chunks are intentionally skipped so a
     * subsequent `replay:"full"` does not surface old-PTY bytes after
     * the new spawn's prompt.
     */
    if (this.scrollbackLog && !isStale) {
      this.scrollbackLog.append(decoded.sessionId, data);
      this.scrollbackOwnedIds.add(decoded.sessionId);
    }
  }

  private applySessionInput(frame: Frame): void {
    const decoded = decodeStreamPayload(frame.payload);
    const data = decoded.data.toString("utf8");
    for (const listener of this.inputListeners) {
      try {
        listener(decoded.sessionId, data);
      } catch {
        /* ignore */
      }
    }
  }

  // --- send helpers ---

  private send(type: number, requestId: number, payload: Buffer): void {
    if (this.lifecycle.isDropped) return;
    try {
      this.socket.write(
        encodeFrame({
          type,
          connectionId: this.lifecycle.connectionId,
          generation: this.lifecycle.generation,
          requestId,
          payload,
        }),
      );
    } catch {
      this.handleDrop("write failure");
    }
  }

  private fireAndForget(type: number, payload: Buffer): void {
    if (!this.lifecycle.isReady) return;
    this.send(type, 0, payload);
  }

  private async request(type: number, payload: Buffer): Promise<Frame> {
    if (this.lifecycle.isDropped) {
      throw new RemotePtyHostError(
        "connection-dropped",
        "RemotePtyHost socket is dropped",
      );
    }
    if (this.lifecycle.isAwaitingHandshake) {
      // Defer until handshake completes (HELLO_ACK + first SESSION_LIST);
      // if it rejects, propagate.
      await this.lifecycle.awaitReady;
    }
    return this.correlator.request(type, payload);
  }

  private handleDrop(reason: string): void {
    const err = new RemotePtyHostError("connection-dropped", reason);
    // lifecycle.drop transitions to 'dropped' and rejects the handshake
    // promise if it was still awaiting (Promise reject is idempotent, so a
    // prior rejectHandshakeOnly with a daemon-specific code wins). Returns
    // false when state was already 'dropped' -- gate correlator.rejectAll on
    // the actual transition so a re-entry from the close/error listener
    // pair doesn't fire a second bulk reject.
    if (this.lifecycle.drop(err)) {
      this.correlator.rejectAll(err);
    }
  }

  // --- PtyHost interface (async) ---

  async create(input: CreateSessionInput): Promise<Session> {
    const payload: CreateReqPayload = {
      projectId: input.projectId,
      command: input.command,
      cwd: input.cwd,
      title: input.title,
      bootstrapInput: input.bootstrapInput,
    };
    const ack = await this.request(
      FrameType.CREATE_REQ,
      encodeJsonPayload(payload),
    );
    const body = decodeJsonPayload<CreateAckPayload>(ack.payload);
    this.mirror.upsert(body.session);
    return body.session;
  }

  async restart(id: string): Promise<Session> {
    const payload: RestartReqPayload = { sessionId: id };
    const ack = await this.request(
      FrameType.RESTART_REQ,
      encodeJsonPayload(payload),
    );
    const body = decodeJsonPayload<RestartAckPayload>(ack.payload);
    /*
     * PTY generation gate: restart bumps the generation server-side. `upsert` seeds the
     * latch so the WS client's first INPUT after restart is sent under the
     * new generation; otherwise it races the first DATA chunk under the old
     * gen, trips the daemon-side input gate, and drops the keystroke.
     */
    this.mirror.upsert(body.session);
    return body.session;
  }

  async dispose(id: string): Promise<void> {
    const payload: DisposeReqPayload = { sessionId: id };
    await this.request(FrameType.DISPOSE_REQ, encodeJsonPayload(payload));
    this.mirror.remove(id);
    this.attached.delete(id);
    this.headlessStateCache?.delete(id);
    if (this.scrollbackLog) {
      this.scrollbackLog.remove(id);
      this.scrollbackOwnedIds.delete(id);
    }
  }

  async disposeAll(): Promise<void> {
    await this.request(FrameType.DISPOSE_ALL_REQ, encodeJsonPayload({}));
    this.mirror.clear();
    this.attached.clear();
    this.headlessStateCache?.clear();
    if (this.scrollbackLog) {
      for (const id of this.scrollbackOwnedIds) this.scrollbackLog.remove(id);
      this.scrollbackOwnedIds.clear();
    }
  }

  /**
   * By protocol, `shutdownAll` is detach-only: the
   * daemon ACKs and then evicts our connection. We swallow the
   * subsequent `connection-dropped` to make caller code shape-identical
   * to `InProcessPtyHost.shutdownAll()` (which never throws).
   *
   * The `reason` parameter is accepted to satisfy the `PtyHost`
   * interface (in-process uses it to stamp `endReason` on every session
   * record); on the remote path it has no effect -- the daemon owns the
   * sessions and will stamp its own `daemon-graceful`/`daemon-crash` on
   * its next own SIGTERM.
   */
  async shutdownAll(_reason?: SessionEndReason): Promise<void> {
    if (!this.lifecycle.isReady) return;
    try {
      await this.request(FrameType.SHUTDOWN_ALL_REQ, encodeJsonPayload({}));
    } catch (err) {
      if (
        err instanceof RemotePtyHostError &&
        err.code === "connection-dropped"
      )
        return;
      throw err;
    }
  }

  /**
   * state persistence delegate / daemon state ownership -- implements `AppStatePersistenceDelegate.persist`. Ships
   * the server-owned project-domain snapshot to the daemon, which is the
   * sole writer of `state.json`. Resolves on PERSIST_PROJECT_DOMAINS_ACK,
   * rejects on NACK / connection drop / IPC timeout. AppStateStore routes
   * those rejections through `onPersistError` so a transient IPC fault
   * does not silently lose project / projectStates / serviceConfig /
   * paneCommands / ideCommands
   * mutations.
   *
   * `sessions` and `sessionRecords` are deliberately not forwarded -- the
   * daemon owns those domains and would overwrite its own snapshot if we
   * did. Only the server-owned slices ride along.
   */
  async persist(state: Readonly<AppState>): Promise<void> {
    const payload: PersistProjectDomainsReqPayload = {
      projects: state.projects,
      projectStates: state.projectStates,
      serviceConfig: state.serviceConfig,
      paneCommands: state.paneCommands,
      ideCommands: state.ideCommands,
    };
    await this.request(
      FrameType.PERSIST_PROJECT_DOMAINS_REQ,
      encodeJsonPayload(payload),
    );
  }

  async initClient(
    id: string,
    clientId: string,
    cols: number,
    rows: number,
    listener: (data: string) => void,
  ): Promise<{ ok: true; attachToken: number } | { ok: false }> {
    const attachToken = this.nextAttachToken++;
    const payload: InitClientReqPayload = {
      sessionId: id,
      clientId,
      cols,
      rows,
      attachToken,
    };
    const ack = await this.request(
      FrameType.INIT_CLIENT_REQ,
      encodeJsonPayload(payload),
    );
    const body = decodeJsonPayload<InitClientAckPayload>(ack.payload);
    if (!body.accepted) return { ok: false };
    let bySession = this.attached.get(id);
    if (!bySession) {
      bySession = new Map();
      this.attached.set(id, bySession);
    }
    bySession.set(clientId, { listener, attachToken });
    return { ok: true, attachToken };
  }

  /**
   * : daemon-mode chunked replay is out of scope for the
   * initial implementation -- the daemon's STREAM_DATA frame does not yet
   * carry the (gen, seq) header needed for the chunk ring to be
   * authoritative end-to-end. We therefore negotiate
   * `binary=false / chunkedReplay=false` so the client knows scrollback
   * cursor semantics are legacy.
   *
   * Live OUTPUT is forwarded through the binary `sink.onChunk` path
   * with a synthetic per-attach seq counter; the generation now comes
   * from `latestGeneration` (PTY generation gate) so the WS layer stamps each OUTPUT
   * with the producing PTY's true generation, the client echoes that
   * back on INPUT, and the daemon-side gate can drop stale input that
   * targets a no-longer-current generation. The client-side
   * `serverState.lastDeliveredSeq=null` we return causes the client to
   * drop any persisted cursor on init-ack -- so the synthetic seq cannot
   * collide with a stale ring entry on reconnect.
   *
   * Scrollback rehydration: when a `ScrollbackLog` is supplied, the disk
   * tail is shipped as `replay:"full"`. This fixes the "blank terminal
   * on tab switch" regression -- without it, a re-mount sees nothing
   * until fresh PTY output arrives, even though the daemon still owns
   * the live session.
   */
  async attachClient(
    id: string,
    clientId: string,
    cols: number,
    rows: number,
    _capabilities: AttachClientCapabilities,
    sink: AttachClientSink,
  ): Promise<AttachClientResult> {
    let syntheticSeq = 0n;
    const result = await this.initClient(id, clientId, cols, rows, (data) => {
      const gen = this.mirror.generationOf(id);
      sink.onChunk(gen, syntheticSeq++, Buffer.from(data, "utf8"));
    });
    if (!result.ok) return { ok: false };
    const seedGen = this.mirror.generationOf(id);
    const tail = this.scrollbackLog?.readTail(id) ?? "";
    if (tail.length > 0) {
      let fullReplay: string;
      let replayDiagnostics: AttachClientResponse["replayDiagnostics"];
      const rawBytes = Buffer.byteLength(tail, "utf8");
      if (this.headlessReplayEnabled && this.headlessStateCache) {
        try {
          const headlessSnapshot =
            (await this.headlessStateCache.snapshot(id, { cols, rows })) ??
            (await this.headlessStateCache.rebuild(id, tail, { cols, rows }));
          if (!headlessSnapshot) {
            throw new Error("empty headless replay snapshot");
          }
          const snapshot = headlessSnapshot.snapshot;
          fullReplay = headlessSnapshot.snapshot.text;
          replayDiagnostics = {
            source: headlessSnapshot.source,
            rawBytes: snapshot.rawBytes,
            replayBytes: snapshot.snapshotBytes,
            headlessDurationMs: snapshot.durationMs,
            headlessBufferLines: snapshot.bufferLines,
            headlessEmittedLines: snapshot.emittedLines,
            scrollbackLines: this.headlessReplayScrollbackLines,
            maxBytes: this.headlessReplayMaxBytes,
          };
        } catch (err) {
          console.warn(
            `[terminal] headless replay snapshot failed for session=${id.slice(0, 8)}: ${(err as Error).message}`,
          );
          fullReplay = stripQueryEscapes(
            utf8Tail(tail, this.daemonLegacyReplayMaxBytes),
          );
          replayDiagnostics = {
            source: "headless-fallback",
            rawBytes,
            replayBytes: Buffer.byteLength(fullReplay, "utf8"),
            scrollbackLines: this.headlessReplayScrollbackLines,
            maxBytes: this.headlessReplayMaxBytes,
          };
        }
      } else {
        fullReplay = stripQueryEscapes(
          utf8Tail(tail, this.daemonLegacyReplayMaxBytes),
        );
        replayDiagnostics = {
          source: "raw-tail",
          rawBytes,
          replayBytes: Buffer.byteLength(fullReplay, "utf8"),
          maxBytes: this.daemonLegacyReplayMaxBytes,
        };
      }
      return {
        ok: true,
        attachToken: result.attachToken,
        capabilities: { binary: false, chunkedReplay: false },
        serverState: {
          generation: seedGen,
          lastDeliveredSeq: null,
          oldestSeq: null,
        },
        replay: "full",
        fullReplay,
        replayDiagnostics,
      };
    }
    return {
      ok: true,
      attachToken: result.attachToken,
      capabilities: { binary: false, chunkedReplay: false },
      serverState: {
        generation: seedGen,
        lastDeliveredSeq: null,
        oldestSeq: null,
      },
      replay: "none",
    };
  }

  // --- PtyHost interface (sync mutators, fire-and-forget) ---

  setPtyEnv(env: Record<string, string>): void {
    this.ptyEnv = { ...this.ptyEnv, ...env };
    const payload: SetPtyEnvPayload = { env };
    this.fireAndForget(FrameType.SET_PTY_ENV, encodeJsonPayload(payload));
  }

  setTitle(id: string, title: string, titleManual = false): boolean {
    const session = this.mirror.get(id);
    if (!session) return false;
    const next = titleManual
      ? { ...session, title, titleManual: true }
      : (() => {
          const { titleManual: _drop, ...rest } = session;
          return { ...rest, title };
        })();
    this.mirror.replace(next);
    const payload: SetTitlePayload = { sessionId: id, title, titleManual };
    this.fireAndForget(FrameType.SET_TITLE, encodeJsonPayload(payload));
    return true;
  }

  setPinned(id: string, pinned: boolean): boolean {
    const session = this.mirror.get(id);
    if (!session) return false;
    /*
     * Match InProcessPtyHost's optimistic shape: drop the `pinned`
     * key entirely when it goes false, set it to `true` when true.
     * This keeps the  Liskov contract intact -- callers reading the
     * mirror sync after setPinned() see the same shape regardless of
     * implementation.
     */
    if (pinned) {
      this.mirror.replace({ ...session, pinned: true });
    } else {
      const { pinned: _drop, ...rest } = session;
      this.mirror.replace(rest);
    }
    const payload: SetPinnedPayload = { sessionId: id, pinned };
    this.fireAndForget(FrameType.SET_PINNED, encodeJsonPayload(payload));
    return true;
  }

  write(id: string, data: string, generation?: number): void {
    /*
     * PTY generation gate: forward the client-supplied generation across the IPC so the
     * daemon-side InProcessPtyHost can apply the same drop-stale-input
     * gate that in-process mode uses. `0` is a sentinel meaning "no
     * gating" (legacy callers / non-WS writes); the daemon treats `0`
     * the same way an `undefined` generation arg would be treated.
     */
    this.fireAndForget(
      FrameType.WRITE,
      encodeGenerationStreamPayload(
        id,
        Buffer.from(data, "utf8"),
        generation ?? 0,
      ),
    );
  }

  resize(id: string, cols: number, rows: number): void {
    const payload: ResizePayload = { sessionId: id, cols, rows };
    this.fireAndForget(FrameType.RESIZE, encodeJsonPayload(payload));
  }

  refresh(id: string): void {
    const payload: RefreshPayload = { sessionId: id };
    this.fireAndForget(FrameType.REFRESH, encodeJsonPayload(payload));
  }

  pauseOutput(id: string, clientId: string): void {
    const payload: FlowControlPayload = { sessionId: id, clientId };
    this.fireAndForget(FrameType.PAUSE_OUTPUT, encodeJsonPayload(payload));
  }

  resumeOutput(id: string, clientId: string): void {
    const payload: FlowControlPayload = { sessionId: id, clientId };
    this.fireAndForget(FrameType.RESUME_OUTPUT, encodeJsonPayload(payload));
  }

  detachClient(id: string, clientId: string, expectedToken?: number): void {
    const bySession = this.attached.get(id);
    if (expectedToken !== undefined) {
      const entry = bySession?.get(clientId);
      if (!entry || entry.attachToken !== expectedToken) return;
    }
    if (bySession) {
      bySession.delete(clientId);
      if (bySession.size === 0) this.attached.delete(id);
    }
    const payload: DetachClientPayload = {
      sessionId: id,
      clientId,
      ...(expectedToken !== undefined && { attachToken: expectedToken }),
    };
    this.fireAndForget(FrameType.DETACH_CLIENT, encodeJsonPayload(payload));
  }

  // --- PtyHost interface (sync read accessors, mirror-served) ---

  list(): Session[] {
    return this.mirror.list();
  }

  get(id: string): Session | undefined {
    return this.mirror.get(id);
  }

  listByProject(projectId: string): Session[] {
    return this.mirror.listByProject(projectId);
  }

  /*
   * Scrollback is served from the server-side disk log populated by
   * `applyData`. Foreground-process state still lives in the daemon's
   * AppStateStore and is reachable only via SESSION_UPDATE -- the
   * accessor stays null per the  mismatch column.
   */
  getScrollback(id: string): string | null {
    if (!this.scrollbackLog) return null;
    const tail = this.scrollbackLog.readTail(id);
    return tail.length > 0 ? tail : null;
  }

  getForegroundProcess(_id: string): string | null {
    return null;
  }

  loadPersistedSession(_session: Session, _wasGracefulShutdown: boolean): void {
    // No-op on remote: the daemon owns persistence and SESSION_LIST is the
    // server mirror's source of truth.
  }

  onSessionInput(listener: (sessionId: string, data: string) => void): void {
    this.inputListeners.push(listener);
  }

  onSessionData(
    listener: (sessionId: string, data: string, generation: number) => void,
  ): void {
    this.dataListeners.push(listener);
  }
}

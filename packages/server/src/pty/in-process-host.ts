import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  Session,
  SessionCommand,
  SessionEndReason,
  SessionRecord,
  TerminalCapabilities,
} from "@parasor/shared";
import * as pty from "node-pty";
import { PromiseMutex } from "../lib/promise-mutex.js";
import type { AppStateStore } from "../state/app-state.js";
import { HeadlessTerminalStateCache } from "./headless-terminal-state-cache.js";
import type {
  AttachClientCapabilities,
  AttachClientResponse,
  AttachClientResult,
  AttachClientSink,
  CreateSessionInput,
  PtyHost,
} from "./host.js";
import type { ScrollbackLog } from "./scrollback-log.js";
import { stripQueryEscapes } from "./scrollback-sanitize.js";
import * as sessionPolicy from "./session-policy.js";

export type { CreateSessionInput };

const DEFAULT_IN_PROCESS_LEGACY_REPLAY_MAX_BYTES = 256 * 1024;
const DEFAULT_HEADLESS_REPLAY_SCROLLBACK_LINES = 10_000;
const DEFAULT_HEADLESS_REPLAY_MAX_BYTES =
  DEFAULT_IN_PROCESS_LEGACY_REPLAY_MAX_BYTES;
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

/**
 * Identity of the process that owns AppState writes (
 * ). Persisted into every `SessionRecord.daemonPid /
 * daemonStartedAt`, then read back by `reconcileSessionRecords` on
 * daemon startup to distinguish *this* generation's records from
 * orphans inherited from a previous daemon process.
 *
 * Optional at construction: in-process tests that don't exercise
 * orphan reconciliation can omit it, in which case `SessionRecord`
 * persistence is skipped entirely (sessions are still tracked for the
 * lifetime of the host, but `appState.sessionRecords` stays empty).
 * Production callers -- both the daemon bootstrap and the in-process
 * server entry -- always supply a context so the doctor CLI works in
 * either mode.
 */
export interface InProcessPtyHostDaemonContext {
  /** PID of the process owning AppStateStore writes. */
  pid: number;
  /** ISO8601 timestamp identifying the writer generation. */
  startedAt: string;
}

/**
 * Multi-client model: each WebSocket attaches its own
 * listener keyed by clientId. PTY output is broadcast to every attached
 * listener. Same-clientId re-init replaces the listener in place.
 *
 * Two flavors coexist: legacy "string" clients that
 * receive each batched flush as a UTF-8 string (back-compat path), and
 * binary "chunk" clients that receive the same data as a `Buffer` plus
 * the (`generation`, `seq`) pair from the in-memory chunk ring.
 * Both fire from the same broadcast loop so ordering and batching stay
 * identical regardless of attach style.
 */
/**
 * Attach fencing fence: each attach mints a monotonic token stamped onto its
 * map entry. `detachClient(..., expectedToken)` only removes the entry
 * when the stored token still matches, so a stale onClose racing a fresh
 * same-`clientId` attach cannot wipe the new listener.
 */
type AttachedClient = { attachToken: number; flowPaused: boolean } & (
  | { kind: "string"; listener: (data: string) => void }
  | {
      kind: "chunk";
      listener: (generation: number, seq: bigint, data: Buffer) => void;
      onExit?: (exitCode: number) => void;
    }
);

interface ManagedSession {
  info: Session;
  process: pty.IPty | null;
  ptySize: { cols: number; rows: number } | null;
  currentGeneration: number;
  attachedClients: Map<string, AttachedClient>;
  outputPaused: boolean;
  mutex: PromiseMutex;
  bootstrapInput: string | null;
  /**
   * Mirror of the SessionRecord we have persisted into AppState. Held
   * separately from `info` because they have different lifetimes and
   * different fields: `info` is the WS-facing `Session` (UI), the
   * record is the daemon-orphan-tracking source of truth (PID, PGID,
   * argv, daemon-generation tuple). Null when no daemonContext was
   * supplied at construction time (record-less mode).
   */
  record: SessionRecord | null;
}

export class InProcessPtyHost implements PtyHost {
  private sessions = new Map<string, ManagedSession>();
  private globalDataListeners: ((
    sessionId: string,
    data: string,
    generation: number,
  ) => void)[] = [];
  private inputListeners: ((sessionId: string, data: string) => void)[] = [];
  private ptyEnv: Record<string, string> = {};
  private readonly inProcessLegacyReplayMaxBytes =
    readPositiveIntegerEnv("PARASOR_IN_PROCESS_LEGACY_REPLAY_MAX_BYTES") ??
    DEFAULT_IN_PROCESS_LEGACY_REPLAY_MAX_BYTES;
  private readonly headlessReplayEnabled = readHeadlessReplayEnabled();
  private readonly headlessReplayScrollbackLines =
    readPositiveIntegerEnv("PARASOR_HEADLESS_REPLAY_SCROLLBACK_LINES") ??
    DEFAULT_HEADLESS_REPLAY_SCROLLBACK_LINES;
  private readonly headlessReplayMaxBytes =
    readPositiveIntegerEnv("PARASOR_HEADLESS_REPLAY_MAX_BYTES") ??
    DEFAULT_HEADLESS_REPLAY_MAX_BYTES;
  private readonly headlessStateCache = this.headlessReplayEnabled
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
  /**
   * Attach fencing monotonic counter -- incremented per attach (initClient or
   * attachClient), stamped on the resulting `AttachedClient` entry, and
   * compared on `detachClient(..., expectedToken)`. Plain integer is fine
   * because tokens are scoped to this host instance and the comparison
   * is identity, not magnitude.
   */
  private nextAttachToken = 1;

  private mintAttachToken(caller: number | undefined): number {
    if (caller !== undefined) return caller;
    return this.nextAttachToken++;
  }

  onSessionExit:
    | ((
        sessionId: string,
        generation: number,
        endReason: SessionEndReason,
      ) => void)
    | null = null;

  constructor(
    private readonly store: AppStateStore,
    /**
     * Disk-backed scrollback log. When null (daemon-side host, contract
     * tests), this host records no scrollback and every replay path
     * returns empty. That is intentional: the daemon forwards OUTPUT to
     * the client over IPC and the client-side `RemotePtyHost` owns its
     * own `ScrollbackLog` -- keeping a redundant copy on the daemon side
     * would just double the disk footprint. `getScrollback()` and the
     * `initClient` legacy replay degrade to "no replay" in that mode.
     */
    private readonly scrollbackLog: ScrollbackLog | null = null,
    private readonly daemonContext: InProcessPtyHostDaemonContext | null = null,
    /**
     * Canonical absolute path of `<rootDir>/uploads`. When supplied, every
     * spawned PTY's env gets `PARASOR_UPLOAD_DIR=<uploadsDir>/<sessionId>`
     * -- the per-session subdir, NOT the shared root -- so the Claude shim's
     * `--add-dir` allowlists only that PTY's own drops (upload staging isolation codex
     * Shared-root isolation review: the shared-root variant let session A read session
     * B's uploads via `--add-dir`). Null in tests that don't exercise the
     * upload pipeline.
     */
    private readonly uploadsDir: string | null = null,
  ) {}

  /**
   * Merge env vars into the per-PTY environment. Multiple calls accumulate
   * (later calls override individual keys but preserve everything else),
   * so the server can set the static shim PATH early during init and add
   * the dynamic PARASOR_PORT later once probePort has resolved the actual
   * listening port.
   */
  setPtyEnv(env: Record<string, string>): void {
    this.ptyEnv = { ...this.ptyEnv, ...env };
  }

  private buildSessionEnv(
    sessionId: string,
    projectId: string,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    Object.assign(env, this.ptyEnv, {
      PROMPT_EOL_MARK: "",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "parasor",
      PARASOR_SESSION_ID: sessionId,
      PARASOR_PROJECT_ID: projectId,
    });
    if (this.uploadsDir) {
      // Per-session subdir, eagerly created so the Claude wrapper's
      // `--add-dir` flag references a real path even when the user never
      // drops a file. The drops route's `acquire(sessionId)` is
      // idempotent -- a later upload re-mkdirs the same path.
      const sessionUploadDir = join(this.uploadsDir, sessionId);
      mkdirSync(sessionUploadDir, { recursive: true, mode: 0o700 });
      env.PARASOR_UPLOAD_DIR = sessionUploadDir;
    }
    return env;
  }

  /**
   * Create a session stub. The PTY is NOT spawned here -- it is deferred
   * until the first WebSocket attach provides real viewport dimensions.
   * This is the whole point of the deferred-spawn model: spawning at the
   * exact client dims eliminates the SIGWINCH-driven prompt redraw that
   * otherwise walks zsh's prompt down one row on every new-session open.
   */
  async create(input: CreateSessionInput): Promise<Session> {
    const id = randomUUID();
    const mutex = new PromiseMutex();
    const release = await mutex.acquire();

    try {
      const { spawnCmd, spawnArgs } = this.resolveCommand(input.command);

      const info: Session = {
        id,
        projectId: input.projectId,
        pid: null,
        state: "spawning",
        generation: 1,
        title: input.title ?? basename(spawnCmd),
        ...(input.title !== undefined && { titleManual: true }),
        command: input.command,
        cwd: input.cwd,
        shell: spawnCmd,
        ...(input.launchPreset !== undefined && {
          launchPreset: input.launchPreset,
        }),
        createdAt: Date.now(),
      };

      // Build the SessionRecord stub. PID/PGID stay null until
      // spawnProcess fills them on first WS attach. State is "running"
      // from creation: from the daemon's perspective this slot is
      // claimed and counts toward orphan reconciliation. If the daemon
      // crashes between create() and spawnProcess, the next daemon's
      // reconcile sees state=running + pid=null and transitions it to
      // "lost" (orphan-cleanup.ts: no-pid path).
      const record: SessionRecord | null = this.daemonContext
        ? {
            id,
            projectId: input.projectId,
            command: input.command,
            cwd: input.cwd,
            pid: null,
            pgid: null,
            argv: [spawnCmd, ...spawnArgs],
            startedAt: new Date().toISOString(),
            state: "running",
            exitCode: null,
            exitSignal: null,
            daemonPid: this.daemonContext.pid,
            daemonStartedAt: this.daemonContext.startedAt,
          }
        : null;

      const managed: ManagedSession = {
        info,
        process: null,
        ptySize: null,
        currentGeneration: 1,
        attachedClients: new Map(),
        outputPaused: false,
        mutex,
        bootstrapInput: input.bootstrapInput ?? null,
        record,
      };

      this.sessions.set(id, managed);
      this.store.mutateSessions((s) => {
        s.sessions.push(structuredClone(info));
        if (record) {
          s.sessionRecords.push(structuredClone(record));
        }
      });

      return info;
    } finally {
      release();
    }
  }

  async restart(id: string): Promise<Session> {
    const managed = this.sessions.get(id);
    if (!managed) throw new Error(`Session ${id} not found`);

    const release = await managed.mutex.acquire();
    try {
      if (managed.info.state !== "ended") {
        throw new Error(`Session ${id} is not ended; cannot restart`);
      }

      const nextGen = managed.currentGeneration + 1;
      managed.currentGeneration = nextGen;
      this.scrollbackLog?.bumpGeneration(id, nextGen);

      managed.info = {
        ...managed.info,
        pid: null,
        state: "spawning",
        generation: nextGen,
        endedAt: undefined,
        endReason: undefined,
      };
      managed.process = null;
      managed.ptySize = null;
      managed.attachedClients.clear();

      // Reset the SessionRecord too: clear PID/PGID, re-arm state to
      // "running" so the record participates in orphan reconciliation
      // again, and refresh startedAt so the  window starts now.
      // daemonPid/daemonStartedAt stay this generation's -- restart()
      // is by definition same-daemon (a different daemon would have
      // already marked the record orphaned at boot).
      if (managed.record && this.daemonContext) {
        managed.record = {
          ...managed.record,
          pid: null,
          pgid: null,
          state: "running",
          exitCode: null,
          exitSignal: null,
          startedAt: new Date().toISOString(),
        };
        this.persistRecord(managed.record);
      }

      this.persistSession(managed.info);

      return managed.info;
    } finally {
      release();
    }
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)?.info;
  }

  getScrollback(id: string): string | null {
    if (!this.sessions.has(id)) return null;
    const tail = this.scrollbackLog?.readTail(id) ?? "";
    return tail || null;
  }

  list(): Session[] {
    return [...this.sessions.values()].map((s) => s.info);
  }

  getForegroundProcess(id: string): string | null {
    const managed = this.sessions.get(id);
    if (!managed?.process) return null;
    try {
      const name = managed.process.process;
      return name ? basename(name) : null;
    } catch {
      return null;
    }
  }

  setTitle(id: string, title: string, titleManual = false): boolean {
    const managed = this.sessions.get(id);
    if (!managed) return false;
    const currentManual = managed.info.titleManual === true;
    if (managed.info.title === title && currentManual === titleManual) {
      return false;
    }
    managed.info = titleManual
      ? { ...managed.info, title, titleManual: true }
      : (() => {
          const { titleManual: _drop, ...rest } = managed.info;
          return { ...rest, title };
        })();
    this.persistSession(managed.info);
    return true;
  }

  setPinned(id: string, pinned: boolean): boolean {
    const managed = this.sessions.get(id);
    if (!managed) return false;
    const current = managed.info.pinned === true;
    if (current === pinned) return false;
    const next: Session = pinned
      ? { ...managed.info, pinned: true }
      : (() => {
          const { pinned: _drop, ...rest } = managed.info;
          return rest;
        })();
    managed.info = next;
    this.persistSession(managed.info);
    return true;
  }

  listByProject(projectId: string): Session[] {
    return this.list().filter((s) => s.projectId === projectId);
  }

  onSessionInput(listener: (sessionId: string, data: string) => void): void {
    this.inputListeners.push(listener);
  }

  write(id: string, data: string, generation?: number): void {
    const managed = this.sessions.get(id);
    if (!managed?.process) return;
    /*
     * PTY generation gate generation gate. Drop input tagged with a stale generation --
     * happens when the previous PTY's TUI sent a DECRQM-style query and
     * the terminal's reply is in-flight on the WS while we auto-resume
     * a new shell. Without this, the reply lands on the new shell's
     * stdin and visible fragments (e.g. "2026;2$y" from a DECRPM mode
     * 2026 response) leak onto the prompt.
     *
     * `0` and `undefined` are both "no gating" sentinels -- used by
     * legacy non-WS callers (osc7/port-detect taps), pre-init-ack
     * queued web INPUT (web's `currentGenerationRef` defaults to 0
     * before the init-ack populates it), and the daemon-IPC path when
     * the legacy WRITE codec lacked a generation field. Aligns with
     * the daemon's `handleWrite` semantics so in-process and daemon
     * modes behave identically (PTY generation gate parity).
     */
    if (
      sessionPolicy.shouldDropStaleInput(generation, managed.currentGeneration)
    ) {
      if (process.env.PARASOR_INPUT_DEBUG === "1") {
        // eslint-disable-next-line no-console
        console.error(
          `[input] drop stale gen=${generation} current=${managed.currentGeneration} session=${id.slice(0, 8)} bytes=${JSON.stringify(data.slice(0, 32))}`,
        );
      }
      return;
    }
    for (const listener of this.inputListeners) {
      listener(id, data);
    }
    managed.process.write(data);
  }

  /**
   * Resize the underlying PTY. The explicit resize caller is authoritative,
   * but duplicate claims for the current PTY size must not issue another
   * SIGWINCH.
   */
  resize(id: string, cols: number, rows: number): void {
    const managed = this.sessions.get(id);
    if (!managed?.process) return;
    if (managed.ptySize?.cols === cols && managed.ptySize.rows === rows) {
      return;
    }
    if (process.env.PARASOR_RESIZE_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.error(`[resize] session=${id.slice(0, 8)} -> ${cols}x${rows}`);
    }
    try {
      managed.process.resize(cols, rows);
      managed.ptySize = { cols, rows };
    } catch {
      // node-pty rejects invalid dims -- ignore
    }
  }

  /**
   * Force a SIGWINCH without changing dims so a TUI repaints from scratch.
   * Used when a client surface returns to the foreground (iOS background
   * tab freeze, mobile visibilitychange). node-pty's resize() is a no-op
   * when new dims equal current ones, so we briefly bump rows and snap
   * back -- INK collapses the two calls into a single repaint.
   */
  refresh(id: string): void {
    const managed = this.sessions.get(id);
    if (!managed?.process) return;
    const proc = managed.process;
    try {
      // Read current rows via ptyProc internals isn't exposed, but bumping
      // by +1 and snapping back is safe regardless of the current value --
      // we don't need to know it.
      const anyProc = proc as unknown as { rows?: number; cols?: number };
      const rows = anyProc.rows ?? 24;
      const cols = anyProc.cols ?? 80;
      proc.resize(cols, rows + 1);
      proc.resize(cols, rows);
    } catch {
      // ignore
    }
  }

  pauseOutput(id: string, clientId: string): void {
    const managed = this.sessions.get(id);
    if (!managed?.process) return;
    const client = managed.attachedClients.get(clientId);
    if (!client) return;
    client.flowPaused = true;
    this.applyOutputPauseState(managed);
  }

  resumeOutput(id: string, clientId: string): void {
    const managed = this.sessions.get(id);
    if (!managed?.process) return;
    const client = managed.attachedClients.get(clientId);
    if (!client) return;
    client.flowPaused = false;
    this.applyOutputPauseState(managed);
  }

  private shouldPauseOutput(managed: ManagedSession): boolean {
    const flowPausedFlags = [...managed.attachedClients.values()].map(
      (client) => client.flowPaused,
    );
    return sessionPolicy.shouldPauseOutputForClients(flowPausedFlags);
  }

  private applyOutputPauseState(managed: ManagedSession): void {
    const shouldPause = this.shouldPauseOutput(managed);
    if (shouldPause === managed.outputPaused) return;
    managed.outputPaused = shouldPause;
    try {
      if (shouldPause) {
        managed.process?.pause();
      } else {
        managed.process?.resume();
      }
    } catch {
      // ignore node-pty pause/resume failures; detach/reconnect can race exit
    }
  }

  /**
   * Attach a WebSocket client. Spawns the PTY on first call (using the
   * client's viewport dims), replays scrollback to the fresh listener,
   * and adds the listener to the broadcast set. A subsequent call with
   * the same clientId replaces the existing listener in place (no
   * duplicate broadcast).
   */
  async initClient(
    id: string,
    clientId: string,
    cols: number,
    rows: number,
    listener: (data: string) => void,
    callerToken?: number,
  ): Promise<{ ok: true; attachToken: number } | { ok: false }> {
    const managed = this.sessions.get(id);
    if (!managed) return { ok: false };

    const release = await managed.mutex.acquire();
    try {
      if (managed.info.state === "ended") {
        // Either auto-resume (silent re-spawn with scrollback retained) or
        // refuse -- the client then renders the error pane.
        if (!this.autoResumeIfSafe(managed, cols, rows)) return { ok: false };
      } else if (managed.info.state === "spawning") {
        this.spawnProcess(managed, cols, rows);
      }

      const attachToken = this.mintAttachToken(callerToken);
      managed.attachedClients.set(clientId, {
        kind: "string",
        listener,
        attachToken,
        flowPaused: false,
      });
      this.applyOutputPauseState(managed);

      /*
       * Replay scrollback to just this client so its xterm has state.
       * Terminal query escapes (XTVERSION / DA / DSR) are stripped here
       * because re-parsing them on the fresh xterm would make it emit
       * the response again -- which then lands in the idle shell's
       * readline buffer as visible garbage. The live path is untouched;
       * the single legitimate response-per-query still happens when the
       * app first sends the query.
       *
       * Attach fencing: if the listener throws (e.g. ws.send fails because
       * the WS just closed), the Promise rejects before the caller can
       * capture `attachToken`, so cleanupTerminalRelay later sees an
       * undefined token and skips detach. Roll back the just-inserted
       * entry inline -- the token-equality guard preserves a concurrent
       * fresher attach (defensive: mutex makes this unreachable today).
       */
      const replayText = this.scrollbackLog?.readTail(id) ?? "";
      if (replayText) {
        try {
          listener(stripQueryEscapes(replayText));
        } catch (err) {
          const current = managed.attachedClients.get(clientId);
          if (current?.attachToken === attachToken) {
            managed.attachedClients.delete(clientId);
            this.applyOutputPauseState(managed);
          }
          throw err;
        }
      }

      return { ok: true, attachToken };
    } finally {
      release();
    }
  }

  /**
   * capable attach.
   *
   * Held under `managed.mutex` for the entire negotiation so that any
   * concurrent PTY broadcast queues behind us -- the live chunk listener
   * is registered last, after we have already decided the replay strategy
   * and snapshotted the chunk ring. This prevents init-ack / replay /
   * live OUTPUT from interleaving on the wire.
   *
   * Falls back to JSON-path semantics when `capabilities.binary === false`
   * (the WS handler will not call us in that case, but the contract
   * stays well-defined).
   */
  async attachClient(
    id: string,
    clientId: string,
    cols: number,
    rows: number,
    capabilities: AttachClientCapabilities,
    sink: AttachClientSink,
  ): Promise<AttachClientResult> {
    const managed = this.sessions.get(id);
    if (!managed) return { ok: false };

    const release = await managed.mutex.acquire();
    try {
      if (managed.info.state === "ended") {
        if (!this.autoResumeIfSafe(managed, cols, rows)) return { ok: false };
      } else if (managed.info.state === "spawning") {
        this.spawnProcess(managed, cols, rows);
      }

      const negotiated: TerminalCapabilities = {
        binary: capabilities.binary === true,
        // chunkedReplay requires binary -- guarded explicitly so an
        // ill-formed client (false/true) is canonicalised before we
        // commit it into the response and the chunk listener.
        chunkedReplay:
          capabilities.binary === true && capabilities.chunkedReplay === true,
      };

      const generation = managed.currentGeneration;
      const ringSnapshot = this.scrollbackLog?.ringState(id, generation) ?? {
        generation,
        lastDeliveredSeq: null,
        oldestSeq: null,
      };

      let replay: "delta" | "full" | "none" = "none";
      let chunks:
        | { generation: number; seq: bigint; data: Buffer }[]
        | undefined;
      let fullReplay: string | undefined;
      let replayDiagnostics: AttachClientResponse["replayDiagnostics"];

      // Translate the wire-side string `lastSeen.seq` into BigInt for
      // ring comparison. Malformed inputs (NaN, negative, non-decimal)
      // collapse to "no cursor" so we never throw on the hot path.
      const lastSeenForRing = sessionPolicy.parseLastSeen(
        capabilities.lastSeen,
      );

      // Disk tail is the single source of truth for full replay. Read it
      // lazily and at most once: the common delta-replay reconnect never
      // needs it, and readTail does a flush + synchronous readFileSync of
      // up to the 4 MB tail under the session mutex.
      let diskTailCache: string | undefined;
      const getDiskTail = (): string => {
        if (diskTailCache === undefined) {
          diskTailCache = this.scrollbackLog?.readTail(id) ?? "";
        }
        return diskTailCache;
      };

      if (negotiated.chunkedReplay && this.scrollbackLog) {
        const decision = this.scrollbackLog.readSince(id, lastSeenForRing);
        if (decision.kind === "delta") {
          replay = "delta";
          chunks = decision.chunks.map((c) => ({
            generation,
            seq: c.seq,
            data: c.data,
          }));
        } else if (decision.kind === "full") {
          const tail = getDiskTail();
          replay = "full";
          const resolved = await this.buildFullReplay(id, tail, cols, rows);
          fullReplay = resolved.fullReplay;
          replayDiagnostics = resolved.replayDiagnostics;
        } else {
          if (lastSeenForRing) {
            replay = "none";
          } else {
            const tail = getDiskTail();
            replay = tail ? "full" : "none";
            if (replay === "full") {
              const resolved = await this.buildFullReplay(id, tail, cols, rows);
              fullReplay = resolved.fullReplay;
              replayDiagnostics = resolved.replayDiagnostics;
            }
          }
        }
      } else if (negotiated.binary) {
        // Binary OUTPUT but no chunked replay -- emit the disk tail once
        // via the legacy `replay` envelope so the new xterm has state,
        // then live OUTPUT continues.
        const tail = getDiskTail();
        if (tail) {
          replay = "full";
          const resolved = await this.buildFullReplay(id, tail, cols, rows);
          fullReplay = resolved.fullReplay;
          replayDiagnostics = resolved.replayDiagnostics;
        }
      }

      const attachToken = this.mintAttachToken(undefined);
      managed.attachedClients.set(clientId, {
        kind: "chunk",
        listener: sink.onChunk,
        onExit: sink.onExit,
        attachToken,
        flowPaused: false,
      });
      this.applyOutputPauseState(managed);

      return {
        ok: true,
        capabilities: negotiated,
        serverState: {
          generation: ringSnapshot.generation,
          lastDeliveredSeq:
            ringSnapshot.lastDeliveredSeq === null
              ? null
              : ringSnapshot.lastDeliveredSeq.toString(),
          oldestSeq:
            ringSnapshot.oldestSeq === null
              ? null
              : ringSnapshot.oldestSeq.toString(),
        },
        replay,
        chunks,
        fullReplay,
        replayDiagnostics,
        attachToken,
      };
    } finally {
      release();
    }
  }

  private async buildFullReplay(
    id: string,
    tail: string,
    cols: number,
    rows: number,
  ): Promise<{
    fullReplay: string;
    replayDiagnostics: AttachClientResponse["replayDiagnostics"];
  }> {
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
        return {
          fullReplay: snapshot.text,
          replayDiagnostics: {
            source: headlessSnapshot.source,
            rawBytes: snapshot.rawBytes,
            replayBytes: snapshot.snapshotBytes,
            headlessDurationMs: snapshot.durationMs,
            headlessBufferLines: snapshot.bufferLines,
            headlessEmittedLines: snapshot.emittedLines,
            scrollbackLines: this.headlessReplayScrollbackLines,
            maxBytes: this.headlessReplayMaxBytes,
          },
        };
      } catch (err) {
        console.warn(
          `[terminal] in-process headless replay snapshot failed for session=${id.slice(0, 8)}: ${(err as Error).message}`,
        );
        const fullReplay = stripQueryEscapes(
          utf8Tail(tail, this.inProcessLegacyReplayMaxBytes),
        );
        return {
          fullReplay,
          replayDiagnostics: {
            source: "headless-fallback",
            rawBytes,
            replayBytes: Buffer.byteLength(fullReplay, "utf8"),
            scrollbackLines: this.headlessReplayScrollbackLines,
            maxBytes: this.headlessReplayMaxBytes,
          },
        };
      }
    }

    const fullReplay = stripQueryEscapes(
      utf8Tail(tail, this.inProcessLegacyReplayMaxBytes),
    );
    return {
      fullReplay,
      replayDiagnostics: {
        source: "raw-tail",
        rawBytes,
        replayBytes: Buffer.byteLength(fullReplay, "utf8"),
        maxBytes: this.inProcessLegacyReplayMaxBytes,
      },
    };
  }

  private updateHeadlessState(sessionId: string, data: string): void {
    void this.headlessStateCache
      ?.writeExisting(sessionId, data)
      .catch((err) => {
        console.warn(
          `[terminal] in-process headless state update failed for session=${sessionId.slice(0, 8)}: ${(err as Error).message}`,
        );
        this.headlessStateCache?.delete(sessionId);
      });
  }

  detachClient(id: string, clientId: string, expectedToken?: number): void {
    const managed = this.sessions.get(id);
    if (!managed) return;
    if (expectedToken !== undefined) {
      const entry = managed.attachedClients.get(clientId);
      if (!entry || entry.attachToken !== expectedToken) return;
    }
    managed.attachedClients.delete(clientId);
    this.applyOutputPauseState(managed);
  }

  async dispose(id: string): Promise<void> {
    const managed = this.sessions.get(id);
    if (!managed) return;
    const release = await managed.mutex.acquire();
    try {
      if (managed.process) {
        managed.info.state = "ended"; // prevent exit callback from acting
        try {
          managed.process.kill();
        } catch {
          // ignore kill errors
        }
        managed.process = null;
      }
      this.sessions.delete(id);
      this.scrollbackLog?.remove(id);
      this.store.mutateSessions((s) => {
        s.sessions = s.sessions.filter((sess) => sess.id !== id);
        s.sessionRecords = s.sessionRecords.filter((rec) => rec.id !== id);
      });
    } finally {
      release();
    }
  }

  async disposeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.dispose(id)));
  }

  /**
   * Graceful-shutdown variant: kill every live PTY and mark each session
   * as graceful, but keep the session in state so it can be restored
   * (with scrollback) on the next server start. Unlike dispose, does not
   * remove sessions from the store. The optional `reason` lets the
   * daemon shutdown path distinguish itself from the server shutdown
   * path so the UI can pick the correct error/recovery branch -- a
   * "daemon-graceful" exit means the PTY children themselves are gone
   * (the daemon owned them), while a "server-graceful" exit in daemon
   * mode would be unusual (server unit shutdown but the daemon's PTYs
   * survive).
   */
  async shutdownAll(
    reason: SessionEndReason = { type: "server-graceful" },
  ): Promise<void> {
    const entries = [...this.sessions.values()];
    await Promise.all(
      entries.map(async (managed) => {
        const release = await managed.mutex.acquire();
        try {
          if (managed.info.state === "ended") return;
          managed.info = {
            ...managed.info,
            state: "ended",
            pid: null,
            endedAt: Date.now(),
            endReason: reason,
          };
          if (managed.process) {
            try {
              managed.process.kill();
            } catch {
              // ignore
            }
            managed.process = null;
          }
          this.persistSession(managed.info);
          // Mirror the shutdown into the SessionRecord: from the
          // orphan-reconcile point of view this PTY is gone (state
          // "exited", PID null). exitSignal records the signal that
          // would have been delivered -- node-pty's `kill()` with no
          // argument sends SIGHUP (controlling-terminal hangup), so we
          // mirror that here. We do *not* remove the record -- the next
          // daemon boot will see state="exited" and pass it through
          // unchanged (orphan-cleanup ignores already-terminal records).
          if (managed.record && this.daemonContext) {
            managed.record = {
              ...managed.record,
              pid: null,
              pgid: null,
              state: "exited",
              exitSignal: "SIGHUP",
            };
            this.persistRecord(managed.record);
          }
        } finally {
          release();
        }
      }),
    );
    // Ensure any buffered scrollback writes are on disk before shutdown
    // completes; the marker file is written after this returns.
    this.scrollbackLog?.flushAll();
  }

  /**
   * Restore a session from persisted AppState. Sessions that were running
   * or spawning at server/daemon exit time carry no `endReason` yet --
   * fill it in based on whether the previous shutdown was graceful
   * (marker present) or a crash (marker absent). The host context picks
   * the correct prefix: `daemon-*` when this is the host instance owned
   * by the `parasor-pty-host` daemon (PTY children belonged to the
   * daemon), `server-*` otherwise. Sessions that already have
   * `endReason` (either from an earlier process exit or from
   * `shutdownAll`) keep it.
   */
  loadPersistedSession(session: Session, wasGracefulShutdown: boolean): void {
    const fallback = sessionPolicy.deriveLoadFallbackEndReason(
      this.daemonContext !== null,
      wasGracefulShutdown,
    );
    const endReason: SessionEndReason = session.endReason ?? fallback;
    // Pick up any pre-existing record for this session from AppState so
    // restart() / dispose() / shutdownAll() round-trip correctly. If the
    // store has no matching record (in-process upgrade scenario, or the
    // previous shutdown was a crash that lost the record), leave it null
    // -- orphan-cleanup will not touch a record that does not exist.
    const existingRecord =
      this.store.get().sessionRecords.find((r) => r.id === session.id) ?? null;
    const managed: ManagedSession = {
      info: { ...session, state: "ended", pid: null, endReason },
      process: null,
      ptySize: null,
      currentGeneration: session.generation,
      attachedClients: new Map(),
      outputPaused: false,
      mutex: new PromiseMutex(),
      bootstrapInput: null,
      record: existingRecord ? structuredClone(existingRecord) : null,
    };
    this.sessions.set(session.id, managed);
    // The persisted copy from state.json may still carry `state: "running"`
    // (crash) or lack endReason; sync the corrected info so REST, WS
    // snapshots, and the on-disk state all agree.
    this.persistSession(managed.info);
  }

  onSessionData(
    callback: (sessionId: string, data: string, generation: number) => void,
  ): void {
    this.globalDataListeners.push(callback);
  }

  /**
   * Attempt a silent re-spawn, preserving the previous scrollback (so
   * the user sees continuity) plus a visible separator line that says
   * exactly when the restart happened. Caller must hold managed.mutex.
   * Returns true if re-spawn was initiated; false if the session is not
   * auto-resumable (caller should surface an error).
   */
  private autoResumeIfSafe(
    managed: ManagedSession,
    cols: number,
    rows: number,
  ): boolean {
    if (
      !sessionPolicy.isAutoResumable(
        managed.info.command,
        managed.info.endReason,
      )
    ) {
      return false;
    }

    const separator = sessionPolicy.buildRestartSeparator();
    this.scrollbackLog?.append(managed.info.id, separator);
    this.updateHeadlessState(managed.info.id, separator);

    const nextGen = managed.currentGeneration + 1;
    managed.currentGeneration = nextGen;
    this.scrollbackLog?.bumpGeneration(managed.info.id, nextGen);
    managed.info = {
      ...managed.info,
      pid: null,
      state: "spawning",
      generation: nextGen,
      endedAt: undefined,
      endReason: undefined,
    };
    managed.attachedClients.clear();
    this.persistSession(managed.info);

    // Record participates in orphan reconciliation again. Same rule as
    // restart(): same daemon, so daemonPid/daemonStartedAt stay.
    if (managed.record && this.daemonContext) {
      managed.record = {
        ...managed.record,
        pid: null,
        pgid: null,
        state: "running",
        exitCode: null,
        exitSignal: null,
        startedAt: new Date().toISOString(),
      };
      this.persistRecord(managed.record);
    }

    this.spawnProcess(managed, cols, rows);
    return true;
  }

  /**
   * Spawn the underlying PTY process and wire up its handlers. Called
   * from `initClient` (deferred spawn) and from the test-only eager path.
   * Caller must hold managed.mutex.
   */
  private spawnProcess(
    managed: ManagedSession,
    cols: number,
    rows: number,
  ): void {
    const { spawnCmd, spawnArgs } = this.resolveCommand(managed.info.command);
    const proc = pty.spawn(spawnCmd, spawnArgs, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: managed.info.cwd,
      env: this.buildSessionEnv(managed.info.id, managed.info.projectId),
    });

    managed.process = proc;
    managed.ptySize = { cols, rows };
    managed.outputPaused = false;
    managed.info = {
      ...managed.info,
      pid: proc.pid,
      state: "running",
    };
    this.persistSession(managed.info);

    // node-pty calls setsid -> the child is its own session leader and
    // the leader's pid == pgid. We can persist the same value as both
    // pid and pgid; the daemon shutdown path uses kill(-pgid, ...) to
    // kill the whole process group atomically (by design).
    if (managed.record && this.daemonContext) {
      managed.record = {
        ...managed.record,
        pid: proc.pid,
        pgid: proc.pid,
        state: "running",
        // Refresh startedAt so the record's "running" window is the
        // actual spawn time (not the create-stub time).
        startedAt: new Date().toISOString(),
      };
      this.persistRecord(managed.record);
    }

    this.attachProcHandlers(managed, managed.currentGeneration);
    const bootstrapInput = managed.bootstrapInput;
    if (bootstrapInput) {
      managed.bootstrapInput = null;
      this.write(managed.info.id, bootstrapInput, managed.currentGeneration);
    }
  }

  private attachProcHandlers(
    managed: ManagedSession,
    generationAtSpawn: number,
  ): void {
    const id = managed.info.id;

    /*
     * PTY generation gate: per-spawn batching state. `pendingData` and `flushScheduled`
     * MUST live in this closure, not on `managed`, otherwise an old-gen
     * setImmediate flush that fires AFTER auto-resume has spawned a new
     * PTY can consume bytes from the new PTY's onData handler (which
     * appends to the shared `managed.pendingData`) and either (a) misroute
     * them under the old generation through globalDataListeners or (b)
     * drop them entirely because the `generationStillCurrent` gate fires
     * `false` for the merged batch. With a per-spawn closure each generation
     * has an isolated buffer and an isolated flush slot, so old-gen flushes
     * see only old-gen bytes and new-gen flushes see only new-gen bytes.
     */
    let pendingData = "";
    let flushScheduled = false;

    managed.process?.onData((data) => {
      pendingData += data;
      if (!flushScheduled) {
        flushScheduled = true;
        setImmediate(() => {
          const batch = pendingData;
          pendingData = "";
          flushScheduled = false;

          // : 1 broadcast = 1 chunk. Compute the
          // (gen, seq) pair once per flush so every chunk-flavored
          // listener observes the same coordinates. The buffer is shared
          // across listeners -- none of them should mutate it.
          //
          // PTY generation gate: tag with the spawn-time generation, NOT the live
          // `managed.currentGeneration`. If auto-resume bumped the gen
          // between data-arrival and this setImmediate flush, the live
          // counter is already pointing at the new PTY, but every byte
          // in `batch` was emitted by the old one. Using the live gen
          // here would mis-tag old terminal-mode-query responses with
          // the new generation, defeating the whole point of PTY generation gate.
          const generation = generationAtSpawn;

          /*
           * PTY generation gate: if auto-resume bumped the gen between data-arrival
           * and this flush, skip the chunk-ring append and the live
           * client broadcast. The new ring (allocated by
           * `bumpGeneration`) must not be overwritten by an
           * `appendChunk(id, OLDGEN, ...)` that would reset it to
           * fresh state with seq=0. Newly-attached clients of the
           * new session must not see old-PTY noise.
           *
           * PTY generation gate: also skip the disk `scrollbackLog.append()`
           * when stale. Otherwise auto-resume leaves a residue of old-PTY
           * bytes in the on-disk rehydration tail -- symmetric to the
           * daemon-side drop in remote-host.ts:551. Daemon-IPC propagation
           * (globalDataListeners) still fires below with `generation`, so
           * the remote-side gate decides whether to keep or drop.
           */
          const generationStillCurrent =
            generation === managed.currentGeneration;

          let seq: bigint | null = null;
          let batchBuf: Buffer | null = null;
          if (generationStillCurrent) {
            this.scrollbackLog?.append(id, batch);
            this.updateHeadlessState(id, batch);

            let hasChunkClient = false;
            for (const client of managed.attachedClients.values()) {
              if (client.kind === "chunk") {
                hasChunkClient = true;
                break;
              }
            }
            if (hasChunkClient && this.scrollbackLog) {
              batchBuf = Buffer.from(batch, "utf8");
              seq = this.scrollbackLog.appendChunk(id, generation, batchBuf);
            }

            // Broadcast to every attached client; isolate listener faults
            // so one throwing client can't starve the others.
            for (const client of managed.attachedClients.values()) {
              try {
                if (client.kind === "string") {
                  client.listener(batch);
                } else if (seq !== null && batchBuf) {
                  client.listener(generation, seq, batchBuf);
                }
              } catch {
                // ignore listener errors to keep broadcast loop alive
              }
            }
          }

          // same isolation as attached-client listeners.
          // A throwing global listener (debug recorder, scrollback log) used
          // to leak as an uncaught exception inside setImmediate.
          for (const listener of this.globalDataListeners) {
            try {
              listener(id, batch, generation);
            } catch {
              // ignore listener errors
            }
          }
        });
      }
    });

    // node-pty's onExit handler treats the callback
    // return value as fire-and-forget. If we hand it an async function
    // and any await inside rejects (mutex.acquire, persistSession,
    // persistRecord), the rejection becomes an unhandledRejection. Wrap
    // the body in a sync function that explicitly catches the inner
    // promise so onExit cannot bubble.
    managed.process?.onExit(({ exitCode, signal }) => {
      void (async () => {
        const release = await managed.mutex.acquire();
        try {
          if (!this.sessions.has(id)) return;
          if (managed.currentGeneration !== generationAtSpawn) return;
          // shutdownAll/dispose already set state=ended and recorded the
          // authoritative endReason; don't overwrite it with the kill signal
          // that happens to fire afterwards.
          if (managed.info.state === "ended") return;
          const endReason: SessionEndReason = sessionPolicy.deriveEndReason(
            signal,
            exitCode,
          );
          managed.info = {
            ...managed.info,
            state: "ended",
            pid: null,
            endedAt: Date.now(),
            endReason,
          };
          managed.process = null;
          // : notify binary-capable clients via the EXIT
          // chunk-listener channel. Legacy string clients learn about
          // exit via /ws/events SESSION_END (existing behavior).
          const numericExit =
            typeof exitCode === "number" && Number.isFinite(exitCode)
              ? exitCode
              : 0;
          for (const client of managed.attachedClients.values()) {
            if (client.kind === "chunk" && client.onExit) {
              try {
                client.onExit(numericExit);
              } catch {
                // ignore listener faults; broadcast loop is dead anyway
              }
            }
          }
          this.persistSession(managed.info);
          // Record the natural exit. node-pty exposes `signal` as a
          // numeric POSIX signal (or undefined when the child exited
          // normally); the SessionRecord schema stores the signal *name*
          // and a `number | null` exit code. deriveRecordExit coerces both
          // (null exit code when killed, `SIG<n>` for unmapped signals).
          if (managed.record && this.daemonContext) {
            const { exitCode: recordExitCode, exitSignal } =
              sessionPolicy.deriveRecordExit(exitCode, signal);
            managed.record = {
              ...managed.record,
              pid: null,
              pgid: null,
              state: "exited",
              exitCode: recordExitCode,
              exitSignal,
            };
            this.persistRecord(managed.record);
          }
          this.onSessionExit?.(id, generationAtSpawn, endReason);
        } finally {
          release();
        }
      })().catch(() => {
        // Last-resort guard -- anything thrown inside the body (e.g. a
        // future store.mutateSessions() rejection) gets swallowed so node-pty
        // doesn't see an unhandledRejection-shaped event.
      });
    });
  }

  private persistSession(info: Session): void {
    this.store.mutateSessions((s) => {
      const idx = s.sessions.findIndex((sess) => sess.id === info.id);
      if (idx >= 0) {
        s.sessions[idx] = structuredClone(info);
      } else {
        s.sessions.push(structuredClone(info));
      }
    });
  }

  /**
   * Upsert a SessionRecord into AppState. Mirror of `persistSession` for
   * the daemon-orphan-tracking side of the data model. Caller must hold
   * managed.mutex (record updates are interleaved with session updates,
   * single-record-per-session invariant guards against torn writes).
   */
  private persistRecord(record: SessionRecord): void {
    this.store.mutateSessions((s) => {
      const idx = s.sessionRecords.findIndex((rec) => rec.id === record.id);
      if (idx >= 0) {
        s.sessionRecords[idx] = structuredClone(record);
      } else {
        s.sessionRecords.push(structuredClone(record));
      }
    });
  }

  /**
   * Test-only eager spawn. Production code path is always deferred via
   * `initClient`. This helper exists so unit tests that need a live PTY
   * without a WebSocket can still drive the manager.
   */
  async testEagerSpawn(id: string, cols = 80, rows = 24): Promise<void> {
    const managed = this.sessions.get(id);
    if (!managed) throw new Error(`Session ${id} not found`);
    const release = await managed.mutex.acquire();
    try {
      if (managed.info.state !== "spawning") return;
      this.spawnProcess(managed, cols, rows);
    } finally {
      release();
    }
  }

  private resolveCommand(command: SessionCommand): {
    spawnCmd: string;
    spawnArgs: string[];
  } {
    return sessionPolicy.resolveSessionCommand(command, {
      bashRcPath: this.ptyEnv.PARASOR_BASH_RC,
    });
  }
}

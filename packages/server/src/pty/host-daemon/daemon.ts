import { Buffer } from "node:buffer";
import type { AppStateStore } from "../../state/app-state.js";
import type { PtyHost } from "../host.js";
import {
  decodeGenerationStreamPayload,
  encodeGenerationStreamPayload,
  encodeStreamPayload,
  type Frame,
  FrameType,
} from "../host-protocol/frames.js";
import {
  type CreateAckPayload,
  type CreateReqPayload,
  type DetachClientPayload,
  type DisposeReqPayload,
  decodeJsonPayload,
  type EmptyAckPayload,
  encodeJsonPayload,
  type FlowControlPayload,
  type HelloAckPayload,
  type HelloPayload,
  type InitClientAckPayload,
  type InitClientReqPayload,
  isCompatibleVersion,
  type NackCode,
  type PersistProjectDomainsReqPayload,
  PROTOCOL_VERSION,
  type RefreshPayload,
  type ResizePayload,
  type RestartReqPayload,
  type SessionExitPayload,
  type SessionListPayload,
  type SessionUpdatePayload,
  type SetPinnedPayload,
  type SetPtyEnvPayload,
  type SetTitlePayload,
} from "../host-protocol/messages.js";
import { ServerConnection } from "./server-connection.js";

/*
 * PtyHostDaemon -- single-server-connection daemon shell around a PtyHost.
 *
 * Composition over inheritance: the daemon
 * owns an in-process `PtyHost` engine and adds an IPC frontend on top,
 * rather than re-implementing session management. The same code path
 * therefore runs in single-process and daemon-split deployments.
 *
 * "Single server" means at most one server may be the *current* peer at
 * a time. A new HELLO from a fresh socket evicts the prior current with
 * `evicted` NACK. We do NOT reject a connect attempt before HELLO -- the
 * server may probe-connect on startup and we want that to be cheap. See
 * by design
 *
 * Epoch fencing: every (connectionId, generation) pair is unique for the
 * lifetime of the daemon. Frames carrying an outdated pair are silently
 * dropped. The fence is checked at frame *parse* time (in dispatcher)
 * and again at frame *commit* time for async ACK paths (CREATE/RESTART/
 * DISPOSE) so a slow request from a now-evicted server cannot corrupt
 * mirror state. stages 1 and 3 of the four-stage fence.
 *
 * What this file does NOT do (yet):
 *   - Bind a Unix-domain socket / lockfile
 *   - Run the data-fan-out side of INIT_CLIENT routing across multiple
 *     servers (single-server invariant means clientId is plumbed through
 *     directly to PtyHost.initClient -- there is no "broadcast to other
 *     servers" because there is at most one)
 *   - SESSION_LIST snapshot on reconnect
 *
 * Shutdown: callers invoke `dispose()` to evict the current connection
 * and stop the broadcast subscriptions. The owned PtyHost is left alive
 * -- the caller decides whether to terminate sessions (in-process) or
 * leave them parked (true daemon mode).
 */

export interface PtyHostDaemonDeps {
  host: PtyHost;
  daemonPid?: number;
  daemonStartedAt?: string;
  /**
   * daemon state ownership -- store the daemon writes when it adopts a server-pushed
   * project-domain snapshot via PERSIST_PROJECT_DOMAINS_REQ. Optional
   * because in-process tests / phase1 fixtures may not need the
   * persistence handler. When omitted, the request is NACK'd with
   * `internal-error` so misconfiguration surfaces loudly instead of
   * silently dropping mutations.
   */
  store?: AppStateStore;
}

export class PtyHostDaemon {
  private readonly host: PtyHost;
  private readonly store: AppStateStore | null;
  private readonly daemonPid: number;
  private readonly daemonStartedAt: string;
  private currentServer: ServerConnection | null = null;
  private nextConnectionId = 1;
  private nextGeneration = 1n;
  private disposed = false;
  /*
   * -- in-flight host operations (CREATE_REQ /
   * RESTART_REQ / DISPOSE_REQ / DISPOSE_ALL_REQ / INIT_CLIENT_REQ) hold
   * Promises whose `.then`/`.catch` handlers run on the microtask queue
   * after `dispose()` has already flagged shutdown. If we tear the host
   * down (`shutdownAll`) before those handlers settle, a CREATE that
   * raced just before SIGTERM will spawn its PTY and persist its
   * SessionRecord *after* shutdownAll has stamped every other session
   * "ended", leaving an orphan. We track every host-call chain and
   * `drain()` waits for them all to settle so bootstrap can sequence
   * shutdownAll -> flush -> marker -> destroy without that race.
   */
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(deps: PtyHostDaemonDeps) {
    this.host = deps.host;
    this.store = deps.store ?? null;
    this.daemonPid = deps.daemonPid ?? process.pid;
    this.daemonStartedAt = deps.daemonStartedAt ?? new Date().toISOString();

    /*
     * Single global subscription on the engine. The daemon broadcasts to
     * the *current* server only -- there is at most one. Per-client fan-
     * out (INIT_CLIENT_REQ tagging different clientIds) is a server-side
     * concern; daemon-side every server attach is one logical client of
     * the engine, distinguished only by its server-supplied clientId.
     */
    this.host.onSessionData((sessionId, data, generation) => {
      // PTY generation gate: tag DATA frames with the producing PTY's generation so
      // the remote-side WS layer can echo it back on INPUT and the
      // daemon-side `handleWrite` gate can drop stale input.
      this.broadcastDataStream(sessionId, data, generation);
    });
    this.host.onSessionInput((sessionId, data) => {
      this.broadcastStream(FrameType.SESSION_INPUT, sessionId, data);
    });
    this.host.onSessionExit = (sessionId, sessionGeneration, endReason) => {
      this.broadcastJson(FrameType.SESSION_EXIT, 0, {
        sessionId,
        sessionGeneration,
        endReason,
      } satisfies SessionExitPayload);
    };
  }

  /**
   * Hand the daemon a freshly-accepted IPC socket. The peer is expected
   * to send HELLO as its first frame; until then the connection sits in
   * `awaiting-hello` and is not yet considered current.
   *
   * Eviction is deferred to HELLO time so that a probe connect (e.g. the
   * server's startup health check) doesn't kick off the previous current.
   */
  acceptConnection(socket: import("node:stream").Duplex): ServerConnection {
    if (this.disposed) {
      socket.end();
      throw new Error("PtyHostDaemon.acceptConnection: daemon disposed");
    }
    const conn: ServerConnection = new ServerConnection({
      socket,
      connectionId: this.nextConnectionId++,
      generation: this.nextGeneration++,
      onFrame: (c, frame) => this.handleFrame(c, frame),
      onClose: (c) => this.handleConnectionClosed(c),
    });
    return conn;
  }

  /**
   * Stop accepting frames and evict the current peer with a shutdown
   * NACK so it knows not to try to reconnect. Does NOT terminate the
   * underlying PtyHost -- that's the caller's call (see by design
   * the in-process vs daemon-mode shutdown semantics divergence).
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.currentServer) {
      this.currentServer.evict(
        "daemon-shutting-down",
        "daemon is shutting down",
      );
      this.currentServer = null;
    }
  }

  /**
   * Wait for every host-call chain currently in flight to settle. Caller
   * (bootstrap.shutdown) runs this between `dispose()` and `host.shutdownAll()`
   * so a CREATE that won the race against SIGTERM finishes its persist
   * step before shutdownAll iterates `this.sessions`. New frames are
   * already blocked at this point: `dispose()` evicts the current peer
   * and the listening sockets are closed in bootstrap before drain runs,
   * so `inFlight` is monotonically shrinking.
   *
   * Bounded by `timeoutMs` (default 3s) so a hung host call (network
   * filesystem stall, disk timeout) cannot block the entire shutdown
   * path -- `shutdownAll`, marker write, and lock release all need to
   * run for the user to recover (). On timeout
   * the pending chains keep running but are no longer awaited; they
   * will settle against a destroyed store and best-effort log the loss.
   * Returns `true` when fully drained, `false` on timeout.
   */
  async drain(timeoutMs = 3000): Promise<boolean> {
    if (this.inFlight.size === 0) return true;
    const all = Promise.allSettled([...this.inFlight]).then(() => true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([all, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Track a host-call chain (the full Promise including its `.then`/`.catch`
   * handlers, not just the host's underlying Promise). Removes itself on
   * settle so the `Set` does not leak.
   */
  private track(promise: Promise<unknown>): void {
    this.inFlight.add(promise);
    const cleanup = (): void => {
      this.inFlight.delete(promise);
    };
    promise.then(cleanup, cleanup);
  }

  // --- frame dispatcher ---

  private handleFrame(conn: ServerConnection, frame: Frame): void {
    if (frame.type === FrameType.HELLO) {
      this.handleHello(conn, frame);
      return;
    }
    if (conn.getState() !== "ready") {
      conn.evict("handshake-required", "frame received before HELLO");
      return;
    }
    if (
      frame.connectionId !== conn.connectionId ||
      frame.generation !== conn.generation
    ) {
      // Peer is sending stale/forged headers. Drop the connection -- we
      // can't trust anything more from it.
      conn.evict("frame-invalid", "header epoch mismatch");
      return;
    }
    /*
     * Stage-1 fence (by design): is the *connection itself* still the
     * current one? If a newer peer has already taken over, drop the
     * frame silently. The previous peer was already NACKed `evicted`
     * when it lost its slot.
     */
    if (this.currentServer !== conn) return;

    try {
      this.dispatchReady(conn, frame);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.replyNack(conn, frame.requestId, "internal-error", message);
    }
  }

  private handleHello(conn: ServerConnection, frame: Frame): void {
    let payload: HelloPayload;
    try {
      payload = decodeJsonPayload<HelloPayload>(frame.payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid HELLO json";
      conn.evict("frame-invalid", message);
      return;
    }
    if (!isCompatibleVersion(payload.protocolVersion, PROTOCOL_VERSION)) {
      conn.evict(
        "version-mismatch",
        `server ${payload.protocolVersion} not compatible with daemon ${PROTOCOL_VERSION}`,
      );
      return;
    }

    // Evict the previous current -- but only now, after we've decided we
    // accept this one. A malformed HELLO would have failed above, leaving
    // any prior current intact.
    if (this.currentServer && this.currentServer !== conn) {
      this.currentServer.evict("evicted", "superseded by newer server");
    }
    this.currentServer = conn;
    conn.markReady();

    const ack: HelloAckPayload = {
      protocolVersion: PROTOCOL_VERSION,
      connectionId: conn.connectionId,
      generation: conn.generation.toString(),
      daemonPid: this.daemonPid,
      daemonStartedAt: this.daemonStartedAt,
    };
    conn.send({
      type: FrameType.HELLO_ACK,
      requestId: frame.requestId,
      payload: encodeJsonPayload(ack),
    });

    // reconnect 後 SESSION_LIST で snapshot 再構築. Emit a
    // full snapshot of currently-known sessions immediately so the
    // freshly-attached server's mirror reflects daemon-side reality
    // before any per-session SESSION_UPDATE/SESSION_EXIT broadcast lands.
    // Without this, a server that reconnects to a daemon with live PTYs
    // would see an empty list() until the next state change broadcast,
    // turning live agents into "phantom orphans" from the routes' view.
    const snapshot: SessionListPayload = { sessions: this.host.list() };
    conn.send({
      type: FrameType.SESSION_LIST,
      requestId: 0,
      payload: encodeJsonPayload(snapshot),
    });
  }

  private dispatchReady(conn: ServerConnection, frame: Frame): void {
    switch (frame.type) {
      case FrameType.CREATE_REQ:
        this.handleCreate(conn, frame);
        return;
      case FrameType.RESTART_REQ:
        this.handleRestart(conn, frame);
        return;
      case FrameType.DISPOSE_REQ:
        this.handleDispose(conn, frame);
        return;
      case FrameType.DISPOSE_ALL_REQ:
        this.handleDisposeAll(conn, frame);
        return;
      case FrameType.SHUTDOWN_ALL_REQ:
        this.handleShutdownAll(conn, frame);
        return;
      case FrameType.INIT_CLIENT_REQ:
        this.handleInitClient(conn, frame);
        return;
      case FrameType.WRITE:
        this.handleWrite(frame);
        return;
      case FrameType.RESIZE:
        this.handleResize(frame);
        return;
      case FrameType.REFRESH:
        this.handleRefresh(frame);
        return;
      case FrameType.PAUSE_OUTPUT:
        this.handlePauseOutput(frame);
        return;
      case FrameType.RESUME_OUTPUT:
        this.handleResumeOutput(frame);
        return;
      case FrameType.DETACH_CLIENT:
        this.handleDetachClient(frame);
        return;
      case FrameType.SET_TITLE:
        this.handleSetTitle(conn, frame);
        return;
      case FrameType.SET_PINNED:
        this.handleSetPinned(conn, frame);
        return;
      case FrameType.SET_PTY_ENV:
        this.handleSetPtyEnv(frame);
        return;
      case FrameType.PERSIST_PROJECT_DOMAINS_REQ:
        this.handlePersistProjectDomains(conn, frame);
        return;
      default:
        this.replyNack(
          conn,
          frame.requestId,
          "unknown-frame-type",
          `unknown frame type 0x${frame.type.toString(16)}`,
        );
        return;
    }
  }

  // --- request -> ack handlers (Promise<X>-returning host methods) ---

  private handleCreate(conn: ServerConnection, frame: Frame): void {
    const req = decodeJsonPayload<CreateReqPayload>(frame.payload);
    const chain = this.host
      .create({
        projectId: req.projectId,
        command: req.command,
        cwd: req.cwd,
        title: req.title,
        bootstrapInput: req.bootstrapInput,
      })
      .then((session) => {
        // commit step splits into ACK gate and
        // broadcast pivot. ACK only goes back if the requester is still
        // current; the SESSION_UPDATE always fans to whoever is current
        // (= new peer if the requester was evicted mid-await). That way
        // the post-eviction successor sees the side-effect via its own
        // mirror reconciliation and  reconnect-resync holds.
        if (this.fenceCommit(conn)) {
          const ack: CreateAckPayload = { session };
          conn.send({
            type: FrameType.CREATE_ACK,
            requestId: frame.requestId,
            payload: encodeJsonPayload(ack),
          });
        }
        this.broadcastSessionUpdate(session);
      })
      .catch((err) => {
        if (!this.fenceCommit(conn)) return;
        this.replyNack(
          conn,
          frame.requestId,
          "create-failed",
          err instanceof Error ? err.message : String(err),
        );
      });
    this.track(chain);
  }

  private handleRestart(conn: ServerConnection, frame: Frame): void {
    const req = decodeJsonPayload<RestartReqPayload>(frame.payload);
    const chain = this.host
      .restart(req.sessionId)
      .then((session) => {
        // broadcast pivot is unconditional so the
        // restart's mutated state propagates to whoever is current,
        // even if the original requester was evicted mid-await.
        if (this.fenceCommit(conn)) {
          conn.send({
            type: FrameType.RESTART_ACK,
            requestId: frame.requestId,
            payload: encodeJsonPayload({ session }),
          });
        }
        this.broadcastSessionUpdate(session);
      })
      .catch((err) => {
        if (!this.fenceCommit(conn)) return;
        this.replyNack(
          conn,
          frame.requestId,
          "restart-failed",
          err instanceof Error ? err.message : String(err),
        );
      });
    this.track(chain);
  }

  private handleDispose(conn: ServerConnection, frame: Frame): void {
    const req = decodeJsonPayload<DisposeReqPayload>(frame.payload);
    const chain = this.host
      .dispose(req.sessionId)
      .then(() => {
        // InProcessPtyHost.dispose() removes the
        // session silently (no onSessionExit emit). To keep the current
        // peer's mirror in sync, fan a fresh SESSION_LIST snapshot. This
        // also covers the post-eviction case where the requester is gone
        // and the new peer has the now-stale session in its initial
        // snapshot.
        if (this.fenceCommit(conn)) {
          const ack: EmptyAckPayload = {};
          conn.send({
            type: FrameType.DISPOSE_ACK,
            requestId: frame.requestId,
            payload: encodeJsonPayload(ack),
          });
        }
        this.broadcastSessionListSnapshot();
      })
      .catch((err) => {
        if (!this.fenceCommit(conn)) return;
        this.replyNack(
          conn,
          frame.requestId,
          "internal-error",
          err instanceof Error ? err.message : String(err),
        );
      });
    this.track(chain);
  }

  private handleDisposeAll(conn: ServerConnection, frame: Frame): void {
    const chain = this.host
      .disposeAll()
      .then(() => {
        // same broadcast pivot as handleDispose, but
        // for every session.
        if (this.fenceCommit(conn)) {
          conn.send({
            type: FrameType.DISPOSE_ALL_ACK,
            requestId: frame.requestId,
            payload: encodeJsonPayload({} satisfies EmptyAckPayload),
          });
        }
        this.broadcastSessionListSnapshot();
      })
      .catch((err) => {
        if (!this.fenceCommit(conn)) return;
        this.replyNack(
          conn,
          frame.requestId,
          "internal-error",
          err instanceof Error ? err.message : String(err),
        );
      });
    this.track(chain);
  }

  private handleShutdownAll(conn: ServerConnection, frame: Frame): void {
    /*
     * By protocol, `shutdownAll` is detach-
     * only: do NOT terminate the PTYs, just close the IPC link so the
     * server stops getting events. We keep the engine alive so a future
     * server reconnect can resume. The dedicated `terminateAll` CLI
     * command is the way to actually stop sessions remotely.
     */
    if (!this.fenceCommit(conn)) return;
    conn.send({
      type: FrameType.SHUTDOWN_ALL_ACK,
      requestId: frame.requestId,
      payload: encodeJsonPayload({} satisfies EmptyAckPayload),
    });
    conn.evict("evicted", "server requested shutdownAll detach");
  }

  private handleInitClient(conn: ServerConnection, frame: Frame): void {
    const req = decodeJsonPayload<InitClientReqPayload>(frame.payload);
    /*
     * Single-server invariant means there is exactly one server fanning
     * the engine's per-session output to its WebSocket clients. The
     * daemon's job is to spawn the PTY on first attach and pipe the
     * engine's broadcasts back; per-client demuxing happens in the
     * server. We register a no-op listener here because the global
     * `onSessionData` subscription already delivers DATA frames.
     */
    const chain = this.host
      .initClient(
        req.sessionId,
        req.clientId,
        req.cols,
        req.rows,
        () => {
          // Output is broadcast via the global onSessionData subscription --
          // this listener is just a presence flag for InProcessPtyHost so
          // it knows a client is attached and can run its scrollback dump.
        },
        req.attachToken,
      )
      .then((result) => {
        if (!this.fenceCommit(conn)) return;
        const ack: InitClientAckPayload = { accepted: result.ok };
        conn.send({
          type: FrameType.INIT_CLIENT_ACK,
          requestId: frame.requestId,
          payload: encodeJsonPayload(ack),
        });
        if (result.ok) this.maybeBroadcastSessionUpdate(conn, req.sessionId);
      })
      .catch((err) => {
        if (!this.fenceCommit(conn)) return;
        this.replyNack(
          conn,
          frame.requestId,
          "internal-error",
          err instanceof Error ? err.message : String(err),
        );
      });
    this.track(chain);
  }

  // --- fire-and-forget mutators (no ack, optimistic mirror reconciles via SESSION_UPDATE) ---

  private handleWrite(frame: Frame): void {
    /*
     * PTY generation gate: payload is the generation-tagged stream variant
     * (`[idLen:u8][sessionId][gen:u32 BE][raw bytes]`). `gen=0` is the
     * sentinel meaning "no gating" -- pass undefined to the host so the
     * gate stays open (initial pre-init-ack queued INPUT, legacy
     * non-WS callers). Any other value flows into the host's drop
     * gate; a mismatch with the live currentGeneration drops the
     * write.
     */
    let decoded: ReturnType<typeof decodeGenerationStreamPayload>;
    try {
      decoded = decodeGenerationStreamPayload(frame.payload);
    } catch {
      return;
    }
    const data = decoded.data.toString("utf8");
    this.host.write(
      decoded.sessionId,
      data,
      decoded.generation === 0 ? undefined : decoded.generation,
    );
  }

  private handleResize(frame: Frame): void {
    const req = decodeJsonPayload<ResizePayload>(frame.payload);
    this.host.resize(req.sessionId, req.cols, req.rows);
  }

  private handleRefresh(frame: Frame): void {
    const req = decodeJsonPayload<RefreshPayload>(frame.payload);
    this.host.refresh(req.sessionId);
  }

  private handlePauseOutput(frame: Frame): void {
    const req = decodeJsonPayload<FlowControlPayload>(frame.payload);
    this.host.pauseOutput(req.sessionId, req.clientId);
  }

  private handleResumeOutput(frame: Frame): void {
    const req = decodeJsonPayload<FlowControlPayload>(frame.payload);
    this.host.resumeOutput(req.sessionId, req.clientId);
  }

  private handleDetachClient(frame: Frame): void {
    const req = decodeJsonPayload<DetachClientPayload>(frame.payload);
    this.host.detachClient(req.sessionId, req.clientId, req.attachToken);
  }

  private handleSetTitle(conn: ServerConnection, frame: Frame): void {
    const req = decodeJsonPayload<SetTitlePayload>(frame.payload);
    const ok = this.host.setTitle(
      req.sessionId,
      req.title,
      req.titleManual === true,
    );
    if (ok) this.maybeBroadcastSessionUpdate(conn, req.sessionId);
  }

  private handleSetPinned(conn: ServerConnection, frame: Frame): void {
    const req = decodeJsonPayload<SetPinnedPayload>(frame.payload);
    const ok = this.host.setPinned(req.sessionId, req.pinned);
    if (ok) this.maybeBroadcastSessionUpdate(conn, req.sessionId);
  }

  private handleSetPtyEnv(frame: Frame): void {
    const req = decodeJsonPayload<SetPtyEnvPayload>(frame.payload);
    this.host.setPtyEnv(req.env);
  }

  /*
   * daemon state ownership -- adopt the server's project-domain snapshot and persist it.
   * The daemon is the sole writer of state.json; the server forwards
   * its in-memory `projects` / `projectStates` / `serviceConfig` /
   * `paneCommands` / `ideCommands` here
   * whenever the in-store debounce timer fires. We use `internalMutate`
   * because (a) in remote-mode the daemon's session-domain guard is
   * never actually flipped on (only server-side copies set it) but the
   * intent is identical to the orphan reconciler at boot -- adopt then
   * flush; (b) it routes through the existing scheduleFlush so the
   * daemon's own session writes coalesce with this snapshot. ACK gates
   * on the flush completing so the server's request promise reflects
   * IO success.
   */
  private handlePersistProjectDomains(
    conn: ServerConnection,
    frame: Frame,
  ): void {
    if (!this.store) {
      this.replyNack(
        conn,
        frame.requestId,
        "persist-failed",
        "daemon has no AppStateStore configured for persistence",
      );
      return;
    }
    /*
     * -- three-step fence-and-drain protocol so
     * an evicted-mid-drain request cannot clobber the new server's
     * snapshot:
     *
     *   1. fence-on-arrival: cheap reject for already-evicted senders.
     *   2. drain-first:      await any in-flight write (previous PERSIST
     *                        or daemon session-domain debounce) so the
     *                        next mutate+write is atomic from the
     *                        store's POV.
     *   3. fence-after-drain: if the conn was evicted while we awaited
     *                        the drain, the in-flight snapshot is no
     *                        longer authoritative -- drop it silently.
     *                        The new server already has its own state
     *                        and will send a fresh PERSIST.
     *
     * Mutate+write happens between (3) and the post-handler fence; both
     * are sync (internalMutate is sync; daemon-store write() is
     * writeFileSync, no delegate), so eviction cannot slip between
     * them. Project-domain snapshots are SERVER-owned, so adopting an
     * evicted snapshot would roll back project / projectStates /
     * serviceConfig / paneCommands / ideCommands writes the new server already
     * made.
     */
    if (!this.fenceCommit(conn)) return;
    const req = decodeJsonPayload<PersistProjectDomainsReqPayload>(
      frame.payload,
    );
    const store = this.store;
    const chain = (async (): Promise<"committed" | "evicted-during-drain"> => {
      await store.flush();
      if (!this.fenceCommit(conn)) return "evicted-during-drain";
      store.internalMutate((state) => {
        state.projects = req.projects;
        state.projectStates = req.projectStates;
        state.serviceConfig = req.serviceConfig;
        if (Array.isArray(req.paneCommands)) {
          state.paneCommands = req.paneCommands;
        }
        if (Array.isArray(req.ideCommands)) {
          state.ideCommands = req.ideCommands;
        }
      });
      await store.flush();
      return "committed";
    })()
      .then((result) => {
        if (result === "evicted-during-drain") return;
        if (!this.fenceCommit(conn)) return;
        conn.send({
          type: FrameType.PERSIST_PROJECT_DOMAINS_ACK,
          requestId: frame.requestId,
          payload: encodeJsonPayload({} satisfies EmptyAckPayload),
        });
      })
      .catch((err) => {
        if (!this.fenceCommit(conn)) return;
        this.replyNack(
          conn,
          frame.requestId,
          "persist-failed",
          err instanceof Error ? err.message : String(err),
        );
      });
    this.track(chain);
  }

  // --- broadcast helpers ---

  private broadcastJson(
    type: number,
    requestId: number,
    payload: unknown,
  ): void {
    const conn = this.currentServer;
    if (!conn || conn.getState() !== "ready") return;
    conn.send({ type, requestId, payload: encodeJsonPayload(payload) });
  }

  private broadcastStream(type: number, sessionId: string, data: string): void {
    const conn = this.currentServer;
    if (!conn || conn.getState() !== "ready") return;
    conn.send({
      type,
      requestId: 0,
      payload: encodeStreamPayload(sessionId, Buffer.from(data, "utf8")),
    });
  }

  private broadcastDataStream(
    sessionId: string,
    data: string,
    generation: number,
  ): void {
    const conn = this.currentServer;
    if (!conn || conn.getState() !== "ready") return;
    conn.send({
      type: FrameType.DATA,
      requestId: 0,
      payload: encodeGenerationStreamPayload(
        sessionId,
        Buffer.from(data, "utf8"),
        generation,
      ),
    });
  }

  private broadcastSessionUpdate(
    session: import("@parasor/shared").Session,
  ): void {
    this.broadcastJson(FrameType.SESSION_UPDATE, 0, {
      session,
    } satisfies SessionUpdatePayload);
  }

  /**
   * Send a fresh SESSION_LIST snapshot to the current peer. Used by
   * dispose paths because InProcessPtyHost.dispose() removes the session
   * silently, so neither SESSION_UPDATE nor SESSION_EXIT carries the
   * removal -- we instead resync via a full snapshot. Cheap: list() is
   * just a Map values() copy.
   */
  private broadcastSessionListSnapshot(): void {
    this.broadcastJson(FrameType.SESSION_LIST, 0, {
      sessions: this.host.list(),
    } satisfies SessionListPayload);
  }

  private maybeBroadcastSessionUpdate(
    conn: ServerConnection,
    sessionId: string,
  ): void {
    if (this.currentServer !== conn) return;
    const session = this.host.get(sessionId);
    if (session) this.broadcastSessionUpdate(session);
  }

  // --- fence + nack helpers ---

  /**
   * Stage-3 fence (by design): called from async ack callbacks. If the
   * connection that issued the request is no longer current, drop the
   * ack -- its server has been evicted and any reply would arrive with
   * a stale (connectionId, generation) pair the new peer would reject.
   */
  private fenceCommit(conn: ServerConnection): boolean {
    return this.currentServer === conn && conn.getState() === "ready";
  }

  private replyNack(
    conn: ServerConnection,
    requestId: number,
    code: NackCode,
    message: string,
  ): void {
    conn.send({
      type: FrameType.NACK,
      requestId,
      payload: encodeJsonPayload({ code, message }),
    });
  }

  private handleConnectionClosed(conn: ServerConnection): void {
    if (this.currentServer === conn) this.currentServer = null;
  }
}

import type * as net from "node:net";
import type {
  Session,
  SessionCommand,
  SessionEndReason,
  SessionLaunchPreset,
  TerminalCapabilities,
  TerminalLastSeen,
  TerminalReplayKind,
  TerminalServerState,
} from "@parasor/shared";
import type { AppStateStore } from "../state/app-state.js";
import type { InProcessPtyHostDaemonContext } from "./in-process-host.js";
import type { ScrollbackLog } from "./scrollback-log.js";

/**
 * Capability declaration sent to `attachClient` on a fresh WS attach.
 * `lastSeen` is the cursor stored in the client's `sessionStorage` and
 * applies only when `chunkedReplay=true`.
 */
export interface AttachClientCapabilities {
  binary: boolean;
  chunkedReplay: boolean;
  lastSeen?: TerminalLastSeen;
}

/**
 * Result of a successful binary-capable `attachClient`. The host has
 * already (atomically) registered the chunk listener for live broadcasts,
 * computed the replay decision, and pre-loaded the chunks/payload the
 * caller should hand to the WS client.
 *
 * `attachClient` receives the attaching client's dimensions, but those
 * dimensions are authoritative only for first spawn and safe auto-resume.
 * Passive attach to an already-running shared PTY must not resize it;
 * later size changes flow through the explicit `resize()` method.
 *
 * -- the WS layer must emit init-
 * ack first, then either (a) the JSON `replay` envelope (`replay="full"`)
 * or (b) the binary OUTPUT frames in `chunks` (`replay="delta"`), or
 * neither (`replay="none"`), before live OUTPUT can begin arriving.
 */
export interface AttachClientResponse {
  ok: true;
  capabilities: TerminalCapabilities;
  serverState: TerminalServerState;
  replay: TerminalReplayKind;
  /** Populated when `replay === "delta"`. Already in seq order. */
  chunks?: ReadonlyArray<{ generation: number; seq: bigint; data: Buffer }>;
  /** Populated when `replay === "full"`. UTF-8 string. */
  fullReplay?: string;
  replayDiagnostics?: {
    source:
      | "headless-state"
      | "headless-rebuild"
      | "headless-snapshot"
      | "headless-fallback"
      | "raw-tail";
    rawBytes: number;
    replayBytes: number;
    headlessDurationMs?: number;
    headlessBufferLines?: number;
    headlessEmittedLines?: number;
    scrollbackLines?: number;
    maxBytes?: number;
  };
  /**
   * Attach fencing fence -- monotonic identifier for this attach.
   * The WS handler stashes it in its per-WS state and hands it back via
   * `detachClient(..., expectedToken)` so a stale onClose firing after a
   * new attach (same `clientId`) cannot wipe the new listener.
   */
  attachToken: number;
}

export type AttachClientResult = AttachClientResponse | { ok: false };

/**
 * Listener pair for binary-capable clients. The PTY broadcast site fires
 * `onChunk` once per batched flush (1 broadcast = 1 seq), and `onExit`
 * once when the PTY exits. Listener faults are isolated by the host so
 * one bad sink does not starve siblings.
 */
export interface AttachClientSink {
  onChunk: (generation: number, seq: bigint, data: Buffer) => void;
  onExit?: (exitCode: number) => void;
}

/**
 * Inputs for `PtyHost.create()`. Shared by `InProcessPtyHost` and
 * `RemotePtyHost`; kept here so the interface is independent of any one
 * implementation.
 */
export interface CreateSessionInput {
  projectId: string;
  command: SessionCommand;
  cwd: string;
  title?: string;
  launchPreset?: SessionLaunchPreset;
  bootstrapInput?: string;
}

export type PtyHostMode = "in-process" | "remote";

/**
 * Abstract PTY host.
 *
 * Two implementations:
 * - `InProcessPtyHost`: owns the PTY descriptors
 *   directly inside the server process.
 * - `RemotePtyHost`: proxies the same API over a local Unix socket to the
 *   `parasor-pty-host` daemon.
 *
 * The factory `createPtyHost()` picks the implementation from the
 * `PARASOR_PTY_DAEMON` env. Daemon mode is the default (auto-spawned on
 * first use, detached so it survives foreground parasor restarts) so
 * that npm-style updates and freeze-recovery restarts can preserve PTY
 * children. Set `PARASOR_PTY_DAEMON=0` to opt back into in-process mode
 * (used by `pnpm dev` to keep the daemon socket scoped to the dev
 * tsx-watch process and avoid colliding with a production daemon).
 *
 * --- Consistency contract ---
 *
 * Liskov substitutability is governed by the table below. Callers
 * should be tolerant of `RemotePtyHost`-specific failure modes; the
 * in-process path is the strict / safe-side baseline.
 *
 * | Aspect              | InProcess              | Remote (connected)                              | Remote (reconnecting)                         |
 * | ------------------- | ---------------------- | ----------------------------------------------- | --------------------------------------------- |
 * | list()/get()        | sync, always latest    | mirror, up to last SESSION_LIST                 | stale possible; do not trust after `reconnecting` |
 * | create() ack order  | sync return            | resolves on IPC ack (may precede SESSION_UPDATE)| in-flight rejected (epoch fence, )          |
 * | initClient() errors | spawn failures only    | + ipc-timeout / version-mismatch / evicted      | + connection-dropped                          |
 * | state event order   | strict (sync emit)     | best-effort (commit < ack < broadcast)          | snapshot rebuild on reconnect                 |
 * | failure type        | Error                  | Error or RemotePtyHostError(code)               | RemotePtyHostError(code: "reconnecting")      |
 *
 * `shutdownAll()` carries two meanings:
 * - in-process: kills every live PTY and persists `server-graceful` end
 *   reasons so sessions can be restored on next start.
 * - remote: `detach()` only -- closes the IPC connection but leaves
 *   daemon-side sessions alive. Use the dedicated `terminateAll()` CLI
 *   command to actually SIGTERM all daemon-side sessions.
 *   The interface today exposes `shutdownAll()` semantics matching
 *   in-process; the remote implementation will widen this when added.
 */
export interface PtyHost {
  /** Merge env vars into the per-PTY environment. Subsequent calls accumulate. */
  setPtyEnv(env: Record<string, string>): void;

  list(): Session[];
  get(id: string): Session | undefined;
  listByProject(projectId: string): Session[];
  getScrollback(id: string): string | null;
  getForegroundProcess(id: string): string | null;

  create(input: CreateSessionInput): Promise<Session>;
  restart(id: string): Promise<Session>;

  setTitle(id: string, title: string, titleManual?: boolean): boolean;
  setPinned(id: string, pinned: boolean): boolean;

  /**
   * Write user input to the PTY's stdin.
   *
   * `generation` (PTY generation gate): when supplied, the host drops the write if the
   * client's tagged generation no longer matches the session's current
   * one. This eliminates the auto-resume race where in-flight terminal-
   * response sequences (DECRPM/DSR/DA replies the previous TUI's
   * queries triggered) would otherwise land on the new shell's stdin.
   * Omitted = no gating (legacy callers + non-input-path writes).
   */
  write(id: string, data: string, generation?: number): void;
  resize(id: string, cols: number, rows: number): void;
  refresh(id: string): void;
  pauseOutput(id: string, clientId: string): void;
  resumeOutput(id: string, clientId: string): void;

  /**
   * Legacy (non-binary) attach. Retained for older clients that send
   * `init` without `capabilities.binary`. `cols` / `rows` follow the same
   * authority rule as binary attach: first spawn and safe auto-resume may
   * use them, but passive attach to an already-running shared PTY must not
   * resize it. Returns `{ ok: false }` on spawn / session-unavailable
   * failures, otherwise the new attach's fence token (attach fencing) the WS
   * layer should hand back on detach.
   *
   * `attachToken` is normally minted internally and returned. It is
   * caller-supplied only by the daemon's IPC handler so the daemon-side
   * `attachedClients` entry stamps the same value the server-side
   * `RemotePtyHost.bySession` carries -- keeping the fence consistent
   * across the IPC boundary.
   */
  initClient(
    id: string,
    clientId: string,
    cols: number,
    rows: number,
    listener: (data: string) => void,
    attachToken?: number,
  ): Promise<{ ok: true; attachToken: number } | { ok: false }>;

  /**
   * Binary-capable attach. The WS handler routes to this method when the
   * client's `init` declared `capabilities.binary`.
   * Returns `{ ok: false }` for missing/unattachable sessions; otherwise
   * the WS layer is responsible for emitting init-ack + replay (full or
   * delta) on the wire, then registering itself for live `onChunk`s.
   *
   * Only `InProcessPtyHost` advertises full chunked-replay support.
   * `RemotePtyHost` declares `binary=false / chunkedReplay=false` in its
   * response (the daemon's STREAM_DATA frame does not yet carry chunk
   * headers) but still forwards live OUTPUT through `sink.onChunk` with
   * a synthetic gen=0 / per-attach seq counter; daemon-mode chunked
   * replay is tracked separately.
   */
  attachClient(
    id: string,
    clientId: string,
    cols: number,
    rows: number,
    capabilities: AttachClientCapabilities,
    sink: AttachClientSink,
  ): Promise<AttachClientResult>;

  /**
   * Attach fencing fence: when `expectedToken` is supplied, the entry is
   * removed only if its stored attach-token matches. A late onClose
   * from a stale WS therefore cannot drop the listener that a fresh
   * attach has just registered for the same `clientId`. Internal
   * cleanup paths (dispose / disposeAll) keep the unconditional shape
   * by omitting the argument.
   */
  detachClient(id: string, clientId: string, expectedToken?: number): void;

  dispose(id: string): Promise<void>;
  disposeAll(): Promise<void>;
  shutdownAll(reason?: SessionEndReason): Promise<void>;

  loadPersistedSession(session: Session, wasGracefulShutdown: boolean): void;

  onSessionInput(listener: (sessionId: string, data: string) => void): void;
  /**
   * `generation` (PTY generation gate): the PTY generation that produced this OUTPUT
   * batch. Daemon-mode broadcasters forward this to remote attached
   * clients so the WS layer can stamp it into binary OUTPUT frames; the
   * client then echoes it back on INPUT so this host can drop stale
   * input that targets a generation that no longer exists. Always the
   * spawn-time generation of the closure that produced the batch (so
   * mid-flight auto-resume cannot mis-tag old PTY data with the new
   * generation -- see in-process-host.ts:929).
   */
  onSessionData(
    listener: (sessionId: string, data: string, generation: number) => void,
  ): void;

  onSessionExit:
    | ((
        sessionId: string,
        generation: number,
        endReason: SessionEndReason,
      ) => void)
    | null;
}

/**
 * Read the runtime mode from env. Daemon mode is the default so that a
 * foreground `parasor` invocation gets the same session-survival
 * properties as the canonical service install -- npm-style updates and
 * server-process restarts can preserve PTY children when they live in a
 * detached daemon. Set `PARASOR_PTY_DAEMON=0` to opt back into
 * in-process mode (used by the dev script to keep PTYs scoped to the
 * tsx-watch process and the legacy single-process layout).
 */
export function resolvePtyHostMode(
  env: NodeJS.ProcessEnv = process.env,
): PtyHostMode {
  return env.PARASOR_PTY_DAEMON === "0" ? "in-process" : "remote";
}

/**
 * Factory: pick a `PtyHost` implementation from the environment.
 *
 * Asking for an unavailable mode throws so callers don't silently fall back
 * and leak ownership semantics.
 *
 * The factory is intentionally lazy -- it imports `InProcessPtyHost`
 * at call time so that consumers depending only on the `PtyHost`
 * interface (e.g. application/route layers) don't pull in the heavy
 * `node-pty` module at module-eval time.
 */
export interface CreatePtyHostDeps {
  store: AppStateStore;
  scrollbackLog?: ScrollbackLog | null;
  mode?: PtyHostMode;
  /**
   * In-process mode only -- passed straight through to InProcessPtyHost
   * to enable SessionRecord persistence.
   * Required for `parasor pty-host doctor` to surface session state in
   * in-process mode; the daemon path constructs its own context inside
   * bootstrap.ts. Optional so existing test sites (no orphan checks)
   * keep working.
   */
  daemonContext?: InProcessPtyHostDaemonContext;
  /**
   * Canonical absolute uploads root. In-process mode uses it to inject
   * a per-session `PARASOR_UPLOAD_DIR=<uploadsDir>/<sessionId>` env var
   * into every spawned PTY (upload staging isolation reviewed for correctness 1). Remote mode
   * ignores it -- the daemon will plumb its own value once upload staging isolation's daemon
   * path is wired.
   */
  uploadsDir?: string;
  /**
   * daemon protocol mismatch recovery -- invoked once when the remote-mode bootstrap detects a
   * `version-mismatch` from the running daemon, terminates it, spawns a
   * fresh daemon, and successfully completes the second handshake.
   * Caller (index.ts) wires this to ServerNoticesStore so the web banner
   * can explain why the session list is empty post-upgrade.
   */
  onDaemonAutoRestarted?: (detail: {
    serverProtocolVersion: string;
    daemonProtocolVersion: string;
  }) => void;
}

export async function createPtyHost(deps: CreatePtyHostDeps): Promise<PtyHost> {
  const mode = deps.mode ?? resolvePtyHostMode();
  if (mode === "remote") {
    const [
      { RemotePtyHost },
      { resolveDaemonPaths },
      { spawnDaemon },
      { terminateDaemon },
      { PROTOCOL_VERSION, parseVersionMismatch },
      { isServiceManagedDaemonInstalled },
      { connectToDaemonSocket, decideAutoSpawn, formatNoDaemonError },
      { recoverFromVersionMismatch },
    ] = await Promise.all([
      import("./remote-host.js"),
      import("./host-daemon/paths.js"),
      import("./host-daemon/spawn-daemon.js"),
      import("./host-daemon/terminate-daemon.js"),
      import("./host-protocol/messages.js"),
      import("./host-daemon/service-detection.js"),
      import("./daemon-connect.js"),
      import("./version-mismatch-recovery.js"),
    ]);
    /*
     * `net.Socket` references below resolve through the top-level
     * `import type * as net from "node:net"` -- runtime `net.connect` is
     * now owned by `daemon-connect.ts` so no runtime `node:net` import
     * is needed here.
     */
    const paths = resolveDaemonPaths();
    /*
     * -- first connect attempt; if it fails with
     * a "no daemon" error and auto-spawn is enabled (default), fork
     * the daemon and retry once. Auto-spawn opt-out lets ops who run
     * launchd/systemd avoid double-supervision.
     */
    let socket: net.Socket;
    try {
      socket = await connectToDaemonSocket(paths.socketPath);
    } catch (err) {
      const serviceInstalled = isServiceManagedDaemonInstalled();
      const { noDaemon, autoStart } = decideAutoSpawn({
        code: (err as NodeJS.ErrnoException).code,
        explicit: process.env.PARASOR_PTY_AUTOSTART,
        serviceInstalled,
      });
      if (noDaemon && autoStart) {
        try {
          await spawnDaemon({ paths });
        } catch (spawnErr) {
          throw new Error(
            `parasor-pty-host: cannot connect to ${paths.socketPath}: ${(err as Error).message}. ` +
              `Auto-spawn also failed: ${(spawnErr as Error).message}`,
          );
        }
        // review: the post-spawn retry can also fail (rare:
        // daemon crashed between probe-ready and our reconnect). Wrap
        // it in a try/catch so the caller sees the original "could not
        // connect" context instead of a bare ECONNREFUSED.
        try {
          socket = await connectToDaemonSocket(paths.socketPath);
        } catch (retryErr) {
          throw new Error(
            `parasor-pty-host: spawn succeeded but reconnect to ${paths.socketPath} failed: ` +
              `${(retryErr as Error).message}. Check ${paths.logFile} for daemon-side errors.`,
          );
        }
      } else {
        throw new Error(
          formatNoDaemonError({
            err: err as Error,
            socketPath: paths.socketPath,
            noDaemon,
            serviceInstalled,
          }),
        );
      }
    }
    /*
     * (narrowed by daemon state ownership) -- remote mode pivots
     * the *session domain* (`sessions`, `sessionRecords`) into read-only
     * mirror. Server-side `mutateSessions()` calls after this point
     * throw; legitimate session updates flow through the daemon-IPC
     * reconciler via `store.internalMutate()`. Project / projectStates
     * / serviceConfig stay writable in both modes (the daemon never
     * touches them). Set this BEFORE we construct RemotePtyHost so any
     * reconcile call inside `connect()` uses the correct write path.
     */
    deps.store.setSessionsReadOnly(true);
    /*
     * state persistence delegate -- install the IPC persistence delegate. Server-owned
     * mutations (mutateProjects / mutateProjectStates / mutateServiceConfig)
     * route their debounced flush through the live wire instead of
     * writeFileSync, so the daemon (sole writer of state.json under
     * daemon state ownership ) ends up with an authoritative snapshot. Without this,
     * server and daemon would race to overwrite each other's view of
     * the file (daemon's stale projects clobber freshly added ones on
     * the next session-update flush).
     */
    const wirePersistDelegate = (
      host: import("./remote-host.js").RemotePtyHost,
    ): import("./remote-host.js").RemotePtyHost => {
      deps.store.setPersistenceDelegate({
        persist: (state) => host.persist(state),
      });
      return host;
    };
    // if RemotePtyHost.connect rejects (HELLO
    // timeout, version mismatch, evicted), the connected socket would
    // be leaked. Take ownership here and destroy() on rejection -- the
    // happy path hands the socket to RemotePtyHost which manages it
    // for the rest of its lifetime.
    try {
      return wirePersistDelegate(
        await RemotePtyHost.connect({
          socket,
          scrollbackLog: deps.scrollbackLog ?? null,
        }),
      );
    } catch (connectErr) {
      try {
        socket.destroy();
      } catch {
        /* socket may already be in error state */
      }
      const code = (connectErr as { code?: string } | null)?.code;
      /*
       * translate the typed handshake-timeout
       * into actionable operator guidance. A daemon that bound the
       * socket but never replies looks identical to a healthy connect
       * from the kernel's perspective; the user needs to know to
       * inspect the daemon log rather than retry blindly.
       */
      if (code === "handshake-timeout") {
        throw new Error(
          `parasor-pty-host: ${(connectErr as Error).message}. ` +
            `The daemon accepted the connection but did not reply. ` +
            `Check ${paths.logFile} for daemon-side errors, ` +
            `or run \`parasor pty-host doctor\` for a full diagnostic dump.`,
        );
      }
      /*
       * daemon protocol mismatch recovery -- when the running daemon's PROTOCOL_VERSION is
       * incompatible with the freshly-installed server binary, the
       * daemon NACKs HELLO with code "version-mismatch" before any
       * application traffic. The old daemon's PTY children are
       * already orphaned from this server's perspective (the new
       * server cannot speak the old protocol), so terminating it and
       * spawning a fresh daemon is the only recovery path: surfacing
       * a stack trace and exiting would loop forever under launchd
       * or systemd-user supervision. Active PTY sessions die -- that
       * cost is paid once per protocol upgrade; the web banner
       * (recorded via onDaemonAutoRestarted -> ServerNoticesStore)
       * tells the user why their list is empty after reconnect.
       */
      if (code === "version-mismatch") {
        const host = await recoverFromVersionMismatch(
          {
            originalError: connectErr as Error,
            paths,
            protocolVersion: PROTOCOL_VERSION,
            scrollbackLog: deps.scrollbackLog ?? null,
            onDaemonAutoRestarted: deps.onDaemonAutoRestarted,
          },
          {
            terminateDaemon,
            spawnDaemon,
            connectSocket: connectToDaemonSocket,
            connectHost: (opts) => RemotePtyHost.connect(opts),
            parseVersionMismatch,
            logStderr: (line) => {
              process.stderr.write(line);
            },
          },
        );
        return wirePersistDelegate(host);
      }
      throw connectErr;
    }
  }
  /*
   * In-process: the server itself owns the session domain. Idempotent
   * setSessionsReadOnly(false) keeps factory recreation (e.g. test
   * re-spinup) deterministic instead of inheriting whatever the
   * previous host left.
   */
  deps.store.setSessionsReadOnly(false);
  const { InProcessPtyHost } = await import("./in-process-host.js");
  return new InProcessPtyHost(
    deps.store,
    deps.scrollbackLog ?? null,
    deps.daemonContext ?? null,
    deps.uploadsDir ?? null,
  );
}

import type * as net from "node:net";
import type { DaemonPaths } from "./host-daemon/paths.js";
import type { ScrollbackLog } from "./scrollback-log.js";

/*
 * daemon protocol mismatch recovery version-mismatch recovery orchestrator, split out of
 * {@link createPtyHost} so the 4-step
 * `terminate -> spawn -> connect-socket -> handshake` sequence and its
 * per-step error wrapping can be exercised with `vi.fn()` deps instead
 * of a real daemon.
 *
 * Behaviour preserved byte-for-byte:
 * - the two `process.stderr.write` lines (`terminating incompatible …`
 *   pre-flight and `replacement daemon online; …` post-success) keep
 *   their original wording and ordering.
 * - the four wrapped error messages keep their original wording
 *   including `Check ${paths.logFile}.` tails and the
 *   `still-alive -> "Run \`parasor pty-host stop --force\`" guidance.
 * - `onDaemonAutoRestarted` is invoked on success only, after the
 *   "replacement daemon online" stderr line, with the same
 *   `{serverProtocolVersion, daemonProtocolVersion}` payload (parsed
 *   `daemon` or the literal `"unknown"` when {@link parseVersionMismatch}
 *   returns null).
 * - the success branch returns the freshly-handshaken host **without**
 *   wiring the persistence delegate -- the caller still owns
 *   {@link wirePersistDelegate} so the orchestrator stays free of
 *   `AppStateStore` coupling.
 */

export interface VersionMismatchRecoveryInput {
  /** The original `RemotePtyHost.connect()` rejection with
   *  `code === "version-mismatch"`. Its `.message` feeds the first
   *  stderr line and {@link parseVersionMismatch}. */
  originalError: Error;
  /** Resolved daemon paths -- `socketPath` for the recovery connect and
   *  `logFile` for the operator-facing error tails. `terminateDaemon`
   *  / `spawnDaemon` receive the whole struct. */
  paths: DaemonPaths;
  /** Server-side `PROTOCOL_VERSION` constant, surfaced on
   *  {@link VersionMismatchRecoveryInput.onDaemonAutoRestarted}. */
  protocolVersion: string;
  /** Forwarded to `connectHost` for the replacement handshake. */
  scrollbackLog: ScrollbackLog | null;
  /** daemon protocol mismatch recovery -- invoked once on the success path so the caller (index.ts)
   *  can route the upgrade notice to ServerNoticesStore. Optional so
   *  tests / pure callers can omit it. */
  onDaemonAutoRestarted?: (detail: {
    serverProtocolVersion: string;
    daemonProtocolVersion: string;
  }) => void;
}

export interface VersionMismatchRecoveryDeps<H> {
  /** Force-terminate the running daemon. `still-alive` short-circuits
   *  the orchestrator with the `stop --force` guidance error. */
  terminateDaemon: (paths: DaemonPaths) => Promise<{
    outcome:
      | "no-pidfile"
      | "already-dead"
      | "stopped"
      | "killed-after-timeout"
      | "still-alive";
    pid: number | null;
  }>;
  /** Fork the replacement daemon. Wrapped error preserves the
   *  "terminated old daemon but failed to start replacement" wording. */
  spawnDaemon: (opts: { paths: DaemonPaths }) => Promise<void>;
  /** Open a fresh Unix-domain socket to the replacement daemon. */
  connectSocket: (socketPath: string) => Promise<net.Socket>;
  /** Run the HELLO/HELLO_ACK handshake on the replacement socket. On
   *  rejection the orchestrator `socket.destroy()`s the recovery
   *  socket (try/catch wrapped -- already-errored sockets are no-ops). */
  connectHost: (opts: {
    socket: net.Socket;
    scrollbackLog: ScrollbackLog | null;
  }) => Promise<H>;
  /** Extract the daemon-reported protocol version from the NACK
   *  message. `null` -> the callback reports `"unknown"`. */
  parseVersionMismatch: (
    msg: string,
  ) => { server: string; daemon: string } | null;
  /** Operator-facing stderr sink. Production wires `process.stderr.write`;
   *  tests can capture invocations to assert ordering. */
  logStderr: (line: string) => void;
}

/**
 * Recover from a `version-mismatch` HELLO NACK by terminating the
 * incompatible daemon, spawning a fresh one, and re-running the
 * handshake. Generic over the host shape so the orchestrator does not
 * depend on `RemotePtyHost` directly -- the caller passes
 * `connectHost: (opts) => RemotePtyHost.connect(opts)`.
 *
 * The four wrapped error branches surface the original `Check
 * ${paths.logFile}.` tail so operators can immediately reach for the
 * daemon log; the `still-alive` branch instead points at `parasor
 * pty-host stop --force` since the failure is process-level, not log-
 * level.
 */
export async function recoverFromVersionMismatch<H>(
  input: VersionMismatchRecoveryInput,
  deps: VersionMismatchRecoveryDeps<H>,
): Promise<H> {
  const mismatch = deps.parseVersionMismatch(input.originalError.message);
  deps.logStderr(
    `parasor-pty-host: ${input.originalError.message}. ` +
      `terminating incompatible daemon -- active PTY sessions will be lost.\n`,
  );
  const term = await deps.terminateDaemon(input.paths);
  if (term.outcome === "still-alive") {
    throw new Error(
      `parasor-pty-host: failed to terminate incompatible daemon ` +
        `(pid ${term.pid} survived SIGKILL). ` +
        `Run \`parasor pty-host stop --force\` and restart parasor.`,
    );
  }
  try {
    await deps.spawnDaemon({ paths: input.paths });
  } catch (spawnErr) {
    throw new Error(
      `parasor-pty-host: terminated old daemon but failed to start ` +
        `replacement: ${(spawnErr as Error).message}. ` +
        `Check ${input.paths.logFile}.`,
    );
  }
  let recoverySocket: net.Socket;
  try {
    recoverySocket = await deps.connectSocket(input.paths.socketPath);
  } catch (reconnectErr) {
    throw new Error(
      `parasor-pty-host: replacement daemon socket unreachable: ` +
        `${(reconnectErr as Error).message}. Check ${input.paths.logFile}.`,
    );
  }
  try {
    const host = await deps.connectHost({
      socket: recoverySocket,
      scrollbackLog: input.scrollbackLog,
    });
    deps.logStderr(
      "parasor-pty-host: replacement daemon online; resuming server boot.\n",
    );
    input.onDaemonAutoRestarted?.({
      serverProtocolVersion: input.protocolVersion,
      daemonProtocolVersion: mismatch?.daemon ?? "unknown",
    });
    return host;
  } catch (recoveryErr) {
    try {
      recoverySocket.destroy();
    } catch {
      /* socket may already be in error state */
    }
    throw new Error(
      `parasor-pty-host: handshake to replacement daemon failed: ` +
        `${(recoveryErr as Error).message}. Check ${input.paths.logFile}.`,
    );
  }
}

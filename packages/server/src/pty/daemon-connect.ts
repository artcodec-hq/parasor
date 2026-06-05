import * as net from "node:net";

/*
 * Connect-side helpers split out of {@link createPtyHost}.
 *
 * These three pure-ish helpers cover the "first connect to the daemon
 * Unix-domain socket" path (auto-spawn decision + connect retry + the
 * user-facing "cannot connect" guidance string). They do NOT cover the
 * version-mismatch recovery flow -- that orchestrator stays inline in
 * {@link createPtyHost} (4-step sequential teardown/respawn/reconnect
 * with per-step error wrapping) since each step injects a distinct
 * dependency module and the value of unit-testing it is the orchestrator
 * itself, not the leaves.
 */

/**
 * Promise-wrap `net.connect(socketPath)`. Resolves once the socket emits
 * `connect`, rejects with the `NodeJS.ErrnoException` from the first
 * `error`. The success path removes the one-shot `error` listener so a
 * later transport fault on the same socket reaches the caller's own
 * listeners instead of an orphaned rejector.
 */
export function connectToDaemonSocket(socketPath: string): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect(socketPath);
    s.once("connect", () => {
      s.removeAllListeners("error");
      resolve(s);
    });
    s.once("error", (err: NodeJS.ErrnoException) => {
      reject(err);
    });
  });
}

export interface AutoSpawnInput {
  /** `(err as NodeJS.ErrnoException).code` from the failed first connect. */
  code: string | undefined;
  /** Value of `process.env.PARASOR_PTY_AUTOSTART`. `"1"` forces ON, `"0"`
   *  forces OFF, anything else (including undefined) falls back to the
   *  default rule. */
  explicit: string | undefined;
  /** Result of {@link isServiceManagedDaemonInstalled} -- when true the
   *  default is OFF (service unit is the canonical owner, spawning here
   *  would create the unmanaged-daemon split-brain `service install` /
   *  `restart --all` are meant to heal). */
  serviceInstalled: boolean;
}

export interface AutoSpawnDecision {
  /** True iff the errno code matched "daemon not running"
   *  (`ECONNREFUSED` / `ENOENT`). Other codes signal "socket file exists
   *  but daemon is unhealthy" -> never auto-spawn. */
  noDaemon: boolean;
  /** True iff the caller should fork the daemon and retry once. */
  autoStart: boolean;
}

/** Pure derivation of the auto-spawn policy. Explicit env override always
 *  wins; otherwise default depends on whether a service-managed daemon
 *  unit is installed. */
export function decideAutoSpawn(input: AutoSpawnInput): AutoSpawnDecision {
  const noDaemon = input.code === "ECONNREFUSED" || input.code === "ENOENT";
  const autoStart =
    input.explicit === "1"
      ? true
      : input.explicit === "0"
        ? false
        : !input.serviceInstalled;
  return { noDaemon, autoStart };
}

export interface NoDaemonErrorMessageInput {
  /** Original connect error -- only `.message` is read. */
  err: Error;
  /** Unix-domain socket path the caller was trying to reach. */
  socketPath: string;
  /** Output of {@link decideAutoSpawn} for the same error (drives the
   *  "service installed but unreachable" vs "no daemon at all" branch). */
  noDaemon: boolean;
  /** Result of {@link isServiceManagedDaemonInstalled} -- selects between
   *  the service-managed guidance and the casual `parasor` guidance. */
  serviceInstalled: boolean;
}

/** Build the user-facing "cannot connect to daemon" message. Three
 *  branches: noDaemon + serviceInstalled (service-managed but down),
 *  noDaemon + !serviceInstalled (casual install path), and !noDaemon
 *  (unhealthy socket -- daemon log is the next step). */
export function formatNoDaemonError(input: NoDaemonErrorMessageInput): string {
  return (
    `parasor-pty-host: cannot connect to ${input.socketPath}: ${input.err.message}. ` +
    (input.noDaemon
      ? input.serviceInstalled
        ? "A service-managed daemon is installed but not reachable. " +
          "Run `parasor service restart --all` to bring it back up, " +
          "or set PARASOR_PTY_AUTOSTART=1 to override (not recommended -- " +
          "bypasses the service manager and risks split-brain)."
        : "Set PARASOR_PTY_AUTOSTART=1 (default) or start the daemon " +
          "(`parasor-pty-host` entry script). " +
          "Set PARASOR_PTY_DAEMON=0 to fall back to in-process mode."
      : "Daemon socket is unhealthy; check the daemon log.")
  );
}

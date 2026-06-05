import { userInfo } from "node:os";
import { join } from "node:path";
import { DAEMON_LABEL, SERVER_LABEL } from "./service-darwin.js";
import { DAEMON_UNIT, SERVER_UNIT } from "./service-linux.js";
import {
  attemptGracefulShutdown,
  isServiceManagerActive,
  LOCK_RELEASE_MAX_MS,
  resolveShutdownDeps,
  type ShutdownDeps,
  waitForLockRelease,
  waitForPidExit,
} from "./shutdown-deps.js";

/*
 * `parasor stop` -- gracefully terminate the running server AND its
 * parasor-pty-host daemon. Counterpart to `parasor restart`: shares the
 * same shutdown machinery (graceful IPC -> SIGTERM via runtime.json pid)
 * but does not respawn.
 *
 * Process-stop safety -- `parasor restart` produces a fully detached server that
 * is invisible to the calling shell, and the only locator post-respawn is
 * `~/.config/parasor/runtime.json`. Without `parasor stop`, users who
 * called `restart` had no first-class way to terminate the orphan; this
 * command closes that gap.
 *
 * Daemon coupling: `parasor stop` always brings the daemon down too. The
 * daemon's job is to outlive ordinary server restarts (so PTY sessions
 * survive a `parasor restart`); leaving it running after an explicit
 * `stop` would re-create the same "invisible orphan" problem one layer
 * down. Use `parasor restart` when session preservation matters.
 */

export interface StopDeps extends ShutdownDeps {
  /**
   * Stop the parasor-pty-host daemon. Default impl shells out to
   * `cliPtyHost(["stop"])` so the SIGTERM + lockfile-release dance lives
   * in one place. Tests stub this.
   */
  stopDaemon: () => Promise<number>;
}

async function defaultStopDaemon(): Promise<number> {
  const { cliPtyHost } = await import("./pty-host.js");
  return cliPtyHost(["stop"]);
}

function resolveDeps(partial?: Partial<StopDeps>): StopDeps {
  const base = resolveShutdownDeps(partial);
  return {
    ...base,
    stopDaemon: partial?.stopDaemon ?? defaultStopDaemon,
  };
}

// Service-manager bootout/stop. Best-effort: targets BOTH server + daemon
// units regardless of individual outcomes -- non-zero status is logged but
// not treated as fatal because launchctl/systemctl return non-zero on
// "not loaded" too. Caller always falls through to the manual path
// afterwards as an idempotent backstop, so a partial success here does
// NOT leave the other unit orphaned.
function performServiceManagedStop(deps: StopDeps): void {
  if (deps.platform === "darwin") {
    const uid = userInfo().uid;
    for (const label of [SERVER_LABEL, DAEMON_LABEL]) {
      const target = `gui/${uid}/${label}`;
      const r = deps.spawnSync("launchctl", ["bootout", target]);
      if (r.status === 0) {
        deps.log(`launchd bootout ${target}.`);
      } else {
        // bootout returns non-zero when the unit was not loaded -- that is
        // a no-op success for our purposes. Log and continue.
        deps.log(
          `launchctl bootout ${target} returned status ${r.status} (probably not loaded).`,
        );
      }
    }
    return;
  }
  if (deps.platform === "linux") {
    for (const unit of [SERVER_UNIT, DAEMON_UNIT]) {
      const r = deps.spawnSync("systemctl", ["--user", "stop", unit]);
      if (r.status === 0) {
        deps.log(`systemctl --user stop ${unit}.`);
      } else {
        deps.log(
          `systemctl --user stop ${unit} returned status ${r.status} (probably not active).`,
        );
      }
    }
  }
}

const STOP_HELP = `Usage: parasor stop
  Stop the running parasor server and its parasor-pty-host daemon.

  Tries graceful IPC shutdown of the server first; falls back to SIGTERM
  via the pid recorded in \`runtime.json\`. Then SIGTERMs the daemon via
  \`parasor pty-host stop\`. Under launchd (macOS) or systemd (Linux),
  delegates to the service manager's native bootout/stop so the
  supervised units stop without auto-restart.

  PTY sessions are terminated. Use \`parasor restart\` instead if you
  need to keep sessions alive across a server restart.`;

export async function cliStop(
  partial?: Partial<StopDeps>,
  args: string[] = [],
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(STOP_HELP);
    return;
  }
  const deps = resolveDeps(partial);

  // Service-managed path. Service manager owns both the server unit and
  // the daemon unit (see  / service install release path): `parasor service
  // install` always provisions both. Best-effort bootout/stop both, then
  // ALWAYS fall through to the manual path. The manual path is
  // idempotent for already-stopped processes (logs "no live parasor
  // server detected" / "parasor-pty-host is not running") and serves as
  // a backstop against partial success in the service-managed branch.
  if (isServiceManagerActive(deps)) {
    performServiceManagedStop(deps);
  }

  const socketPath = join(deps.configDir, "parasor.sock");
  const runtimeFile = join(deps.configDir, "runtime.json");

  const graceful = await attemptGracefulShutdown(socketPath, deps);
  if (graceful) {
    deps.log("parasor shut down gracefully via IPC.");
    const released = await waitForLockRelease(deps.configDir, deps);
    if (!released) {
      throw new Error(
        `parasor did not release its lockfile within ${LOCK_RELEASE_MAX_MS}ms after graceful shutdown. Remove \`${join(deps.configDir, "parasor.lock.lock")}\` manually and retry.`,
      );
    }
  } else {
    const runtime = deps.readRuntimeJson(runtimeFile);
    // Reject pid<=0 to avoid `kill(0, …)` (process group broadcast) and
    // `kill(-1, …)` (all-user-processes broadcast) when runtime.json is
    // attacker-influenced (e.g. via PARASOR_CONFIG_DIR override). Mirrors
    // pty-host.ts:134 -- same project, same guard.
    const rawPid = runtime?.pid;
    const pid =
      typeof rawPid === "number" && Number.isFinite(rawPid) && rawPid > 0
        ? rawPid
        : null;

    if (pid !== null && deps.killProcess(pid, 0)) {
      deps.log(`parasor IPC unreachable; sending SIGTERM to pid ${pid}.`);
      deps.killProcess(pid, "SIGTERM");
      const exited = await waitForPidExit(pid, deps);
      if (!exited) {
        throw new Error(
          `pid ${pid} did not exit after SIGTERM within 5s. Escalate manually (kill -9) before retrying.`,
        );
      }
      deps.log(`pid ${pid} exited.`);
    } else {
      deps.log("no live parasor server detected; skipping server stop.");
    }
  }

  // Daemon -- always attempt regardless of whether server stop succeeded.
  // The daemon outlives the server by design, so it may still be running
  // even when the server is down. cliPtyHost stop is idempotent.
  const daemonRc = await deps.stopDaemon();
  if (daemonRc !== 0) {
    throw new Error(
      "parasor-pty-host stop reported failure (likely a stale pidfile " +
        "from a crashed daemon). Run `parasor pty-host doctor` for " +
        "diagnostics, then `parasor pty-host stop --force` once the pid " +
        "is confirmed to be the daemon.",
    );
  }
}

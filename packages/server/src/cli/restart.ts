import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { join } from "node:path";

import {
  confirmRestartIfMismatch,
  extractAutoYesFlag,
} from "./restart-confirm.js";
import {
  attemptGracefulShutdown,
  isServiceManagerActive,
  LOCK_RELEASE_MAX_MS,
  resolveShutdownDeps,
  type ShutdownDeps,
  waitForLockRelease,
  waitForPidExit,
} from "./shutdown-deps.js";

interface SpawnDetachedResult {
  pid?: number;
}

export interface RestartDeps extends ShutdownDeps {
  spawnDetached: (cmd: string, args: string[]) => SpawnDetachedResult;
  /** restart confirmation -- pre-restart version probe + confirmation. Injected for tests. */
  confirmRestart: (opts: {
    autoYes: boolean;
  }) => Promise<{ proceed: boolean; reason: string }>;
}

function defaultSpawnDetached(
  cmd: string,
  args: string[],
): SpawnDetachedResult {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { pid: child.pid };
}

function resolveDeps(partial?: Partial<RestartDeps>): RestartDeps {
  const base = resolveShutdownDeps(partial);
  return {
    ...base,
    spawnDetached: partial?.spawnDetached ?? defaultSpawnDetached,
    confirmRestart: partial?.confirmRestart ?? confirmRestartIfMismatch,
  };
}

// Service-manager units are configured to restart only on failure (launchd
// `SuccessfulExit=false` / systemd `Restart=on-failure`), so a clean exit
// leaves the service down. We must explicitly kickstart it instead of relying
// on automatic restart after shutdown.
function performServiceManagedRestart(deps: RestartDeps): boolean {
  if (deps.platform === "darwin") {
    const uid = userInfo().uid;
    const r = deps.spawnSync("launchctl", [
      "kickstart",
      "-k",
      `gui/${uid}/com.parasor`,
    ]);
    if (r.status === 0) {
      deps.log("launchd kickstarted parasor (gui/<uid>/com.parasor).");
      return true;
    }
    deps.log(
      `launchctl kickstart failed (status ${r.status}); falling back to manual restart.`,
    );
    return false;
  }
  if (deps.platform === "linux") {
    const r = deps.spawnSync("systemctl", [
      "--user",
      "restart",
      "parasor.service",
    ]);
    if (r.status === 0) {
      deps.log("systemd restarted parasor (user service).");
      return true;
    }
    deps.log(
      `systemctl restart failed (status ${r.status}); falling back to manual restart.`,
    );
    return false;
  }
  return false;
}

function respawn(deps: RestartDeps): void {
  const binArg = process.argv[1];
  if (!binArg) {
    throw new Error(
      "unable to determine parasor binary path (process.argv[1] is missing)",
    );
  }
  try {
    const res = deps.spawnDetached(process.execPath, [binArg]);
    if (res.pid !== undefined) {
      deps.log(`parasor respawned (pid ${res.pid}).`);
    } else {
      deps.log("parasor respawned.");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOCKED") {
      throw new Error(
        `unable to recover automatically -- remove \`${join(deps.configDir, "parasor.lock.lock")}\` manually and retry.`,
      );
    }
    throw err;
  }
}

const RESTART_HELP = `Usage: parasor restart [--yes|-y]
  Restart a running parasor server.

  Tries graceful IPC shutdown first; falls back to SIGTERM + respawn.
  Under launchd (macOS) or systemd (Linux), delegates to the service
  manager's native kickstart so the supervised unit handles stop/respawn.

  Options:
    --yes, -y   Acknowledge that an incompatible daemon will be force-
                killed (terminating every active PTY session) without an
                interactive confirmation. Required in non-TTY contexts.`;

export async function cliRestart(
  partial?: Partial<RestartDeps>,
  args: string[] = [],
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(RESTART_HELP);
    return;
  }
  const { autoYes } = extractAutoYesFlag(args);
  const deps = resolveDeps(partial);
  const socketPath = join(deps.configDir, "parasor.sock");
  const runtimeFile = join(deps.configDir, "runtime.json");

  // restart confirmation -- confirm BEFORE the supervisor takes over. After kickstart the
  // user's TTY has no relationship to the new server's stderr.
  const confirmation = await deps.confirmRestart({ autoYes });
  if (!confirmation.proceed) {
    deps.log(`parasor: restart aborted -- ${confirmation.reason}.`);
    return;
  }

  // Prefer the service manager's native restart path when present -- it handles
  // graceful stop + respawn atomically and avoids our own race with lockfile
  // release. Fall through to the manual path only if kickstart reports failure.
  if (isServiceManagerActive(deps)) {
    if (performServiceManagedRestart(deps)) return;
  }

  const graceful = await attemptGracefulShutdown(socketPath, deps);
  if (graceful) {
    deps.log("parasor shut down gracefully via IPC.");
    const released = await waitForLockRelease(deps.configDir, deps);
    if (!released) {
      throw new Error(
        `parasor did not release its lockfile within ${LOCK_RELEASE_MAX_MS}ms after graceful shutdown. Remove \`${join(deps.configDir, "parasor.lock.lock")}\` manually and retry.`,
      );
    }
    respawn(deps);
    return;
  }

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
        `pid ${pid} did not exit after SIGTERM within 5s. Escalate manually (kill -9) or run \`parasor service restart\`.`,
      );
    }
    deps.log(`pid ${pid} exited.`);
  } else {
    deps.log("no live parasor detected; performing cold start.");
  }

  respawn(deps);
}

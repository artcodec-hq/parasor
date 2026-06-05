/*
 * -- daemon runtime path resolution.
 *
 * Resolution order:
 *   1. `PARASOR_PTY_SOCK` env override (test / sandbox bypass)
 *   2. `XDG_RUNTIME_DIR/parasor` (Linux session runtime)
 *   3. `~/.parasor/run` (default fallback)
 *
 * The socket directory is created `0700` so only the spawning user can
 * connect. `PARASOR_PTY_SOCK` overrides keep the same `<sock>.pid`,
 * `<sock>.lock`, `<sock>.log` neighbours so all bookkeeping files travel
 * with the socket override.
 *
 *  R5 -- `PARASOR_PTY_SOCK_PER_PID=1` opt-in suffixes
 * `-${pid}` to all canonical basenames so foreground daemons and
 * installed daemons can coexist without socket collision. Ignored when
 * `PARASOR_PTY_SOCK` is set (explicit override always wins).
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface DaemonPaths {
  runtimeDir: string;
  socketPath: string;
  pidFile: string;
  lockFile: string;
  logFile: string;
}

export function resolveDaemonPaths(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
): DaemonPaths {
  const override = env.PARASOR_PTY_SOCK;
  if (override && override.length > 0) {
    return {
      runtimeDir: dirname(override),
      socketPath: override,
      pidFile: `${override}.pid`,
      lockFile: `${override}.lock`,
      logFile: `${override}.log`,
    };
  }

  const xdg = env.XDG_RUNTIME_DIR;
  const runtimeDir =
    xdg && xdg.length > 0
      ? join(xdg, "parasor")
      : join(homedir(), ".parasor", "run");

  const perPid = env.PARASOR_PTY_SOCK_PER_PID === "1";
  const stem = perPid ? `parasor-pty-${pid}` : "parasor-pty";

  return {
    runtimeDir,
    socketPath: join(runtimeDir, `${stem}.sock`),
    pidFile: join(runtimeDir, `${stem}.pid`),
    lockFile: join(runtimeDir, `${stem}.lock`),
    logFile: join(runtimeDir, `${stem}.log`),
  };
}

export function ensureRuntimeDir(dir: string): void {
  const prevMask = process.umask(0o077);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } finally {
    process.umask(prevMask);
  }
}

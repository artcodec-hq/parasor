/*
 * daemon protocol mismatch recovery -- server-side daemon force-termination used by the
 * `version-mismatch` auto-recovery path in createPtyHost. The CLI's
 * `stopCmd` is the user-facing entry point; this is the in-process
 * variant the server invokes when handshake NACK proves the running
 * daemon is incompatible with the freshly-installed binary.
 *
 * Behaviour:
 *   1. Read pidfile. Missing -> unlink stale socket + lock, return "no-pidfile".
 *   2. probe `kill(pid, 0)` -- already dead -> unlink socket + lock, return.
 *   3. SIGTERM, poll ≤ SIGTERM_TIMEOUT_MS for the pid to die.
 *   4. Still alive -> SIGKILL, poll ≤ SIGKILL_TIMEOUT_MS.
 *   5. Still alive after SIGKILL -> still unlink socket + lock and return
 *      "still-alive". Caller treats this as fatal so the user sees a
 *      clear failure, but we leave no stale inodes/lockdir behind that
 *      would block a manual `parasor pty-host stop --force` recovery.
 *
 * Why we also break the proper-lockfile directory: a SIGKILLed daemon
 * cannot release its `proper-lockfile` flock, and the stale-mtime
 * window is up to 30s (refresh interval) before the next acquire would
 * succeed. spawnDaemon does not retry on ELOCKED, so without explicit
 * cleanup the immediate post-kill respawn would fail with
 * `DaemonAlreadyRunningError`. We forcibly remove the
 * `<lockFile>.lock` state directory proper-lockfile creates, which is
 * safe because we just confirmed (or attempted to confirm) the holder
 * is dead.
 */

import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import type { DaemonPaths } from "./paths.js";

const SIGTERM_TIMEOUT_MS = 5_000;
const SIGKILL_TIMEOUT_MS = 2_000;
const POLL_INTERVAL_MS = 50;

export type TerminateDaemonOutcome =
  | "no-pidfile"
  | "already-dead"
  | "stopped"
  | "killed-after-timeout"
  | "still-alive";

export interface TerminateDaemonResult {
  outcome: TerminateDaemonOutcome;
  pid: number | null;
}

export interface TerminateDaemonDeps {
  killProcess: (pid: number, signal: NodeJS.Signals | 0) => boolean;
  readPidFile: (path: string) => number | null;
  unlinkSocket: (path: string) => void;
  unlinkLockFile: (lockFile: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

function defaultReadPidFile(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function defaultKillProcess(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function defaultUnlinkSocket(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* ENOENT or owned-by-other-fd; spawnDaemon's lock arbitration owns the rest */
  }
}

function defaultUnlinkLockFile(lockFile: string): void {
  // proper-lockfile records its held state as a `<lockFile>.lock` directory
  // (see `acquireDaemonLock` in lockfile.ts). The stamp file at `lockFile`
  // is just a touchpoint we created; the real lock is the directory. Both
  // are safe to remove here because the daemon that owned them is dead
  // (or assumed dead -- this is the force-termination path).
  try {
    rmSync(`${lockFile}.lock`, { recursive: true, force: true });
  } catch {
    /* nothing to clean up */
  }
  try {
    unlinkSync(lockFile);
  } catch {
    /* nothing to clean up */
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function terminateDaemon(
  paths: DaemonPaths,
  partial?: Partial<TerminateDaemonDeps>,
): Promise<TerminateDaemonResult> {
  const deps: TerminateDaemonDeps = {
    killProcess: partial?.killProcess ?? defaultKillProcess,
    readPidFile: partial?.readPidFile ?? defaultReadPidFile,
    unlinkSocket: partial?.unlinkSocket ?? defaultUnlinkSocket,
    unlinkLockFile: partial?.unlinkLockFile ?? defaultUnlinkLockFile,
    sleep: partial?.sleep ?? defaultSleep,
    now: partial?.now ?? Date.now,
  };
  const cleanup = (): void => {
    deps.unlinkSocket(paths.socketPath);
    deps.unlinkLockFile(paths.lockFile);
  };

  const pid = deps.readPidFile(paths.pidFile);
  if (pid === null) {
    cleanup();
    return { outcome: "no-pidfile", pid: null };
  }
  if (!deps.killProcess(pid, 0)) {
    cleanup();
    return { outcome: "already-dead", pid };
  }
  deps.killProcess(pid, "SIGTERM");
  const sigtermDeadline = deps.now() + SIGTERM_TIMEOUT_MS;
  while (deps.now() < sigtermDeadline) {
    if (!deps.killProcess(pid, 0)) {
      cleanup();
      return { outcome: "stopped", pid };
    }
    await deps.sleep(POLL_INTERVAL_MS);
  }
  deps.killProcess(pid, "SIGKILL");
  const sigkillDeadline = deps.now() + SIGKILL_TIMEOUT_MS;
  while (deps.now() < sigkillDeadline) {
    if (!deps.killProcess(pid, 0)) {
      cleanup();
      return { outcome: "killed-after-timeout", pid };
    }
    await deps.sleep(POLL_INTERVAL_MS);
  }
  // Surviving SIGKILL is the abort signal for host.ts, but we still
  // sweep socket + lockfile so a manual `parasor pty-host stop --force`
  // afterward does not need to break a stale lock too.
  cleanup();
  return { outcome: "still-alive", pid };
}

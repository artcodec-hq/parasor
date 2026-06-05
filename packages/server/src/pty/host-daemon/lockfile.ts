/*
 * -- daemon single-instance enforcement.
 *
 * `proper-lockfile` advisory flock on `paths.lockFile` is the *sole*
 * source of truth for "another daemon owns this runtime dir". It is held
 * across the daemon's whole lifetime and released either by graceful
 * shutdown or by stale-timeout (60s) if the holder dies.
 *
 * The pidfile is purely informational: humans (and `parasor pty-host
 * status`) read it to find the daemon's PID; the recorded pid liveness
 * probe (`kill(pid, 0)`) is only consulted to populate
 * `DaemonAlreadyRunningError.pid` for nicer error messages. We do *not*
 * cross-validate the pidfile post-flock -- once flock returned success,
 * the recycled-PID corner case (previous daemon died, OS handed the same
 * PID to an unrelated process before stale-timeout fired) would
 * otherwise spuriously block startup.  *
 * Mode marker is enforced by the server-side factory
 * (`createPtyHost`) because it polices in-process vs daemon ownership of
 * the AppStateStore -- out of scope here.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import lockfile from "proper-lockfile";
import type { DaemonPaths } from "./paths.js";

export interface DaemonLock {
  pidFile: string;
  release: () => Promise<void>;
}

export class DaemonAlreadyRunningError extends Error {
  constructor(
    readonly pid: number,
    readonly pidFile: string,
  ) {
    super(`parasor-pty-host already running (pid=${pid}, lock=${pidFile})`);
    this.name = "DaemonAlreadyRunningError";
  }
}

export async function acquireDaemonLock(
  paths: DaemonPaths,
  ourPid: number = process.pid,
): Promise<DaemonLock> {
  if (!existsSync(paths.lockFile)) {
    writeFileSync(paths.lockFile, "");
  }

  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(paths.lockFile, {
      stale: 60_000,
      retries: 0,
    });
  } catch (err) {
    // ELOCKED is the only signal that another live daemon owns the
    // lockfile. We surface the recorded pid (if alive) for diagnostics,
    // but the rejection itself is decided entirely by flock -- the
    // pidfile content cannot vote.
    if (isLockHeldError(err)) {
      const livePid = readPidIfAlive(paths.pidFile);
      throw new DaemonAlreadyRunningError(livePid ?? -1, paths.pidFile);
    }
    throw err;
  }

  // flock acquired: we own the runtime dir. Stamp our pid for `parasor
  // pty-host status` consumers; do NOT recheck the pidfile, because a
  // stale pid that has been recycled by an unrelated live process would
  // otherwise block legitimate takeover.
  writeFileSync(paths.pidFile, `${ourPid}\n`);

  return {
    pidFile: paths.pidFile,
    release: async () => {
      try {
        if (existsSync(paths.pidFile)) {
          const recorded = readPidStrict(paths.pidFile);
          if (recorded === ourPid) unlinkSync(paths.pidFile);
        }
      } catch {
        /* best-effort cleanup */
      }
      try {
        await release();
      } catch {
        /* lockfile already released or removed */
      }
    },
  };
}

function readPidIfAlive(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  let raw: string;
  try {
    raw = readFileSync(pidFile, "utf8").trim();
  } catch {
    return null;
  }
  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function isLockHeldError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ELOCKED") return true;
  return /lock file is already being held/i.test(err.message);
}

function readPidStrict(pidFile: string): number | null {
  try {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

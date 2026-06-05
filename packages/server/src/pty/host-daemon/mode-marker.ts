/*
 * -- cross-mode mutual exclusion ownership lock.
 *
 * Both runtime modes (in-process server / daemon) write to the same
 * AppStateStore on disk. If both run concurrently against the same
 * runtime dir they corrupt each other's view. This module acquires an
 * exclusive `proper-lockfile` advisory lock on a marker file next to
 * `state.json` and holds it for the lifetime of the owning process.
 *
 * Design parallels `host-daemon/lockfile.ts`:
 *   - `proper-lockfile` is the *sole* mutex (kernel-backed via
 *     graceful-fs's atomic mkdir of `<marker>.lock`/). Held across the
 *     owner's whole lifetime; released via `AppStateOwner.release()` on
 *     graceful shutdown or by stale-timeout (60s) if the holder dies.
 *   - The marker file body is purely informational -- humans (and a
 *     future `parasor doctor`) read it to see who owns the dir; the
 *     conflict error pretty-prints those fields. Body content cannot
 *     vote against the lockfile decision.
 *   - PID liveness (`process.kill(pid, 0)`) is consulted only to
 *     populate `AppStateOwnerConflictError` for nicer messages.
 *
 * Wire format: a single TSV line `mode\tpid\tstartedAt\thostname`. TSV
 * keeps the file shell-readable during incident response (`cat
 * appstate.mode`). The parser rejects lines that don't match the
 * 4-field shape.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import lockfile from "proper-lockfile";

export type AppStateMode = "in-process" | "daemon";

export interface ModeMarker {
  mode: AppStateMode;
  pid: number;
  startedAt: string;
  hostname: string;
}

export class AppStateOwnerConflictError extends Error {
  constructor(
    readonly currentMode: AppStateMode,
    readonly existing: ModeMarker | null,
    readonly markerFile: string,
  ) {
    const tail =
      existing !== null
        ? `${existing.mode} mode (pid=${existing.pid}, host=${existing.hostname}, started=${existing.startedAt})`
        : "an unidentified owner (lockfile held but marker body unreadable)";
    super(
      `appstate is owned by ${tail}; refusing to start ${currentMode} mode against the same runtime dir. ` +
        `Marker file: ${markerFile}`,
    );
    this.name = "AppStateOwnerConflictError";
  }
}

export interface AppStateOwner {
  marker: ModeMarker;
  release: () => Promise<void>;
}

/**
 * Read and parse the marker file body. Returns null when the file does
 * not exist or is malformed. Body is purely informational -- readers
 * MUST NOT use it as a mutex; the proper-lockfile lock on the same
 * path is what serialises ownership.
 */
export function readMarker(markerFile: string): ModeMarker | null {
  if (!existsSync(markerFile)) return null;
  let raw: string;
  try {
    raw = readFileSync(markerFile, "utf8");
  } catch {
    return null;
  }
  const line = raw.split(/\r?\n/)[0] ?? "";
  const fields = line.split("\t");
  if (fields.length !== 4) return null;
  const [mode, pidStr, startedAt, hostname] = fields;
  if (mode !== "in-process" && mode !== "daemon") return null;
  const pid = Number(pidStr);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (typeof startedAt !== "string" || startedAt.length === 0) return null;
  if (typeof hostname !== "string" || hostname.length === 0) return null;
  return { mode, pid, startedAt, hostname };
}

/**
 * Write the marker body. Caller MUST already hold the proper-lockfile
 * advisory lock on `markerFile` (see `acquireAppStateOwnership`).
 */
export function writeMarker(
  markerFile: string,
  mode: AppStateMode,
  pid: number = process.pid,
  startedAt: string = new Date().toISOString(),
  hostname: string = osHostname(),
): ModeMarker {
  const line = `${mode}\t${pid}\t${startedAt}\t${hostname}\n`;
  writeFileSync(markerFile, line, { encoding: "utf8", mode: 0o600 });
  return { mode, pid, startedAt, hostname };
}

/** Best-effort delete; not an error if the file is already gone. */
export function unlinkMarker(markerFile: string): void {
  try {
    if (existsSync(markerFile)) unlinkSync(markerFile);
  } catch {
    /* leave-on-error */
  }
}

/**
 * Liveness probe via `process.kill(pid, 0)`. Used only to enrich the
 * conflict error -- the proper-lockfile hold is the source of truth for
 * whether the recorded owner is still alive.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    /*
     * EPERM = PID exists but belongs to another user. From this
     * module's standpoint that is "alive" because the runtime dir is
     * per-user -- another user's PID inside our home dir would be a
     * permissions misconfiguration we should not paper over.
     */
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Conventional marker location: the AppState dir (i.e. the directory
 * that holds `state.json`). Co-locating with state.json -- rather than
 * the daemon runtime dir -- means any process that opens this state.json
 * passes through the same marker file, which is the actual mutual-
 * exclusion target. The daemon runtime dir varies with `XDG_RUNTIME_DIR`
 * / `PARASOR_PTY_SOCK` overrides, so an in-process server with a custom
 * `PARASOR_CONFIG_DIR` and a daemon with a custom `XDG_RUNTIME_DIR`
 * could otherwise both write the same `state.json` undetected.
 */
export function markerFileFor(appStateDir: string): string {
  return `${appStateDir}/appstate.mode`;
}

interface AcquireOptions {
  pid?: number;
  startedAt?: string;
  hostname?: string;
  /** Test seam -- production callers always use proper-lockfile defaults. */
  retries?: number;
}

/**
 * Acquire exclusive ownership of the AppState directory. On success
 * returns an `AppStateOwner` whose `release()` MUST be called from the
 * graceful-shutdown path. The lock is held until release; long-running
 * owners are kept alive by proper-lockfile's mtime refresh interval
 * (default `stale/2 = 30s`).
 *
 * `proper-lockfile.lock()` is the *sole* mutex (mirrors
 * `host-daemon/lockfile.ts`'s decision for the daemon runtime lock).
 * The marker file body is purely informational -- populated for
 * `AppStateOwnerConflictError` diagnostics, NOT cross-validated post-
 * acquisition. a post-flock `kill(pid, 0)` recheck
 * spuriously rejects legitimate stale takeover when the OS has
 * recycled the prior owner's PID to an unrelated live process during
 * the 60s stale window. The daemon lockfile path documents the same
 * choice ("flock acquired: we own the runtime dir … do NOT recheck …
 * because a stale pid that has been recycled by an unrelated live
 * process would otherwise block legitimate takeover").
 */
export async function acquireAppStateOwnership(
  markerFile: string,
  currentMode: AppStateMode,
  opts: AcquireOptions = {},
): Promise<AppStateOwner> {
  const ourPid = opts.pid ?? process.pid;
  const startedAt = opts.startedAt ?? new Date().toISOString();
  const hostname = opts.hostname ?? osHostname();

  /*
   * `proper-lockfile.lock()` resolves the file's realpath and stats it,
   * so the marker file must already exist. Touch an empty file when
   * none is present; the body is overwritten further down once we own
   * the lock. Same pattern as `host-daemon/lockfile.ts`.
   */
  if (!existsSync(markerFile)) {
    writeFileSync(markerFile, "", { mode: 0o600 });
  }

  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(markerFile, {
      stale: 60_000,
      retries: opts.retries ?? 0,
    });
  } catch (err) {
    if (isLockHeldError(err)) {
      const existing = readMarker(markerFile);
      throw new AppStateOwnerConflictError(currentMode, existing, markerFile);
    }
    throw err;
  }

  // Lock acquired: we own the AppState dir. Stamp the marker body for
  // diagnostics (`parasor doctor`, incident response). Stale body
  // content from a previous owner is overwritten unconditionally --
  // proper-lockfile already decided that owner is gone.
  const marker = writeMarker(
    markerFile,
    currentMode,
    ourPid,
    startedAt,
    hostname,
  );

  return {
    marker,
    release: async () => {
      /*
       * Owner-verified body unlink (reviewed for correctness): only delete the
       * marker body if it still names *us*. A previous owner whose
       * lock got stale-stolen could otherwise unlink the new owner's
       * body during a delayed shutdown handler. Same pattern as the
       * daemon pidfile cleanup in `host-daemon/lockfile.ts`.
       */
      try {
        const recorded = readMarker(markerFile);
        if (
          recorded !== null &&
          recorded.pid === ourPid &&
          recorded.startedAt === startedAt
        ) {
          unlinkMarker(markerFile);
        }
      } catch {
        /* best-effort body cleanup */
      }
      try {
        await release();
      } catch (err) {
        /*
         * surface release failure to stderr so a
         * leftover `<marker>.lock/` directory after a crashy shutdown
         * is observable. proper-lockfile's stale-timeout (60s) makes
         * the next boot self-recover, but the operator still wants to
         * know.
         */
        console.error(
          `[mode-marker] release error for ${markerFile}: ${
            (err as Error).message
          }`,
        );
      }
    },
  };
}

function isLockHeldError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ELOCKED") return true;
  return /lock file is already being held/i.test(err.message);
}

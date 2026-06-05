import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * Image / file drops attached from the chat composer land here, NOT inside
 * the user's project tree. The directory layout is:
 *
 *   {rootDir}/uploads/{sessionId}/<filename>
 *
 * `{sessionId}` is opaque per-PTY (UUID). The directory is owned by the
 * server process and exposed to the live PTY child via the per-session
 * env var `PARASOR_UPLOAD_DIR` (set in `InProcessPtyHost.buildSessionEnv`)
 * -- never as a shared root -- so the Claude wrapper's `--add-dir` only
 * widens that PTY's allowlist to its own subdir, not its siblings'.
 *
 * Three-layer GC (upload staging isolation):
 *  L1 -- `releaseSession()` on PTY exit (immediate, in-process)
 *  L2 -- `sweepStale()` at server boot (handles SIGKILL leftovers)
 *  L3 -- `sweepStale()` on a 60-min interval (handles long-lived servers)
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const UPLOADS_SUBDIR = "uploads";
/** Owner-only -- drop dir contents may include unredacted screenshots. */
const DIR_MODE = 0o700;

/**
 * Validation failure for a sessionId that does not match the strict
 * format. Carries the raw value as a property so log sinks can decide
 * whether to record it; the human-readable `message` stays a fixed
 * literal so journald / file logs cannot be ANSI/newline-injected by an
 * attacker who controls the query string (reviewed for correctness).
 */
export class InvalidSessionIdError extends Error {
  readonly reason: "empty" | "format";
  /** Raw value as received. Not embedded in `message`. */
  readonly value: string;
  constructor(reason: "empty" | "format", value: string) {
    super(
      reason === "empty"
        ? "uploadStaging: empty sessionId"
        : "uploadStaging: invalid sessionId format",
    );
    this.reason = reason;
    this.value = value;
    this.name = "InvalidSessionIdError";
  }
}

/** Reject session-id strings that could escape the upload root. */
function assertSafeSessionId(sessionId: string): void {
  if (sessionId.length === 0) {
    throw new InvalidSessionIdError("empty", sessionId);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new InvalidSessionIdError("format", sessionId);
  }
}

function isNodeErrorWithCode(err: unknown, code: string): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === code
  );
}

export interface UploadStagingOptions {
  /**
   * Base directory. Resolved through `realpath()` once at construction
   * (macOS `/tmp` -> `/private/tmp`) so every later `startsWith(rootDir)`
   * fence compares canonical paths. Defaults to `${tmpdir()}/parasor`.
   */
  rootDir?: string;
  /**
   * Entries older than this in `sweepStale()` are removed. Default 24h.
   */
  ttlMs?: number;
  /**
   * Test injection point. Defaults to `Date.now`.
   */
  clock?: () => number;
}

export class UploadStaging {
  /** Canonical absolute path of `<rootDir>/uploads`. */
  readonly uploadsDir: string;
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(options: UploadStagingOptions = {}) {
    const baseRaw = options.rootDir ?? join(tmpdir(), "parasor");
    // mkdirSync runs before realpath because realpath() throws ENOENT on
    // a missing path. The constructor is sync to keep `index.ts` boot
    // ordering simple -- every subsequent operation is async.
    mkdirSync(baseRaw, { recursive: true, mode: DIR_MODE });
    const uploadsRaw = join(baseRaw, UPLOADS_SUBDIR);
    mkdirSync(uploadsRaw, { recursive: true, mode: DIR_MODE });
    // Reject if an attacker pre-planted a symlink at our root: realpath()
    // would happily follow the link and we'd write under their target.
    // lstat *before* realpath so the symlink itself is the thing we
    // inspect (reviewed for correctness). uid is checked against geteuid()
    // -- owning user only, no group/other writers.
    assertOwnedRealDir(baseRaw);
    assertOwnedRealDir(uploadsRaw);
    // realpath resolves symlinks (notably macOS /tmp -> /private/tmp).
    // Sync resolution keeps the public `uploadsDir` available for the
    // `--add-dir` env injection without forcing the constructor to be
    // async.
    this.uploadsDir = realpathSync(uploadsRaw);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.clock = options.clock ?? (() => Date.now());
  }

  /**
   * Acquire (or re-use) a session-scoped upload directory. The directory
   * name is `{sessionId}` -- opaque per-PTY, no timestamp suffix. Multiple
   * concurrent callers for the same sessionId race-safely converge on the
   * same directory because `mkdir({recursive:true})` is idempotent
   * (prior `recursive:false` would 500 on EEXIST).
   */
  async acquire(sessionId: string): Promise<string> {
    assertSafeSessionId(sessionId);
    const target = join(this.uploadsDir, sessionId);
    // Defence in depth -- the sanitizer above already proves `sessionId`
    // contains no separators, but the realpath-based fence catches a
    // future regression of the validator.
    if (!target.startsWith(this.uploadsDir + sep)) {
      throw new Error("uploadStaging: target escaped uploadsDir");
    }
    // recursive:true converts EEXIST into a no-op success. The caller
    // never sees an error if a sibling acquire() raced ahead, so two
    // PTYs requesting the same sessionId both get the same dir back.
    await mkdir(target, { recursive: true, mode: DIR_MODE });
    return target;
  }

  /**
   * L1 cleanup. Removes the session's directory tree if any. Best-effort:
   * a failure here is logged by the caller but never breaks shutdown.
   */
  async releaseSession(sessionId: string): Promise<void> {
    assertSafeSessionId(sessionId);
    const target = join(this.uploadsDir, sessionId);
    if (!target.startsWith(this.uploadsDir + sep)) return;
    await rm(target, { recursive: true, force: true });
  }

  /**
   * L2 / L3 cleanup. Walks `uploadsDir` and removes every entry whose
   * mtime is older than `ttlMs`. We stat instead of parsing the entry
   * name so a future-dated suffix cannot keep an entry alive forever
   * (reviewed for correctness). Returns the removed paths so callers can log
   * a single-line summary.
   */
  async sweepStale(now: number = this.clock()): Promise<{ swept: string[] }> {
    const cutoff = now - this.ttlMs;
    const swept: string[] = [];
    let entries: string[];
    try {
      entries = await readdir(this.uploadsDir);
    } catch (err) {
      if (isNodeErrorWithCode(err, "ENOENT")) return { swept };
      throw err;
    }
    for (const name of entries) {
      const full = join(this.uploadsDir, name);
      // Same fence as acquire: never act outside uploadsDir.
      if (!full.startsWith(this.uploadsDir + sep)) continue;
      try {
        const st = await stat(full);
        // Both birthtime (creation) and mtime (last write) must be old
        // enough to retire -- a stale dir whose user keeps appending
        // files stays alive while it's still in use.
        const ageRef = Math.max(st.mtimeMs, st.birthtimeMs || 0);
        if (ageRef > cutoff) continue;
      } catch (err) {
        if (isNodeErrorWithCode(err, "ENOENT")) continue;
        throw err;
      }
      try {
        await rm(full, { recursive: true, force: true });
        swept.push(full);
      } catch (err) {
        if (isNodeErrorWithCode(err, "ENOENT")) continue;
        // Log + continue: a stuck entry must not block the rest of the
        // sweep. Caller has no actionable response.
        console.error("[upload-staging] sweep rm failed:", full, err);
      }
    }
    return { swept };
  }
}

/**
 * Best-effort removal of the legacy `.parasor/drops/` directory inside a
 * project root. Upload staging isolation retires the in-tree drop layout entirely; on
 * server boot the upload route's old dirs are deleted from every known
 * project so the surface area for "stale screenshot in repo" goes to
 * zero. Errors are swallowed (logged by caller) -- the legacy dir is
 * already `.gitignore`d, so failure to delete is non-fatal.
 *
 * target is narrowed to `.parasor/drops/`. The
 * parent `.parasor/` namespace is removed only when it ends up empty,
 * so future code writing other entries under `.parasor/<other>` is
 * not nuked by every server boot.
 */
export async function removeLegacyDropsDir(
  projectRoot: string,
): Promise<{ removed: boolean }> {
  // Realpath the project root first so a project pointer like
  // `~/projects/foo` (already expanded by caller) is canonicalized
  // before the startsWith fence below.
  let realProject: string;
  try {
    realProject = await realpath(projectRoot);
  } catch (err) {
    if (isNodeErrorWithCode(err, "ENOENT")) return { removed: false };
    throw err;
  }
  const parasorDir = resolve(realProject, ".parasor");
  const dropsDir = resolve(parasorDir, "drops");
  // Reject if `.parasor` itself is a symlink -- refuse to follow into
  // arbitrary territory. Using lstat (not stat) so the symlink itself
  // is the thing we inspect.
  try {
    const parasorLst = await lstat(parasorDir);
    if (parasorLst.isSymbolicLink()) return { removed: false };
  } catch (err) {
    if (isNodeErrorWithCode(err, "ENOENT")) return { removed: false };
    throw err;
  }
  // Defence in depth: re-canonicalize and verify the drops path stays
  // inside the project root. Catches a `.parasor/drops -> /etc` symlink
  // even after the parent-dir lstat above passed.
  let realDrops: string;
  try {
    realDrops = await realpath(dropsDir);
  } catch (err) {
    if (isNodeErrorWithCode(err, "ENOENT")) return { removed: false };
    throw err;
  }
  if (
    realDrops !== resolve(realProject, ".parasor", "drops") ||
    !realDrops.startsWith(realProject + sep)
  ) {
    return { removed: false };
  }
  await rm(realDrops, { recursive: true, force: true });
  // Best-effort: clean the now-orphaned `.parasor/` shell, but only if
  // empty. Other tooling that legitimately writes to `.parasor/<other>`
  // (future features, user scripts) keeps its data.
  try {
    await rmdir(parasorDir);
  } catch (err) {
    // ENOTEMPTY = other entries present (future namespace neighbours);
    // ENOENT = removed concurrently. Both fine.
    if (
      !isNodeErrorWithCode(err, "ENOTEMPTY") &&
      !isNodeErrorWithCode(err, "ENOENT") &&
      // Some platforms return EEXIST instead of ENOTEMPTY for non-empty
      // rmdir (POSIX permits either).
      !isNodeErrorWithCode(err, "EEXIST")
    ) {
      throw err;
    }
  }
  return { removed: true };
}

/**
 * Refuse to use `path` if its `lstat` reports it as a symlink, or its
 * owner uid does not match the running process's effective uid. The
 * latter check is skipped on Windows where `geteuid` is unavailable;
 * elsewhere it ensures an attacker who pre-created the dir under a
 * different user cannot trick us into writing secrets they can read.
 */
function assertOwnedRealDir(path: string): void {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(path);
  } catch {
    // Constructor only calls this after a successful mkdirSync so
    // ENOENT here would be a TOCTOU race -- refuse to continue.
    throw new Error(`uploadStaging: cannot lstat ${path}`);
  }
  if (st.isSymbolicLink()) {
    throw new Error(`uploadStaging: refusing symlink at ${path}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`uploadStaging: not a directory: ${path}`);
  }
  // process.geteuid is undefined on Windows; skip the uid check there.
  const geteuid = (process as { geteuid?: () => number }).geteuid;
  if (geteuid) {
    const me = geteuid();
    if (st.uid !== me) {
      throw new Error(
        `uploadStaging: ${path} is owned by uid ${st.uid}, expected ${me}`,
      );
    }
  }
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitChangeEntry,
  GitChangeStatus,
  GitState,
} from "@parasor/shared";

const execFileAsync = promisify(execFile);

const ESCAPE_MAP: Record<string, string> = {
  "\\": "\\",
  '"': '"',
  n: "\n",
  t: "\t",
  a: "\x07",
  b: "\b",
  f: "\f",
  r: "\r",
  v: "\v",
};

function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"')
    return raw;
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next >= "0" && next <= "3" && i + 3 < inner.length) {
        const octal = inner.slice(i + 1, i + 4);
        if (/^[0-3][0-7]{2}$/.test(octal)) {
          bytes.push(parseInt(octal, 8));
          i += 3;
          continue;
        }
      }
      const mapped = ESCAPE_MAP[next];
      if (mapped !== undefined) {
        for (let j = 0; j < mapped.length; j++)
          bytes.push(mapped.charCodeAt(j));
        i++;
        continue;
      }
    }
    bytes.push(inner.charCodeAt(i));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function findArrowInPorcelainPath(pathPart: string): number {
  if (pathPart.startsWith('"')) {
    // Old path is quoted -- find closing quote (skip escaped quotes)
    for (let i = 1; i < pathPart.length; i++) {
      if (pathPart[i] === "\\" && i + 1 < pathPart.length) {
        i++;
        continue;
      }
      if (pathPart[i] === '"') return pathPart.indexOf(" -> ", i + 1);
    }
    return -1;
  }
  return pathPart.indexOf(" -> ");
}

/**
 * Parse `git status --porcelain` output into a map of relative paths to status codes.
 * Format per line: "XY path" where X=index status, Y=worktree status.
 * Returns the most relevant single status character per file.
 */
export function parseGitPorcelain(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    if (line.length < 4) continue;
    const x = line[0]; // index status
    const y = line[1]; // worktree status
    const pathPart = line.slice(3);
    // Handle renames/copies: "R  old -> new" / "C  old -> new"
    const isRenameOrCopy = x === "R" || x === "C";
    const arrowIdx = isRenameOrCopy ? findArrowInPorcelainPath(pathPart) : -1;
    const rawPath = arrowIdx >= 0 ? pathPart.slice(arrowIdx + 4) : pathPart;
    const filePath = unquoteGitPath(rawPath);

    // Pick the most visible status: worktree status takes priority over index
    // unless index-only (staged but worktree clean)
    if (x === "?" && y === "?") {
      result[filePath] = "?";
    } else if (y !== " " && y !== "?") {
      result[filePath] = y; // worktree change (M, D, etc.)
    } else if (x !== " " && x !== "?") {
      result[filePath] = x; // index-only change (staged)
    }
  }
  return result;
}

export interface GitStatusV2Counts {
  /** Commits ahead of upstream. `undefined` when no upstream tracking. */
  ahead?: number;
  /** Commits behind upstream. `undefined` when no upstream tracking. */
  behind?: number;
  /** Tracked changes + untracked entries (rename pairs counted once). */
  dirtyCount: number;
}

/**
 * Parse `git status --porcelain=v2 -b` output into ahead/behind/dirtyCount.
 *
 * v2 line shapes (per `git-status(1)`):
 *   `# branch.ab +N -M`           upstream tracking header (omitted when no upstream)
 *   `1 XY ...`                    ordinary changed entry
 *   `2 XY ...`                    rename/copy entry
 *   `u XY ...`                    unmerged entry
 *   `? <path>`                    untracked
 *   `! <path>`                    ignored (excluded from dirtyCount)
 *
 * `dirtyCount` includes 1/2/u entries plus `?` untracked. Ignored `!` is
 * deliberately excluded so the sidebar counter matches what the user sees as
 * actionable change.
 */
export function parseGitStatusV2(raw: string): GitStatusV2Counts {
  let ahead: number | undefined;
  let behind: number | undefined;
  let dirtyCount = 0;
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    if (line.startsWith("# branch.ab ")) {
      const m = line.slice(12).match(/^([+-]?\d+)\s+([+-]?\d+)/);
      if (m) {
        // git emits `+N -M` so behind is signed negative; abs flips it.
        ahead = Math.abs(parseInt(m[1], 10));
        behind = Math.abs(parseInt(m[2], 10));
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    const head = line[0];
    if (head === "1" || head === "2" || head === "u" || head === "?") {
      dirtyCount += 1;
    }
  }
  return { ahead, behind, dirtyCount };
}

export interface GitStatusV2Snapshot {
  branch: string;
  ahead?: number;
  behind?: number;
  dirtyCount: number;
  fileStatuses: Record<string, string>;
  changes: GitChangeEntry[];
}

/**
 * Parse `git status --porcelain=v2 -b -z` output into both the file-status
 * map (used by the filetree diff badges) and the ahead/behind/dirtyCount
 * summary (used by WorktreeTabBar). One pass replaces the earlier
 * v1+v2 dual call so the watcher can refresh the live counters on every
 * tick without an extra `git status` round-trip.
 *
 * v2 entry shapes (`git-status(1)` `--porcelain=v2`):
 *   `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`        ordinary entry
 *   `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<orig>`  rename
 *   `u <XY> ...`                                            unmerged
 *   `? <path>`                                              untracked
 *   `! <path>`                                              ignored (skipped)
 *
 * `-z` switches to NUL-delimited records and disables the legacy
 * shell-quoted path encoding, so paths with spaces / unicode arrive verbatim
 * without us having to decode escape sequences.
 */
export function parseGitStatusV2WithFiles(raw: string): GitStatusV2Snapshot {
  let branch = "";
  let ahead: number | undefined;
  let behind: number | undefined;
  let dirtyCount = 0;
  const fileStatuses: Record<string, string> = {};
  const changes: GitChangeEntry[] = [];

  // `-z` separates records by NUL. Renames carry an extra NUL between new
  // and old paths; the loop reads the next record on encountering one.
  const records = raw.split("\0");
  for (let i = 0; i < records.length; i++) {
    const line = records[i];
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const m = line
        .slice("# branch.ab ".length)
        .match(/^([+-]?\d+)\s+([+-]?\d+)/);
      if (m) {
        ahead = Math.abs(parseInt(m[1], 10));
        behind = Math.abs(parseInt(m[2], 10));
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    const head = line[0];
    if (head === "1") {
      // `1 XY ... <path>` -- fields 1..7 are space-delimited; path is the
      // remainder after the 8th space.
      const parts = line.split(" ");
      if (parts.length < 9) continue;
      const xy = parts[1];
      const path = parts.slice(8).join(" ");
      const code = pickStatusCode(xy);
      if (code) fileStatuses[path] = code;
      const entry = buildChangeEntry(path, xy, code);
      if (entry) changes.push(entry);
      dirtyCount += 1;
    } else if (head === "2") {
      // Rename/copy. Path = current name (this record's tail), original
      // path = next NUL-delimited record (consumed below).
      const parts = line.split(" ");
      if (parts.length < 10) continue;
      const xy = parts[1];
      const newPath = parts.slice(9).join(" ");
      const code = pickStatusCode(xy);
      if (code) fileStatuses[newPath] = code;
      const oldPath = records[i + 1];
      const entry = buildChangeEntry(newPath, xy, code, oldPath);
      if (entry) changes.push(entry);
      dirtyCount += 1;
      i += 1; // skip the original-path record
    } else if (head === "u") {
      const parts = line.split(" ");
      if (parts.length < 11) continue;
      const path = parts.slice(10).join(" ");
      fileStatuses[path] = "U";
      changes.push({
        path,
        area: "unstaged",
        status: "conflict",
        code: "U",
        conflict: true,
        indexStatus: parts[1]?.[0],
        worktreeStatus: parts[1]?.[1],
      });
      dirtyCount += 1;
    } else if (head === "?") {
      // `? <path>` -- single space, then path.
      const path = line.slice(2);
      fileStatuses[path] = "?";
      changes.push({
        path,
        area: "untracked",
        status: "untracked",
        code: "?",
      });
      dirtyCount += 1;
    }
    // `!` ignored entries are skipped (would only appear with --ignored).
  }

  return { branch, ahead, behind, dirtyCount, fileStatuses, changes };
}

function stderrOf(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const e = err as { stderr?: string | Buffer };
  if (typeof e.stderr === "string") return e.stderr;
  if (e.stderr instanceof Buffer) return e.stderr.toString("utf8");
  return "";
}

function pickStatusCode(xy: string): string | null {
  if (xy.length !== 2) return null;
  const x = xy[0];
  const y = xy[1];
  if (y !== "." && y !== " ") return y;
  if (x !== "." && x !== " ") return x;
  return null;
}

function isChangedStatus(value: string | undefined): boolean {
  return value !== undefined && value !== "." && value !== " ";
}

function statusFromCode(code: string, oldPath?: string): GitChangeStatus {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  if (code === "?") return "untracked";
  if (code === "U") return "conflict";
  if (oldPath) return "renamed";
  return "modified";
}

function buildChangeEntry(
  path: string,
  xy: string,
  code: string | null,
  oldPath?: string,
): GitChangeEntry | null {
  if (!code) return null;
  const indexStatus = xy[0];
  const worktreeStatus = xy[1];
  const indexChanged = isChangedStatus(indexStatus);
  const worktreeChanged = isChangedStatus(worktreeStatus);
  return {
    path,
    area: worktreeChanged ? "unstaged" : "staged",
    status: statusFromCode(code, oldPath),
    code,
    ...(oldPath ? { oldPath } : {}),
    ...(indexChanged ? { indexStatus } : {}),
    ...(worktreeChanged ? { worktreeStatus } : {}),
  };
}

function cacheKey(projectId: string, worktreePath: string): string {
  return `${projectId}|${worktreePath}`;
}

export class GitWatcher {
  private cache = new Map<string, GitState | null>();

  async check(worktreePath: string): Promise<GitState | null> {
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", worktreePath, "status", "--porcelain=v2", "-b", "-z"],
        {
          timeout: 5000,
          env,
          // `--porcelain=v2 -z` on a repo with thousands of dirty entries
          // can blow past Node's 1MiB default. Match project-queries.ts so
          // the watcher and ad-hoc enrichment fail in identical conditions.
          maxBuffer: 16 * 1024 * 1024,
        },
      );

      const snap = parseGitStatusV2WithFiles(stdout);
      const dirty = snap.dirtyCount > 0;
      return {
        branch: snap.branch,
        dirty,
        fileStatuses: dirty ? snap.fileStatuses : undefined,
        changes: dirty ? snap.changes : undefined,
        ahead: snap.ahead,
        behind: snap.behind,
        dirtyCount: snap.dirtyCount,
        lastChecked: Date.now(),
      };
    } catch (err) {
      // Distinguish "not a git repository" from transient errors so the Git
      // pane can offer `git init` instead of a blank "loading…" state.
      // Inspect stderr only -- message text is locale-stable in C/C.UTF-8 git
      // builds (`fatal: not a git repository`).
      const stderr = stderrOf(err).toLowerCase();
      if (stderr.includes("not a git repository")) {
        return {
          branch: "",
          dirty: false,
          isRepo: false,
          lastChecked: Date.now(),
        };
      }
      return null;
    }
  }

  async checkAndDiff(
    projectId: string,
    worktreePath: string,
  ): Promise<{ state: GitState | null; changed: boolean }> {
    const state = await this.check(worktreePath);
    const key = cacheKey(projectId, worktreePath);
    const cached = this.cache.get(key);

    const fileStatusesChanged = !fileStatusesEqual(
      state?.fileStatuses,
      cached?.fileStatuses,
    );
    const changesChanged = !changesEqual(state?.changes, cached?.changes);
    const changed =
      state?.branch !== cached?.branch ||
      state?.dirty !== cached?.dirty ||
      state?.ahead !== cached?.ahead ||
      state?.behind !== cached?.behind ||
      state?.dirtyCount !== cached?.dirtyCount ||
      // The repo/non-repo transition (`git init` flipping isRepo from false
      // to undefined+populated) usually shows up as a branch change, but the
      // sidebar gates `root` label / folder icon / `Initialize git…` menu
      // strictly on `isRepo === false`. Including it here guarantees the
      // UI re-renders the moment the flag flips, even on degenerate cases
      // where the post-init branch happens to read as `""`.
      state?.isRepo !== cached?.isRepo ||
      fileStatusesChanged ||
      changesChanged;

    if (changed) {
      this.cache.set(key, state);
    }

    return { state, changed };
  }

  getCached(projectId: string, worktreePath: string): GitState | null {
    return this.cache.get(cacheKey(projectId, worktreePath)) ?? null;
  }

  /**
   * Snapshot of every cached state grouped by project. Outer key = projectId,
   * inner key = worktreePath. Hydration payload consumes this shape directly.
   */
  getAllCached(): Record<string, Record<string, GitState | null>> {
    const result: Record<string, Record<string, GitState | null>> = {};
    for (const [k, v] of this.cache) {
      const idx = k.indexOf("|");
      if (idx < 0) continue;
      const projectId = k.slice(0, idx);
      const worktreePath = k.slice(idx + 1);
      const projectCache = result[projectId] ?? {};
      result[projectId] = projectCache;
      projectCache[worktreePath] = v;
    }
    return result;
  }

  /** Clear all worktree entries belonging to a project. */
  clearProject(projectId: string): void {
    const prefix = `${projectId}|`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /** Clear a single worktree entry. */
  clearWorktree(projectId: string, worktreePath: string): void {
    this.cache.delete(cacheKey(projectId, worktreePath));
  }
}

function fileStatusesEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((k) => a[k] === b[k]);
}

function changesEqual(
  a: GitChangeEntry[] | undefined,
  b: GitChangeEntry[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((entry, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      entry.path === other.path &&
      entry.area === other.area &&
      entry.status === other.status &&
      entry.code === other.code &&
      entry.oldPath === other.oldPath &&
      entry.conflict === other.conflict &&
      entry.indexStatus === other.indexStatus &&
      entry.worktreeStatus === other.worktreeStatus
    );
  });
}

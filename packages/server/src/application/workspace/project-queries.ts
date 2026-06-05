import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { Worktree } from "@parasor/shared";
import { parseGitStatusV2 } from "../../fs/git-watcher.js";
import type { ProjectManager } from "../../state/project-manager.js";
import { WorkspaceNotFoundError } from "./errors.js";
import { listWorktreeLocalFileCandidates } from "./worktree-local-files.js";

const execFileAsync = promisify(execFile);

/**
 * Path-prefix tags identifying worktrees created by Agent Team isolation.
 * Each entry below pairs the human-readable origin (`"agent"`) with the
 * directory roots used by the orchestration tooling we ship.
 *   - `<home>/.parasor/worktrees/`     -- parasor multi-issue isolation roots
 *   - `<home>/.claude/teams/`           -- claude-code team scratch dirs
 *   - `/private/tmp/parasor-issue-*`    -- macOS-resolved temp staging
 *   - `/tmp/parasor-issue-*`            -- Linux temp staging
 * Path matching is purely lexical (no fs probes) so classification stays
 * cheap and deterministic -- a worktree at `/tmp/parasor-issue-300/x` still
 * counts as agent-spawned even after the issue closes.
 */
function agentPathPrefixes(): string[] {
  const home = homedir();
  return [
    `${home}/.parasor/worktrees/`,
    `${home}/.claude/teams/`,
    "/private/tmp/parasor-issue-",
    "/tmp/parasor-issue-",
  ];
}

function classifyOrigin(path: string): "agent" | undefined {
  for (const prefix of agentPathPrefixes()) {
    if (path.startsWith(prefix)) return "agent";
  }
  return undefined;
}

export function parseWorktreeList(porcelain: string): Worktree[] {
  const entries: Worktree[] = [];
  let current: Worktree | null = null;

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      const path = line.slice(9);
      const origin = classifyOrigin(path);
      current = { path, head: "", branch: "" };
      if (origin) current.origin = origin;
    } else if (line.startsWith("HEAD ") && current) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    }
  }

  if (current) entries.push(current);
  return entries;
}

interface CreateProjectQueriesDeps {
  projectManager: ProjectManager;
  runGit?: (projectPath: string, args: string[]) => Promise<string>;
}

export async function defaultRunGit(
  projectPath: string,
  args: string[],
): Promise<string> {
  // `cwd` (not `git -C path`) so spawn-time `chdir(projectPath)` is what
  // fails when the directory is gone. That fork-level failure surfaces as
  // `err.code === "ENOENT"` to the caller -- `isMissingPathError` keys on
  // exactly that signal to flip the orphan flag. With `git -C` the binary
  // exits 128 with a localized stderr, which we cannot match safely.
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectPath,
    timeout: 5000,
    // Node default is 1MiB. `git status --porcelain=v2 -b` on a repo with
    // thousands of untracked / renamed entries blows past it and rejects;
    // the catch then silently zeroes counters. Bump to 16MiB so the
    // counter pipeline degrades only on truly pathological repos.
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Cap on parallel `git status` invocations. A repo with many worktrees would
 * otherwise fan out to N child processes at once; large N starves the event
 * loop and the OS process table. 8 is comfortably above sequential without
 * pegging the host on realistic parasor installs.
 */
const ENRICH_CONCURRENCY = 8;

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Treat only `execFile`'s ENOENT as "the worktree directory is gone".
 * That is the signal Node emits when `cwd` itself can't be resolved.
 * A regex on stderr/message would false-positive on `.git` file
 * corruption (`fatal: Not a git repository: '/path/to/wt/.git'`,
 * `unable to read tree …: No such file or directory`) and silently
 * mark live worktrees as orphans, which the UI then offers to prune.
 */
function isMissingPathError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown };
  return e.code === "ENOENT";
}

/**
 * Enrich each worktree with ahead/behind/dirtyCount via
 * `git status --porcelain=v2 -b` per worktree path. Failures are non-fatal:
 * the worktree is returned with counter fields omitted (treated as 0 in UI).
 * A failure that looks like the path itself is gone flips the orphan flag
 * so the sidebar can offer a force-prune affordance.
 */
async function enrichWithCounters(
  entries: Worktree[],
  runGit: (projectPath: string, args: string[]) => Promise<string>,
): Promise<Worktree[]> {
  return mapWithLimit(entries, ENRICH_CONCURRENCY, async (wt) => {
    try {
      const raw = await runGit(wt.path, ["status", "--porcelain=v2", "-b"]);
      const { ahead, behind, dirtyCount } = parseGitStatusV2(raw);
      return { ...wt, ahead, behind, dirtyCount };
    } catch (err) {
      if (isMissingPathError(err)) {
        return { ...wt, orphan: true };
      }
      return wt;
    }
  });
}

export function createProjectQueries({
  projectManager,
  runGit = defaultRunGit,
}: CreateProjectQueriesDeps) {
  function getProjectOrThrow(id: string) {
    const project = projectManager.get(id);
    if (!project) throw new WorkspaceNotFoundError();
    return project;
  }

  return {
    listProjects() {
      return projectManager.list();
    },

    async getWorktreeLocalFiles(id: string) {
      const project = getProjectOrThrow(id);
      const candidates = await listWorktreeLocalFileCandidates(project.path);
      return {
        candidates,
        rememberedPaths: project.worktreeLocalFileAllowlist ?? [],
      };
    },

    async getProjectDiff(id: string, worktreePath: string) {
      getProjectOrThrow(id);

      // `diff HEAD` returns working-tree + index combined, so a file with only
      // staged changes still appears. Plain `diff` (= unstaged) would silently
      // drop those entries from the uncommitted/diff panes.
      try {
        return await runGit(worktreePath, ["diff", "HEAD", "--no-color"]);
      } catch {
        return "";
      }
    },

    async getProjectCommitDiff(id: string, sha: string, worktreePath: string) {
      getProjectOrThrow(id);
      try {
        return await runGit(worktreePath, [
          "show",
          "--no-color",
          "--format=",
          sha,
        ]);
      } catch {
        return "";
      }
    },

    async getProjectWorktrees(id: string) {
      const project = getProjectOrThrow(id);

      try {
        const porcelain = await runGit(project.path, [
          "worktree",
          "list",
          "--porcelain",
        ]);
        const list = parseWorktreeList(porcelain);
        return enrichWithCounters(list, runGit);
      } catch {
        return [];
      }
    },

    async listAllWorktrees(): Promise<Record<string, Worktree[]>> {
      const projects = projectManager.list();
      const entries = await mapWithLimit(
        projects,
        ENRICH_CONCURRENCY,
        async (project) => {
          try {
            const porcelain = await runGit(project.path, [
              "worktree",
              "list",
              "--porcelain",
            ]);
            const list = parseWorktreeList(porcelain);
            const enriched = await enrichWithCounters(list, runGit);
            return [project.id, enriched] as const;
          } catch {
            return [project.id, []] as const;
          }
        },
      );
      return Object.fromEntries(entries);
    },
  };
}

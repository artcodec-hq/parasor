import type {
  GitCommit,
  GitLogResponse,
  GitRef,
  SwimlaneSnapshot,
} from "@parasor/shared";
import { Hono } from "hono";
import {
  fenceWorktreePathWith,
  validateBranchName,
} from "../application/workspace/worktree-commands.js";
import type { ProjectRuntime } from "../bootstrap/project-runtime.js";
import { GitExecError, runGit } from "../lib/git-exec.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { WorktreeCache } from "../state/worktree-cache.js";
import { resolveWorktreeOrError } from "./lib/resolve-worktree.js";

export interface GitRoutesDeps {
  projectManager: ProjectManager;
  worktreeCache: WorktreeCache;
  projectRuntime: ProjectRuntime;
}

interface MutationBody {
  worktreePath?: string;
}

interface CommitBody extends MutationBody {
  message?: string;
  paths?: string[];
}

interface PushBody extends MutationBody {
  setUpstream?: boolean;
}

interface PullBody extends MutationBody {
  rebase?: boolean;
}

interface SwitchBody extends MutationBody {
  branch?: string;
}

interface CreateBranchBody extends MutationBody {
  branch?: string;
  startPoint?: string;
}

function mapGitError(err: unknown): {
  status: 409 | 500;
  error: string;
} | null {
  if (!(err instanceof GitExecError)) return null;
  const message = (err.stderr || err.stdout || err.message).trim();
  return { status: 409, error: message };
}

export function createGitRoutes(deps: GitRoutesDeps): Hono {
  const { projectManager, worktreeCache, projectRuntime } = deps;
  const routes = new Hono();
  // Bind `/:id` on the middleware path. A pathless `use()` runs before the
  // route match, so `c.req.param("id")` is empty and the 409 never fires.
  routes.use("/:id/*", async (c, next) => {
    const id = c.req.param("id");
    if (id && projectRuntime.isMissing(id)) {
      return c.json({ error: "Project directory is missing" }, 409);
    }
    await next();
  });

  const fenceWorktreePath = (projectId: string, worktreePath: string) =>
    fenceWorktreePathWith(
      {
        projectManager,
        getProjectWorktrees: (id) => worktreeCache.get()[id] ?? [],
      },
      projectId,
      worktreePath,
    );

  routes.get("/:id/git/status", async (c) => {
    const projectId = c.req.param("id");
    const worktreePath = c.req.query("worktreePath");
    const resolved = await resolveWorktreeOrError(
      fenceWorktreePath,
      projectId,
      worktreePath,
    );
    if (!resolved.ok) return c.json(resolved.body, resolved.status);
    await projectRuntime.refreshGitState(projectId, resolved.resolved);
    const states = projectRuntime.getGitStates();
    const state = states[projectId]?.[resolved.resolved] ?? null;
    return c.json({ state });
  });

  routes.post("/:id/git/commit", async (c) => {
    const projectId = c.req.param("id");
    const body = await c.req.json<CommitBody>().catch(() => ({}) as CommitBody);
    const resolved = await resolveWorktreeOrError(
      fenceWorktreePath,
      projectId,
      body.worktreePath,
    );
    if (!resolved.ok) return c.json(resolved.body, resolved.status);

    const message = body.message?.trim();
    if (!message) {
      return c.json({ error: "message is required" }, 400);
    }
    if (!Array.isArray(body.paths) || body.paths.length === 0) {
      return c.json({ error: "paths must be a non-empty array" }, 400);
    }
    if (!body.paths.every((p) => typeof p === "string" && p.length > 0)) {
      return c.json({ error: "paths must be non-empty strings" }, 400);
    }
    // `--` terminates flag parsing so a path that happens to start with `-`
    // can never be interpreted as a git option.
    const paths = body.paths;

    try {
      await runGit(resolved.resolved, ["add", "--", ...paths]);
      await runGit(resolved.resolved, [
        "commit",
        "-m",
        message,
        "--",
        ...paths,
      ]);
    } catch (err) {
      const mapped = mapGitError(err);
      if (mapped) return c.json({ error: mapped.error }, mapped.status);
      throw err;
    }

    await projectRuntime.refreshGitState(projectId, resolved.resolved);
    return c.json({ ok: true });
  });

  routes.post("/:id/git/push", async (c) => {
    const projectId = c.req.param("id");
    const body = await c.req.json<PushBody>().catch(() => ({}) as PushBody);
    const resolved = await resolveWorktreeOrError(
      fenceWorktreePath,
      projectId,
      body.worktreePath,
    );
    if (!resolved.ok) return c.json(resolved.body, resolved.status);

    const args = ["push"];
    if (body.setUpstream === true) {
      try {
        const { stdout } = await runGit(resolved.resolved, [
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        ]);
        const branch = stdout.trim();
        if (!branch || branch === "HEAD") {
          return c.json({ error: "Detached HEAD -- cannot set upstream" }, 409);
        }
        args.push("--set-upstream", "origin", branch);
      } catch (err) {
        const mapped = mapGitError(err);
        if (mapped) return c.json({ error: mapped.error }, mapped.status);
        throw err;
      }
    }

    try {
      await runGit(resolved.resolved, args, { timeoutMs: 60_000 });
    } catch (err) {
      const mapped = mapGitError(err);
      if (mapped) return c.json({ error: mapped.error }, mapped.status);
      throw err;
    }

    await projectRuntime.refreshGitState(projectId, resolved.resolved);
    return c.json({ ok: true });
  });

  routes.post("/:id/git/pull", async (c) => {
    const projectId = c.req.param("id");
    const body = await c.req.json<PullBody>().catch(() => ({}) as PullBody);
    const resolved = await resolveWorktreeOrError(
      fenceWorktreePath,
      projectId,
      body.worktreePath,
    );
    if (!resolved.ok) return c.json(resolved.body, resolved.status);

    const args = ["pull"];
    if (body.rebase === true) args.push("--rebase");

    try {
      await runGit(resolved.resolved, args, { timeoutMs: 60_000 });
    } catch (err) {
      const mapped = mapGitError(err);
      if (mapped) return c.json({ error: mapped.error }, mapped.status);
      throw err;
    }

    await projectRuntime.refreshGitState(projectId, resolved.resolved);
    return c.json({ ok: true });
  });

  routes.post("/:id/git/switch", async (c) => {
    const projectId = c.req.param("id");
    const body = await c.req.json<SwitchBody>().catch(() => ({}) as SwitchBody);
    const resolved = await resolveWorktreeOrError(
      fenceWorktreePath,
      projectId,
      body.worktreePath,
    );
    if (!resolved.ok) return c.json(resolved.body, resolved.status);

    const branch = body.branch?.trim();
    if (!branch) {
      return c.json({ error: "branch is required" }, 400);
    }
    const validation = validateBranchName(branch);
    if (validation) {
      return c.json({ error: validation }, 400);
    }

    try {
      await runGit(resolved.resolved, ["switch", branch], {
        timeoutMs: 60_000,
      });
    } catch (err) {
      const mapped = mapGitError(err);
      if (mapped) return c.json({ error: mapped.error }, mapped.status);
      throw err;
    }

    await projectRuntime.refreshGitState(projectId, resolved.resolved);
    return c.json({ ok: true, branch });
  });

  routes.post("/:id/git/branch", async (c) => {
    const projectId = c.req.param("id");
    const body = await c.req
      .json<CreateBranchBody>()
      .catch(() => ({}) as CreateBranchBody);
    const resolved = await resolveWorktreeOrError(
      fenceWorktreePath,
      projectId,
      body.worktreePath,
    );
    if (!resolved.ok) return c.json(resolved.body, resolved.status);

    const branch = body.branch?.trim();
    if (!branch) {
      return c.json({ error: "branch is required" }, 400);
    }
    const validation = validateBranchName(branch);
    if (validation) {
      return c.json({ error: validation }, 400);
    }

    const startPoint = body.startPoint?.trim();
    if (!startPoint) {
      return c.json({ error: "startPoint is required" }, 400);
    }
    const startPointValidation = validateBranchName(startPoint);
    if (startPointValidation) {
      return c.json({ error: `startPoint: ${startPointValidation}` }, 400);
    }

    try {
      await runGit(resolved.resolved, ["switch", "-c", branch, startPoint], {
        timeoutMs: 60_000,
      });
    } catch (err) {
      const mapped = mapGitError(err);
      if (mapped) return c.json({ error: mapped.error }, mapped.status);
      throw err;
    }

    await projectRuntime.refreshGitState(projectId, resolved.resolved);
    return c.json({ ok: true, branch, startPoint });
  });

  // Returns the recent commit log + a flag telling the client whether the
  // working tree currently has uncommitted changes (so the graph can prepend
  // a virtual selectable row). Capped at 500 per page; pagination via
  // `skip=<n>`; remote branches via `includeRemotes=1`.
  routes.get("/:id/git/log", async (c) => {
    const projectId = c.req.param("id");
    const worktreePath = c.req.query("worktreePath");
    const limitParam = c.req.query("limit");
    const skipParam = c.req.query("skip");
    const includeRemotes = c.req.query("includeRemotes") === "1";
    const limit = (() => {
      const n = limitParam ? parseInt(limitParam, 10) : 200;
      if (!Number.isFinite(n) || n <= 0) return 200;
      return Math.min(n, 500);
    })();
    const skip = (() => {
      const n = skipParam ? parseInt(skipParam, 10) : 0;
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.min(n, 100_000);
    })();
    const resolved = await resolveWorktreeOrError(
      fenceWorktreePath,
      projectId,
      worktreePath,
    );
    if (!resolved.ok) return c.json(resolved.body, resolved.status);

    // `+1` lookahead lets the parser see the very next commit past the
    // requested page so the last visible row's outputSwimlanes resolves its
    // first-parent lane correctly. Without this, page-1's last commit would
    // terminate its lane (parent out-of-window) while page-2 sees the same
    // lane continuing -- producing a visible break at the boundary.
    const fetchTotal = skip + limit + 1;
    // Re-walk from the newest commit each request rather than `--skip=N`
    // sliced server-side. parseGitLog computes swimlane state by walking
    // commits in order; if page 2 starts fresh, the first commit's
    // inputSwimlanes get reset and lanes/colors visibly snap at the page
    // boundary. Pulling `skip+limit+1` from the head and slicing the
    // requested window post-parse keeps the swimlane state continuous.
    const args: string[] = [
      "log",
      `-${fetchTotal}`,
      // `--decorate=full` keeps `refs/heads/`, `refs/remotes/`, `refs/tags/`
      // prefixes so the parser can distinguish local vs remote branches
      // (a `/` in a name like `feat/foo` is otherwise indistinguishable
      // from `origin/foo`).
      "--decorate=full",
      // Field separator NUL, record separator RS (0x1e). Keeps subjects
      // with embedded newlines intact and avoids escaping.
      "--format=%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e",
    ];
    if (includeRemotes) {
      // Walk every local branch, every remote-tracking branch, and HEAD --
      // mirrors VSCode's SCM Graph default. Excludes tags/stashes which add
      // noise without clarifying branch topology.
      args.push("--branches", "--remotes", "HEAD");
    }
    let stdout = "";
    try {
      const result = await runGit(resolved.resolved, args);
      stdout = result.stdout;
    } catch (err) {
      // `git log` exits 128 on an unborn branch / empty repo; treat that as
      // an empty history rather than an error so the graph shows the
      // (possibly uncommitted) working tree row instead of a fatal banner.
      if (err instanceof GitExecError) {
        const stderr = (err.stderr || "").toLowerCase();
        const isEmptyRepo =
          stderr.includes("does not have any commits yet") ||
          stderr.includes("bad default revision") ||
          stderr.includes("unknown revision or path");
        if (!isEmptyRepo) {
          const mapped = mapGitError(err);
          if (mapped) return c.json({ error: mapped.error }, mapped.status);
          throw err;
        }
        // includeRemotes=1 + unborn HEAD: drop the explicit `HEAD` arg and
        // retry with branches/remotes only. The repo can have remote-tracking
        // branches (e.g. fresh clone before initial checkout) even when HEAD
        // points at an unborn local branch -- without this retry the whole
        // graph collapses to empty.
        if (includeRemotes) {
          try {
            const retryArgs = args.filter((a) => a !== "HEAD");
            const result = await runGit(resolved.resolved, retryArgs);
            stdout = result.stdout;
          } catch {
            // Truly empty repo (no branches, no remotes) -- fall through.
          }
        }
        // fall through with empty stdout
      } else {
        throw err;
      }
    }

    const allCommits = parseGitLog(stdout);
    // Slice the requested page after parsing the full window -- the parser
    // produced correct lane state for every commit, including the one at
    // index `skip` whose inputSwimlanes now reflects everything that came
    // before it.
    const commits = allCommits.slice(skip, skip + limit);

    // Cheap dirty probe -- we don't need fileStatuses here, just a yes/no.
    // Skip on paginated requests (subsequent pages don't repaint working tree).
    let hasUncommitted = false;
    if (skip === 0) {
      try {
        const { stdout: porcelain } = await runGit(resolved.resolved, [
          "status",
          "--porcelain",
        ]);
        hasUncommitted = porcelain.trim().length > 0;
      } catch {
        // Status failure leaves hasUncommitted=false; the graph still renders.
      }
    }

    const body: GitLogResponse = { commits, hasUncommitted };
    return c.json(body);
  });

  routes.post("/:id/git/init", async (c) => {
    const projectId = c.req.param("id");
    const project = projectManager.get(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Refuse if a repo already exists at the project root. We treat this as
    // an explicit user error (409) rather than silent success -- running
    // `git init` on an existing repo is a no-op but the UI flow assumes
    // empty-state.
    try {
      await runGit(project.path, ["rev-parse", "--is-inside-work-tree"]);
      return c.json({ error: "Project is already a git repository" }, 409);
    } catch (err) {
      if (!(err instanceof GitExecError)) throw err;
      const stderr = (err.stderr || "").toLowerCase();
      if (!stderr.includes("not a git repository")) {
        const mapped = mapGitError(err);
        if (mapped) return c.json({ error: mapped.error }, mapped.status);
        throw err;
      }
      // not-a-repo -> fall through to init.
    }

    try {
      await runGit(project.path, ["init"]);
    } catch (err) {
      const mapped = mapGitError(err);
      if (mapped) return c.json({ error: mapped.error }, mapped.status);
      throw err;
    }

    await projectRuntime.refreshGitState(projectId, project.path);
    return c.json({ ok: true });
  });

  routes.post("/:id/git/fetch", async (c) => {
    const projectId = c.req.param("id");
    const body = await c.req
      .json<MutationBody>()
      .catch(() => ({}) as MutationBody);
    const resolved = await resolveWorktreeOrError(
      fenceWorktreePath,
      projectId,
      body.worktreePath,
    );
    if (!resolved.ok) return c.json(resolved.body, resolved.status);

    try {
      await runGit(resolved.resolved, ["fetch", "--prune"], {
        timeoutMs: 60_000,
      });
    } catch (err) {
      const mapped = mapGitError(err);
      if (mapped) return c.json({ error: mapped.error }, mapped.status);
      throw err;
    }

    await projectRuntime.refreshGitState(projectId, resolved.resolved);
    return c.json({ ok: true });
  });

  return routes;
}

type RawCommit = {
  sha: string;
  parents: string[];
  author: string;
  time: number;
  subject: string;
  refs: GitRef[];
};

const BRANCH_COLOR_COUNT = 5;

/**
 * Parse `%D` decoration emitted with `--decorate=full`. The full form prefixes
 * each ref with its origin namespace:
 *   - `refs/heads/<name>` -- local branch
 *   - `refs/remotes/<remote>/<name>` -- remote tracking branch
 *   - `refs/tags/<name>` -- tag
 *   - `tag: refs/tags/<name>` -- tag (annotated, with explicit `tag:` prefix)
 *   - `HEAD` / `HEAD -> refs/heads/<name>` -- current head
 * Without `--decorate=full` the prefixes are stripped, which makes
 * `feat/foo` (local with slash) ambiguous against `origin/foo` (remote).
 */
function parseRefs(refsRaw: string): GitRef[] {
  if (!refsRaw) return [];
  // Git's decorate format separates entries with literal ", " (comma+space).
  // Refnames may contain commas but never spaces, so the two-character
  // separator is unambiguous -- splitting on bare "," would let a refname like
  // `foo,HEAD` slice into a fake HEAD chip.
  const tokens = refsRaw
    .split(", ")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((r) => {
      const arrow = r.split(" -> ");
      return arrow.length > 1 ? arrow.map((s) => s.trim()) : [r];
    });
  const out: GitRef[] = [];
  for (const tok of tokens) {
    if (tok === "HEAD") {
      out.push({ label: "HEAD", type: "head" });
      continue;
    }
    const tagPrefix = tok.startsWith("tag: ") ? tok.slice(5) : tok;
    if (tagPrefix.startsWith("refs/tags/")) {
      out.push({ label: tagPrefix.slice("refs/tags/".length), type: "tag" });
      continue;
    }
    if (tok.startsWith("refs/heads/")) {
      out.push({ label: tok.slice("refs/heads/".length), type: "local" });
      continue;
    }
    if (tok.startsWith("refs/remotes/")) {
      out.push({ label: tok.slice("refs/remotes/".length), type: "remote" });
      continue;
    }
    // Fallback for callers that did not use `--decorate=full` (unit tests
    // mostly): heuristic where a slash implies remote, otherwise local.
    if (tok.startsWith("tag: ")) {
      out.push({ label: tok.slice("tag: ".length), type: "tag" });
      continue;
    }
    if (tok.includes("/")) {
      out.push({ label: tok, type: "remote" });
      continue;
    }
    out.push({ label: tok, type: "local" });
  }
  return out;
}

/**
 * Parse `git log --format=%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e` output and
 * compute lane assignment + branch coloring for the renderer.
 *
 * Algorithm (newest -> oldest, per-row swimlane snapshots):
 *   - `current[]` holds the live swimlane state. Each slot is either `null`
 *     (free) or `{ colorId, expectingSha }` -- the commit that lane is waiting
 *     to link down to.
 *   - For each commit, find the lane whose `expectingSha === commit.sha`.
 *     - Match: the commit sits in that lane and inherits its colorId.
 *     - No match: a new branch tip -- allocate the lowest free slot, mint a
 *       fresh colorId by rotating through 0..4.
 *   - First parent reuses this lane (trunk continues). Each additional parent
 *     opens a new lane with a fresh colorId, unless an existing lane already
 *     waits for that parent (merge target reuse).
 *   - After the row is emitted, the swimlane array is compacted (trailing
 *     nulls dropped, middle nulls left-shifted) so a side branch ending
 *     mid-page frees its column for the next side branch -- keeps the visible
 *     lane count low against the cap=5 cap the renderer enforces.
 *
 * `inputSwimlanes` is the state above the row, `outputSwimlanes` below;
 * the renderer draws connectors between adjacent rows by reading the parent
 * row's output and the child row's input (which are the same array on either
 * side of the boundary).
 */
export function parseGitLog(raw: string): GitCommit[] {
  const records = raw.split("\x1e");
  const commits: RawCommit[] = [];
  for (const r of records) {
    const trimmed = r.replace(/^\n/, "");
    if (!trimmed) continue;
    const fields = trimmed.split("\x00");
    if (fields.length < 6) continue;
    const [sha, parentsRaw, author, atRaw, refsRaw, subject] = fields;
    if (!sha) continue;
    const parents = parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [];
    const time = parseInt(atRaw, 10) || 0;
    commits.push({
      sha,
      parents,
      author,
      time,
      subject,
      refs: parseRefs(refsRaw),
    });
  }

  // Pre-compute the set of shas in this window so a lane whose `expectingSha`
  // is unreachable (out-of-window or genuinely missing) terminates immediately
  // instead of dangling forever and pushing later branch tips into ever-higher
  // lane columns. Without this, a remote-only branch tip whose parent is not
  // in the page consumes a permanent column even though it will never have a
  // child commit drawn below it.
  const inWindow = new Set(commits.map((c) => c.sha));
  const reachableOrNull = (sha: string | undefined | null): string | null =>
    sha && inWindow.has(sha) ? sha : null;

  let current: Array<SwimlaneSnapshot | null> = [];
  let nextColor = 0;
  const allocColor = () => {
    const id = nextColor;
    nextColor = (nextColor + 1) % BRANCH_COLOR_COUNT;
    return id;
  };

  const out: GitCommit[] = [];
  for (const c of commits) {
    const inputSwimlanes: Array<SwimlaneSnapshot | null> = current.map((s) =>
      s ? { ...s } : null,
    );

    // Find every lane waiting for this sha. The leftmost becomes the
    // commit's lane and continues with its first parent; the others are
    // merge-sink lanes that terminate here (drawn as merge curves into the
    // primary lane).
    const matchedLanes: number[] = [];
    inputSwimlanes.forEach((s, idx) => {
      if (s?.expectingSha === c.sha) matchedLanes.push(idx);
    });
    let lane: number;
    let colorId: number;
    const next: Array<SwimlaneSnapshot | null> = inputSwimlanes.map((s) =>
      s ? { ...s } : null,
    );
    const firstParentExpect = reachableOrNull(c.parents[0]);
    if (matchedLanes.length === 0) {
      colorId = allocColor();
      const allocSnapshot: SwimlaneSnapshot = {
        colorId,
        expectingSha: firstParentExpect,
      };
      const free = next.indexOf(null);
      if (free !== -1) {
        next[free] = allocSnapshot;
        lane = free;
      } else {
        next.push(allocSnapshot);
        lane = next.length - 1;
      }
    } else {
      lane = matchedLanes[0];
      colorId = next[lane]?.colorId ?? allocColor();
      next[lane] = { colorId, expectingSha: firstParentExpect };
      // Merge-sink lanes terminate at this row.
      for (let i = 1; i < matchedLanes.length; i++) {
        next[matchedLanes[i]] = null;
      }
    }

    // Additional parents: each opens a new lane unless an existing one
    // already waits for that parent sha. Out-of-window parents are skipped
    // entirely -- drawing a curve that vanishes at the next row is more
    // confusing than just terminating at the merge dot.
    for (let i = 1; i < c.parents.length; i++) {
      const p = reachableOrNull(c.parents[i]);
      if (p === null) continue;
      if (next.some((s) => s?.expectingSha === p)) continue;
      const free = next.indexOf(null);
      const snapshot: SwimlaneSnapshot = {
        colorId: allocColor(),
        expectingSha: p,
      };
      if (free !== -1) next[free] = snapshot;
      else next.push(snapshot);
    }

    // Free any slot whose expectingSha resolved to null (root, out-of-window,
    // or merge sink that left a placeholder). This must run over every slot,
    // not just `lane`, because additional-parent allocation could leave such
    // entries elsewhere.
    for (let i = 0; i < next.length; i++) {
      if (next[i]?.expectingSha === null) next[i] = null;
    }

    // Compact: drop trailing nulls, left-shift middle nulls.
    const compacted = next.filter((s): s is SwimlaneSnapshot => s !== null);
    while (next.length > 0) next.pop();
    for (const s of compacted) next.push(s);

    out.push({
      ...c,
      lane,
      colorId,
      inputSwimlanes,
      outputSwimlanes: next.map((s) => (s ? { ...s } : null)),
    });
    current = next;
  }

  return out;
}

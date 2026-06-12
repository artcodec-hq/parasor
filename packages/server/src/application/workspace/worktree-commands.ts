import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  Worktree,
  WorktreeCreationSource,
  WorktreeLineageMetadata,
  WorktreeLocalFileCopyResult,
} from "@parasor/shared";
import { parseGitStatusV2 } from "../../fs/git-watcher.js";
import {
  resolveWorktreePath,
  WorktreeNotRegisteredError,
} from "../../lib/git-exec.js";
import type { ProjectManager } from "../../state/project-manager.js";
import type { EventPublisher } from "../ports.js";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
} from "./errors.js";
import { copyWorktreeLocalFiles } from "./worktree-local-files.js";

const execFileAsync = promisify(execFile);

export interface CreateWorktreeInput {
  branch: string;
  base?: string;
  copyLocalFiles?: unknown;
  lineage?: CreateWorktreeLineageInput;
}

export interface CreateWorktreeLineageInput {
  creationSource?: WorktreeCreationSource;
  parentWorktreePath?: string;
  createdWithAgent?: string;
  createdBySessionId?: string;
  createdByPaneCommandId?: string;
  createdByPaneCommandLabel?: string;
}

export interface CreateWorktreeResult {
  path: string;
  head: string;
  branch: string;
  lineage?: WorktreeLineageMetadata;
  localFileCopies?: WorktreeLocalFileCopyResult[];
}

interface CreateWorktreeCommandsDeps {
  projectManager: ProjectManager;
  eventBus: EventPublisher;
  /**
   * Returns the registered worktrees for a project. Used to fence client-supplied
   * `worktreePath` against arbitrary local paths before running git. The empty
   * array is a valid result for projects that have not yet been hydrated.
   */
  getProjectWorktrees: (projectId: string) => Worktree[];
  runGit?: (
    projectPath: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>;
  pathExists?: (target: string) => Promise<boolean>;
  /**
   * Probe whether `projectPath` lives inside a git work tree. Defaults to
   * `git rev-parse --is-inside-work-tree`; tests inject a stub so they can
   * keep using the simple non-arg-aware `runGit` mock.
   */
  isInsideGitRepo?: (projectPath: string) => Promise<boolean>;
  /**
   * Override the realpath-based fence helper. Provided for tests that operate
   * on synthetic paths; production code uses {@link resolveWorktreePath}.
   */
  resolveWorktree?: (
    projectPath: string,
    worktreePath: string,
    registered: Worktree[],
  ) => Promise<string>;
  copyLocalFiles?: (
    projectPath: string,
    worktreePath: string,
    selectedPaths: unknown,
  ) => Promise<WorktreeLocalFileCopyResult[]>;
  getWorktreeMetadata?: (
    projectId: string,
    worktreePath: string,
  ) => WorktreeLineageMetadata | undefined;
  setWorktreeMetadata?: (
    projectId: string,
    worktreePath: string,
    metadata: WorktreeLineageMetadata,
  ) => void;
  removeWorktreeMetadata?: (projectId: string, worktreePath: string) => void;
  createInstanceId?: () => string;
  now?: () => number;
}

async function defaultRunGit(projectPath: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync(
    "git",
    ["-C", projectPath, ...args],
    { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return { stdout, stderr };
}

/**
 * Hard ceiling on counter enrichment for a freshly created worktree. Set
 * tighter than the underlying `runGit` 15s timeout so a locked / pathological
 * repo cannot delay the `worktree-created` broadcast or the HTTP response.
 */
const ENRICH_DEADLINE_MS = 3000;

async function raceWithDeadline<T>(
  task: Promise<T>,
  deadlineMs: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), deadlineMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function defaultPathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: git branch validation must reject C0/DEL control bytes.
const BRANCH_INVALID_CHARS = /[\s\x00-\x1f\x7f~^:?*[\\@]/;

/**
 * Best-effort branch name validation matching common `git check-ref-format`
 * rules. Server still relies on git itself to surface the final error;
 * this only filters obvious shell hazards.
 */
export function validateBranchName(branch: string): string | null {
  if (!branch || branch.length > 200) return "Branch name is required";
  if (BRANCH_INVALID_CHARS.test(branch)) {
    return "Branch name contains invalid characters";
  }
  if (branch.includes("..") || branch.includes("@{")) {
    return "Branch name contains invalid sequence";
  }
  if (
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.startsWith(".") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock")
  ) {
    return "Branch name starts or ends with a reserved character";
  }
  for (const segment of branch.split("/")) {
    if (segment.length === 0) return "Branch name has empty path segment";
    if (segment.startsWith(".") || segment.endsWith(".lock")) {
      return "Branch name has invalid path segment";
    }
  }
  return null;
}

/**
 * Default worktree placement: sibling directory `{projectPath}.worktrees/{branch}`.
 * Matches the convention used by GitLens, editor worktree extensions, and
 * JetBrains IDEs.
 */
export function defaultWorktreePath(
  projectPath: string,
  branch: string,
): string {
  const trimmed = projectPath.replace(/\/+$/, "");
  return path.join(`${trimmed}.worktrees`, branch);
}

export interface FenceWorktreePathDeps {
  projectManager: ProjectManager;
  /** Registered worktrees for a project -- see CreateWorktreeCommandsDeps. */
  getProjectWorktrees: (projectId: string) => Worktree[];
  /** Realpath-based fence; defaults to {@link resolveWorktreePath}. */
  resolveWorktree?: (
    projectPath: string,
    worktreePath: string,
    registered: Worktree[],
  ) => Promise<string>;
}

/**
 * Fence a client-supplied path against the project's registered worktrees
 * (project root + each `git worktree list` entry). Returns the realpath-
 * resolved canonical path that callers MUST pass to git, so symlink and
 * case-insensitive filesystem aliases reach the same on-disk repo.
 *
 * Single source for both the worktree-command closure and the route helpers.
 * Throws `WorkspaceNotFoundError`:
 *   - `kind === "project"` (default) when the project id is unknown
 *   - `kind === "worktree"` when the path is not a registered worktree
 */
export async function fenceWorktreePathWith(
  deps: FenceWorktreePathDeps,
  projectId: string,
  worktreePath: string,
): Promise<{ projectPath: string; resolved: string }> {
  const { projectManager, getProjectWorktrees } = deps;
  const resolveWorktree = deps.resolveWorktree ?? resolveWorktreePath;
  const project = projectManager.get(projectId);
  if (!project) throw new WorkspaceNotFoundError();
  try {
    const resolved = await resolveWorktree(
      project.path,
      worktreePath,
      getProjectWorktrees(projectId),
    );
    return { projectPath: project.path, resolved };
  } catch (err) {
    if (err instanceof WorktreeNotRegisteredError) {
      // Tag as "worktree" so the route layer preserves the original
      // WorktreeNotRegisteredError message distinctly from the
      // project-missing "Project not found" body.
      throw new WorkspaceNotFoundError(err.message, "worktree");
    }
    throw err;
  }
}

export function createWorktreeCommands({
  projectManager,
  eventBus,
  getProjectWorktrees,
  runGit = defaultRunGit,
  pathExists = defaultPathExists,
  isInsideGitRepo = (projectPath) =>
    defaultIsInsideGitRepo(projectPath, runGit),
  resolveWorktree = resolveWorktreePath,
  copyLocalFiles = copyWorktreeLocalFiles,
  getWorktreeMetadata = () => undefined,
  setWorktreeMetadata = () => undefined,
  removeWorktreeMetadata = () => undefined,
  createInstanceId = randomUUID,
  now = Date.now,
}: CreateWorktreeCommandsDeps) {
  const fenceWorktreePath = (projectId: string, worktreePath: string) =>
    fenceWorktreePathWith(
      { projectManager, getProjectWorktrees, resolveWorktree },
      projectId,
      worktreePath,
    );

  return {
    fenceWorktreePath,
    async createProjectWorktree(
      projectId: string,
      input: CreateWorktreeInput,
    ): Promise<CreateWorktreeResult> {
      const project = projectManager.get(projectId);
      if (!project) throw new WorkspaceNotFoundError();

      const branch = input.branch.trim();
      const validation = validateBranchName(branch);
      if (validation) throw new WorkspaceValidationError(validation);

      const base = input.base?.trim();
      if (base) {
        const baseValidation = validateBranchName(base);
        if (baseValidation) {
          throw new WorkspaceValidationError(`base: ${baseValidation}`);
        }
      }

      if (!(await isInsideGitRepo(project.path))) {
        throw new WorkspaceValidationError("Not a git repository");
      }

      const worktreePath = defaultWorktreePath(project.path, branch);
      if (await pathExists(worktreePath)) {
        throw new WorkspaceConflictError(
          `Path already exists: ${worktreePath}`,
        );
      }

      const branchExists = await branchRefExists(project.path, branch, runGit);

      const args = branchExists
        ? ["worktree", "add", worktreePath, branch]
        : [
            "worktree",
            "add",
            "-b",
            branch,
            worktreePath,
            base && base.length > 0 ? base : "HEAD",
          ];

      try {
        await runGit(project.path, args);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "git worktree add failed";
        throw new WorkspaceConflictError(message);
      }

      let head = "";
      try {
        const { stdout } = await runGit(project.path, [
          "rev-parse",
          `refs/heads/${branch}`,
        ]);
        head = stdout.trim();
      } catch {
        /* ignore -- head stays empty if rev-parse cannot resolve */
      }

      const result: CreateWorktreeResult = {
        path: worktreePath,
        head,
        branch,
      };
      const knownParentPaths = new Set([
        project.path,
        ...getProjectWorktrees(projectId).map((worktree) => worktree.path),
      ]);
      const parentWorktreePath = input.lineage?.parentWorktreePath;
      const lineage = buildWorktreeLineage({
        input: input.lineage,
        parentMetadata:
          parentWorktreePath !== undefined &&
          knownParentPaths.has(parentWorktreePath)
            ? getWorktreeMetadata(projectId, parentWorktreePath)
            : undefined,
        knownParentPaths,
        createInstanceId,
        now,
      });
      if (lineage) {
        result.lineage = lineage;
        setWorktreeMetadata(projectId, worktreePath, lineage);
      }

      const localFileCopies = await copyLocalFiles(
        project.path,
        worktreePath,
        input.copyLocalFiles,
      );
      if (localFileCopies.length > 0) {
        result.localFileCopies = localFileCopies;
      }

      // Best-effort counter enrichment for the freshly created worktree.
      // Bounded by ENRICH_DEADLINE_MS so a slow / locked repo cannot stall the
      // HTTP response and the sidebar broadcast. On timeout we broadcast
      // without counters; the sidebar will fill in zeros and the next
      // git-state poll covers this path.
      const counters = await raceWithDeadline(
        (async () => {
          try {
            const { stdout } = await runGit(worktreePath, [
              "status",
              "--porcelain=v2",
              "-b",
            ]);
            return parseGitStatusV2(stdout);
          } catch {
            return undefined;
          }
        })(),
        ENRICH_DEADLINE_MS,
      );

      eventBus.broadcast({
        type: "worktree-created",
        projectId,
        worktree: { ...result, ...(counters ?? {}) },
      });

      return result;
    },

    /**
     * Rename the worktree's branch via `git branch -m old new`. The on-disk
     * worktree directory keeps its original path -- `git worktree move` is
     * intentionally out of scope here so the operation stays a single,
     * cheap ref rename. Sidebar / topbar consumers display `branch`, so the
     * UX still updates cleanly even though `path` lags the convention.
     */
    async renameProjectWorktree(
      projectId: string,
      worktreePath: string,
      newBranch: string,
    ): Promise<{ oldBranch: string; newBranch: string }> {
      const trimmedNew = newBranch.trim();
      const validation = validateBranchName(trimmedNew);
      if (validation) throw new WorkspaceValidationError(validation);

      const { resolved } = await fenceWorktreePath(projectId, worktreePath);

      let oldBranch = "";
      try {
        const { stdout } = await runGit(resolved, [
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        ]);
        oldBranch = stdout.trim();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "rev-parse HEAD failed";
        throw new WorkspaceConflictError(message);
      }
      if (!oldBranch || oldBranch === "HEAD") {
        throw new WorkspaceConflictError(
          "Cannot rename a detached HEAD worktree",
        );
      }
      if (oldBranch === trimmedNew) {
        return { oldBranch, newBranch: trimmedNew };
      }

      try {
        await runGit(resolved, ["branch", "-m", oldBranch, trimmedNew]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "git branch -m failed";
        throw new WorkspaceConflictError(message);
      }

      eventBus.broadcast({
        type: "worktree-renamed",
        projectId,
        worktreePath: resolved,
        oldBranch,
        newBranch: trimmedNew,
      });

      return { oldBranch, newBranch: trimmedNew };
    },

    async removeProjectWorktree(
      projectId: string,
      worktreePath: string,
      opts: { force?: boolean } = {},
    ): Promise<void> {
      const project = projectManager.get(projectId);
      if (!project) throw new WorkspaceNotFoundError();

      // Orphan path: on-disk dir gone -> `git worktree remove` and the realpath fence both throw ENOENT, so prune by exact-string match instead.
      const registered = getProjectWorktrees(projectId);
      const cachedHit = registered.find((w) => w.path === worktreePath);
      if (cachedHit && !(await pathExists(worktreePath))) {
        try {
          await runGit(project.path, ["worktree", "prune"]);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "git worktree prune failed";
          throw new WorkspaceConflictError(message);
        }
        removeWorktreeMetadata(projectId, cachedHit.path);
        eventBus.broadcast({
          type: "worktree-removed",
          projectId,
          worktreePath: cachedHit.path,
        });
        return;
      }

      const { projectPath, resolved } = await fenceWorktreePath(
        projectId,
        worktreePath,
      );

      // `--` separator before the path keeps git from interpreting an unusual
      // realpath (e.g. starting with `-`) as an option, even though the fence
      // already restricts it to a registered worktree.
      const args = ["worktree", "remove"];
      if (opts.force === true) args.push("--force");
      args.push("--", resolved);

      try {
        await runGit(projectPath, args);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "git worktree remove failed";
        throw new WorkspaceConflictError(message);
      }

      removeWorktreeMetadata(projectId, resolved);
      eventBus.broadcast({
        type: "worktree-removed",
        projectId,
        worktreePath: resolved,
      });
    },
  };
}

function buildWorktreeLineage({
  input,
  parentMetadata,
  knownParentPaths,
  createInstanceId,
  now,
}: {
  input: CreateWorktreeLineageInput | undefined;
  parentMetadata: WorktreeLineageMetadata | undefined;
  knownParentPaths: Set<string>;
  createInstanceId: () => string;
  now: () => number;
}): WorktreeLineageMetadata | undefined {
  if (!input) return undefined;
  const metadata: WorktreeLineageMetadata = {
    instanceId: createInstanceId(),
    creationSource: input.creationSource ?? "unknown",
    createdAt: now(),
    lineageCapture: {
      source: "create-worktree-request",
      confidence: "explicit",
    },
  };
  if (input.createdWithAgent) {
    metadata.createdWithAgent = input.createdWithAgent;
  }
  if (input.createdBySessionId) {
    metadata.createdBySessionId = input.createdBySessionId;
  }
  if (input.createdByPaneCommandId) {
    metadata.createdByPaneCommandId = input.createdByPaneCommandId;
  }
  if (input.createdByPaneCommandLabel) {
    metadata.createdByPaneCommandLabel = input.createdByPaneCommandLabel;
  }
  if (
    input.parentWorktreePath &&
    knownParentPaths.has(input.parentWorktreePath)
  ) {
    metadata.parentWorktreePath = input.parentWorktreePath;
  }
  if (parentMetadata) {
    metadata.parentWorktreeInstanceId = parentMetadata.instanceId;
  }
  return metadata;
}

async function branchRefExists(
  projectPath: string,
  branch: string,
  runGit: (
    projectPath: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<boolean> {
  try {
    await runGit(projectPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function defaultIsInsideGitRepo(
  projectPath: string,
  runGit: (
    projectPath: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<boolean> {
  try {
    const { stdout } = await runGit(projectPath, [
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

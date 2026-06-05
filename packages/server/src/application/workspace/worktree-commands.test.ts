import { describe, expect, it, vi } from "vitest";
import { WorktreeNotRegisteredError } from "../../lib/git-exec.js";
import type { ProjectManager } from "../../state/project-manager.js";
import type { EventBus } from "../../ws/events.js";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
} from "./errors.js";
import {
  createWorktreeCommands,
  defaultWorktreePath,
  validateBranchName,
} from "./worktree-commands.js";

function makeDeps(
  overrides: {
    project?: { id: string; path: string } | null;
    pathExists?: boolean;
    runGit?: ReturnType<typeof vi.fn>;
    registered?: Array<{ path: string; head: string; branch: string }>;
    resolveWorktree?: ReturnType<typeof vi.fn>;
    isInsideGitRepo?: ReturnType<typeof vi.fn>;
    copyLocalFiles?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const project =
    overrides.project === null
      ? null
      : (overrides.project ?? { id: "p1", path: "/repos/proj" });
  const pm = {
    get: vi.fn(() => project ?? undefined),
  } as unknown as ProjectManager;
  const eventBus = { broadcast: vi.fn() } as unknown as EventBus;
  const runGit =
    overrides.runGit ??
    vi.fn(async () => ({ stdout: "abcdef0\n", stderr: "" }));
  const pathExists = vi.fn(async () => overrides.pathExists ?? false);
  const getProjectWorktrees = vi.fn(() => overrides.registered ?? []);
  // Default fence stub: pass-through (return the input path) so tests that do
  // not exercise fence behavior keep their existing fixtures. Tests asserting
  // fence rejection inject their own stub.
  const resolveWorktree =
    overrides.resolveWorktree ?? vi.fn(async (_proj, p, _reg) => p);
  // Default isRepo stub: project root is a valid git work tree. The non-git
  // gate test injects a stub returning false.
  const isInsideGitRepo = overrides.isInsideGitRepo ?? vi.fn(async () => true);
  const copyLocalFiles = overrides.copyLocalFiles ?? vi.fn(async () => []);
  return {
    pm,
    eventBus,
    runGit,
    pathExists,
    getProjectWorktrees,
    resolveWorktree,
    isInsideGitRepo,
    copyLocalFiles,
  };
}

describe("validateBranchName", () => {
  it("accepts simple names", () => {
    expect(validateBranchName("feature/foo")).toBeNull();
    expect(validateBranchName("main")).toBeNull();
    expect(validateBranchName("a-b_c")).toBeNull();
  });

  it("rejects empty", () => {
    expect(validateBranchName("")).not.toBeNull();
  });

  it("rejects control / shell hazards", () => {
    expect(validateBranchName("foo bar")).not.toBeNull();
    expect(validateBranchName("foo\x00bar")).not.toBeNull();
    expect(validateBranchName("foo*bar")).not.toBeNull();
    expect(validateBranchName("foo:bar")).not.toBeNull();
  });

  it("rejects forbidden sequences", () => {
    expect(validateBranchName("foo..bar")).not.toBeNull();
    expect(validateBranchName("foo@{baz}")).not.toBeNull();
  });

  it("rejects bad anchors", () => {
    expect(validateBranchName("-foo")).not.toBeNull();
    expect(validateBranchName("/foo")).not.toBeNull();
    expect(validateBranchName(".foo")).not.toBeNull();
    expect(validateBranchName("foo/")).not.toBeNull();
    expect(validateBranchName("foo.lock")).not.toBeNull();
  });

  it("rejects empty path segment", () => {
    expect(validateBranchName("foo//bar")).not.toBeNull();
  });
});

describe("defaultWorktreePath", () => {
  it("places sibling .worktrees/{branch}", () => {
    expect(defaultWorktreePath("/repos/proj", "feature/foo")).toBe(
      "/repos/proj.worktrees/feature/foo",
    );
  });
  it("strips trailing slashes from project path", () => {
    expect(defaultWorktreePath("/repos/proj/", "main")).toBe(
      "/repos/proj.worktrees/main",
    );
  });
});

describe("createProjectWorktree", () => {
  it("throws NotFound when project missing", async () => {
    const deps = makeDeps({ project: null });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.createProjectWorktree("missing", { branch: "main" }),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("throws ValidationError on bad branch name", async () => {
    const deps = makeDeps();
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.createProjectWorktree("p1", { branch: "" }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
    await expect(
      cmds.createProjectWorktree("p1", { branch: "foo bar" }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it("throws ConflictError when path already exists", async () => {
    const deps = makeDeps({ pathExists: true });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.createProjectWorktree("p1", { branch: "feature/foo" }),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it("throws ValidationError when project root is not a git repo", async () => {
    const isInsideGitRepo = vi.fn(async () => false);
    const deps = makeDeps({ isInsideGitRepo });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.createProjectWorktree("p1", { branch: "feature/foo" }),
    ).rejects.toThrowError(/not a git repository/i);
    expect(deps.runGit).not.toHaveBeenCalled();
    expect(deps.pathExists).not.toHaveBeenCalled();
    expect(deps.eventBus.broadcast).not.toHaveBeenCalled();
  });

  it("checks out existing branch when ref already exists", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      calls.push({ args });
      // show-ref --verify exits 0 = branch exists
      if (args[0] === "show-ref") return { stdout: "", stderr: "" };
      if (args[0] === "rev-parse") return { stdout: "deadbeef\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    const result = await cmds.createProjectWorktree("p1", {
      branch: "main",
    });

    const addCall = calls.find((c) => c.args[0] === "worktree");
    expect(addCall?.args).toEqual([
      "worktree",
      "add",
      "/repos/proj.worktrees/main",
      "main",
    ]);
    expect(result).toEqual({
      path: "/repos/proj.worktrees/main",
      head: "deadbeef",
      branch: "main",
    });
    expect(deps.eventBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "worktree-created", projectId: "p1" }),
    );
  });

  it("creates new branch from base when ref does not exist", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      calls.push({ args });
      if (args[0] === "show-ref") {
        // show-ref --verify exits non-zero = branch missing
        throw new Error("not found");
      }
      if (args[0] === "rev-parse") return { stdout: "deadbeef\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    await cmds.createProjectWorktree("p1", {
      branch: "feature/new",
      base: "main",
    });

    const addCall = calls.find((c) => c.args[0] === "worktree");
    expect(addCall?.args).toEqual([
      "worktree",
      "add",
      "-b",
      "feature/new",
      "/repos/proj.worktrees/feature/new",
      "main",
    ]);
  });

  it("falls back to HEAD when no base provided and branch is new", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      calls.push({ args });
      if (args[0] === "show-ref") throw new Error("missing");
      return { stdout: "deadbeef\n", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    await cmds.createProjectWorktree("p1", { branch: "x" });

    const addCall = calls.find((c) => c.args[0] === "worktree");
    expect(addCall?.args[addCall.args.length - 1]).toBe("HEAD");
  });

  it("returns local file copy results when selected files are requested", async () => {
    const copyLocalFiles = vi.fn(async () => [
      { path: ".env", size: 9, status: "copied" as const },
    ]);
    const deps = makeDeps({ copyLocalFiles });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
      copyLocalFiles: deps.copyLocalFiles,
    });

    const result = await cmds.createProjectWorktree("p1", {
      branch: "feature/env",
      copyLocalFiles: [".env"],
    });

    expect(copyLocalFiles).toHaveBeenCalledWith(
      "/repos/proj",
      "/repos/proj.worktrees/feature/env",
      [".env"],
    );
    expect(result.localFileCopies).toEqual([
      { path: ".env", size: 9, status: "copied" },
    ]);
  });

  it("translates git failure into ConflictError", async () => {
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      if (args[0] === "show-ref") throw new Error("missing");
      if (args[0] === "worktree") throw new Error("fatal: cannot lock");
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    await expect(
      cmds.createProjectWorktree("p1", { branch: "x" }),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it("attaches counters to the broadcast when status returns quickly", async () => {
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      if (args[0] === "show-ref") throw new Error("missing");
      if (args[0] === "rev-parse") return { stdout: "deadbeef\n", stderr: "" };
      if (args[0] === "status") {
        return {
          stdout: ["# branch.ab +1 -2", "1 .M N... 1 1 1 a b f.ts", ""].join(
            "\n",
          ),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    await cmds.createProjectWorktree("p1", { branch: "x" });
    expect(deps.eventBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worktree-created",
        worktree: expect.objectContaining({
          ahead: 1,
          behind: 2,
          dirtyCount: 1,
        }),
      }),
    );
  });

  it("broadcasts without counters when enrich exceeds the deadline", async () => {
    vi.useFakeTimers();
    try {
      let resolveStatus: (() => void) | undefined;
      const runGit = vi.fn(async (_path: string, args: string[]) => {
        if (args[0] === "show-ref") throw new Error("missing");
        if (args[0] === "rev-parse")
          return { stdout: "deadbeef\n", stderr: "" };
        if (args[0] === "status") {
          // Hang until the deadline elapses, then resolve so the orphan
          // promise unwinds cleanly.
          await new Promise<void>((resolve) => {
            resolveStatus = resolve;
          });
          return { stdout: "", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      });
      const deps = makeDeps({ runGit });
      const cmds = createWorktreeCommands({
        projectManager: deps.pm,
        eventBus: deps.eventBus,
        runGit: deps.runGit,
        pathExists: deps.pathExists,
        getProjectWorktrees: deps.getProjectWorktrees,
        resolveWorktree: deps.resolveWorktree,
        isInsideGitRepo: deps.isInsideGitRepo,
      });

      const pending = cmds.createProjectWorktree("p1", { branch: "x" });
      // Drive past the 3s ENRICH_DEADLINE_MS.
      await vi.advanceTimersByTimeAsync(3001);
      await pending;

      const call = vi.mocked(deps.eventBus.broadcast).mock
        .calls[0]?.[0] as unknown as {
        type: string;
        worktree: Record<string, unknown>;
      };
      expect(call.type).toBe("worktree-created");
      expect(call.worktree).not.toHaveProperty("ahead");
      expect(call.worktree).not.toHaveProperty("behind");
      expect(call.worktree).not.toHaveProperty("dirtyCount");

      resolveStatus?.();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("renameProjectWorktree", () => {
  it("throws NotFound when project missing", async () => {
    const deps = makeDeps({ project: null });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.renameProjectWorktree("missing", "/tmp/wt", "feat/b"),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("throws ValidationError on bad new branch", async () => {
    const deps = makeDeps();
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.renameProjectWorktree("p1", "/tmp/wt", "bad name"),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it("rejects detached HEAD worktrees", async () => {
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      if (args[0] === "rev-parse") return { stdout: "HEAD\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.renameProjectWorktree("p1", "/tmp/wt", "feat/b"),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it("returns no-op result when new branch matches current", async () => {
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      if (args[0] === "rev-parse") return { stdout: "feat/a\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    const result = await cmds.renameProjectWorktree("p1", "/tmp/wt", "feat/a");
    expect(result).toEqual({ oldBranch: "feat/a", newBranch: "feat/a" });
    expect(deps.eventBus.broadcast).not.toHaveBeenCalled();
  });

  it("invokes git branch -m and broadcasts on success", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      calls.push({ args });
      if (args[0] === "rev-parse") return { stdout: "feat/a\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    const result = await cmds.renameProjectWorktree("p1", "/tmp/wt", "feat/b");
    expect(result).toEqual({ oldBranch: "feat/a", newBranch: "feat/b" });
    const branchCall = calls.find((c) => c.args[0] === "branch");
    expect(branchCall?.args).toEqual(["branch", "-m", "feat/a", "feat/b"]);
    expect(deps.eventBus.broadcast).toHaveBeenCalledWith({
      type: "worktree-renamed",
      projectId: "p1",
      worktreePath: "/tmp/wt",
      oldBranch: "feat/a",
      newBranch: "feat/b",
    });
  });

  it("translates git failure into ConflictError", async () => {
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      if (args[0] === "rev-parse") return { stdout: "feat/a\n", stderr: "" };
      if (args[0] === "branch") throw new Error("fatal: branch already exists");
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.renameProjectWorktree("p1", "/tmp/wt", "feat/b"),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it("trims whitespace before validating and dispatching", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      calls.push({ args });
      if (args[0] === "rev-parse") return { stdout: "feat/a\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await cmds.renameProjectWorktree("p1", "/tmp/wt", "  feat/b  ");
    const branchCall = calls.find((c) => c.args[0] === "branch");
    expect(branchCall?.args[3]).toBe("feat/b");
  });

  it("rejects unregistered worktree path with NotFound (fence)", async () => {
    const resolveWorktree = vi.fn(async (_proj, p, _reg) => {
      throw new WorktreeNotRegisteredError(p);
    });
    const runGit = vi.fn();
    const deps = makeDeps({ runGit, resolveWorktree });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.renameProjectWorktree("p1", "/etc/passwd", "feat/b"),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    expect(runGit).not.toHaveBeenCalled();
    expect(deps.eventBus.broadcast).not.toHaveBeenCalled();
  });

  it("passes resolved (realpath) path to git, not the input path", async () => {
    const resolveWorktree = vi.fn(async () => "/canonical/wt");
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      if (args[0] === "rev-parse") return { stdout: "feat/a\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit, resolveWorktree });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await cmds.renameProjectWorktree("p1", "/aliased/wt", "feat/b");
    for (const call of runGit.mock.calls) {
      expect(call[0]).toBe("/canonical/wt");
    }
    expect(deps.eventBus.broadcast).toHaveBeenCalledWith({
      type: "worktree-renamed",
      projectId: "p1",
      worktreePath: "/canonical/wt",
      oldBranch: "feat/a",
      newBranch: "feat/b",
    });
  });
});

describe("removeProjectWorktree", () => {
  it("throws NotFound when project missing", async () => {
    const deps = makeDeps({ project: null });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.removeProjectWorktree("missing", "/tmp/wt"),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("invokes git worktree remove without --force by default", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      calls.push({ args });
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await cmds.removeProjectWorktree("p1", "/tmp/wt");
    expect(calls[0]?.args).toEqual(["worktree", "remove", "--", "/tmp/wt"]);
    expect(deps.eventBus.broadcast).toHaveBeenCalledWith({
      type: "worktree-removed",
      projectId: "p1",
      worktreePath: "/tmp/wt",
    });
  });

  it("appends --force when explicitly requested", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      calls.push({ args });
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await cmds.removeProjectWorktree("p1", "/tmp/wt", { force: true });
    expect(calls[0]?.args).toEqual([
      "worktree",
      "remove",
      "--force",
      "--",
      "/tmp/wt",
    ]);
  });

  it("translates git failure into ConflictError", async () => {
    const runGit = vi.fn(async () => {
      throw new Error("fatal: worktree contains modified or untracked files");
    });
    const deps = makeDeps({ runGit });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.removeProjectWorktree("p1", "/tmp/wt"),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(deps.eventBus.broadcast).not.toHaveBeenCalled();
  });

  it("rejects unregistered worktree path with NotFound (fence)", async () => {
    const resolveWorktree = vi.fn(async (_proj, p, _reg) => {
      throw new WorktreeNotRegisteredError(p);
    });
    const runGit = vi.fn();
    const deps = makeDeps({ runGit, resolveWorktree });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await expect(
      cmds.removeProjectWorktree("p1", "/etc/passwd"),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    expect(runGit).not.toHaveBeenCalled();
    expect(deps.eventBus.broadcast).not.toHaveBeenCalled();
  });

  it("passes resolved (realpath) path to git, not the input path", async () => {
    const resolveWorktree = vi.fn(async () => "/canonical/wt");
    const calls: Array<{ projectPath: string; args: string[] }> = [];
    const runGit = vi.fn(async (projectPath: string, args: string[]) => {
      calls.push({ projectPath, args });
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({ runGit, resolveWorktree });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });
    await cmds.removeProjectWorktree("p1", "/aliased/wt", { force: true });
    expect(calls[0]?.args).toEqual([
      "worktree",
      "remove",
      "--force",
      "--",
      "/canonical/wt",
    ]);
    expect(deps.eventBus.broadcast).toHaveBeenCalledWith({
      type: "worktree-removed",
      projectId: "p1",
      worktreePath: "/canonical/wt",
    });
  });

  it("orphan path: runs git worktree prune and broadcasts when on-disk path is gone", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      calls.push({ args });
      return { stdout: "", stderr: "" };
    });
    const resolveWorktree = vi.fn(async () => {
      throw new Error("resolveWorktree should not be called for orphan path");
    });
    // pathExists=false (default) signals the on-disk dir is gone.
    const deps = makeDeps({
      runGit,
      resolveWorktree,
      registered: [{ path: "/tmp/wt", head: "abc", branch: "feat/a" }],
    });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    await cmds.removeProjectWorktree("p1", "/tmp/wt");

    expect(calls.map((c) => c.args)).toEqual([["worktree", "prune"]]);
    expect(resolveWorktree).not.toHaveBeenCalled();
    expect(deps.eventBus.broadcast).toHaveBeenCalledWith({
      type: "worktree-removed",
      projectId: "p1",
      worktreePath: "/tmp/wt",
    });
  });

  it("orphan path: surfaces ConflictError when git worktree prune fails", async () => {
    const runGit = vi.fn(async () => {
      throw new Error("fatal: prune failed");
    });
    const deps = makeDeps({
      runGit,
      registered: [{ path: "/tmp/wt", head: "abc", branch: "feat/a" }],
    });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    await expect(
      cmds.removeProjectWorktree("p1", "/tmp/wt"),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(deps.eventBus.broadcast).not.toHaveBeenCalled();
  });

  it("orphan branch is skipped when path exists on disk (normal remove path runs)", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      calls.push({ args });
      return { stdout: "", stderr: "" };
    });
    const deps = makeDeps({
      runGit,
      pathExists: true,
      registered: [{ path: "/tmp/wt", head: "abc", branch: "feat/a" }],
    });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    await cmds.removeProjectWorktree("p1", "/tmp/wt");

    // Normal remove path runs (no prune).
    expect(calls).toEqual([{ args: ["worktree", "remove", "--", "/tmp/wt"] }]);
  });

  it("orphan branch is skipped when path is not in cached registration (fence runs)", async () => {
    const resolveWorktree = vi.fn(async (_proj: string, p: string) => {
      throw new WorktreeNotRegisteredError(p);
    });
    const runGit = vi.fn();
    // No matching registered entry -> orphan branch falls through to fence.
    const deps = makeDeps({ runGit, resolveWorktree, registered: [] });
    const cmds = createWorktreeCommands({
      projectManager: deps.pm,
      eventBus: deps.eventBus,
      runGit: deps.runGit,
      pathExists: deps.pathExists,
      getProjectWorktrees: deps.getProjectWorktrees,
      resolveWorktree: deps.resolveWorktree,
      isInsideGitRepo: deps.isInsideGitRepo,
    });

    await expect(
      cmds.removeProjectWorktree("p1", "/tmp/wt"),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    expect(runGit).not.toHaveBeenCalled();
  });
});

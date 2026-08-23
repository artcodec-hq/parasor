import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectManager } from "../../state/project-manager.js";
import { WorkspaceNotFoundError } from "./errors.js";
import {
  createProjectQueries,
  defaultRunGit,
  isMissingPathError,
  parseWorktreeList,
} from "./project-queries.js";

// These tests create real git repositories and enumerate ignored local files.
// On loaded machines the git calls can exceed Vitest's default 5s timeout.
vi.setConfig({ testTimeout: 15_000 });

function makeProject(
  overrides: Partial<{ id: string; path: string; name: string }> = {},
) {
  return {
    id: overrides.id ?? "proj-1",
    path: overrides.path ?? "/tmp/proj",
    name: overrides.name ?? "proj",
    createdAt: 1,
    lastAccessedAt: 1,
  };
}

describe("isMissingPathError", () => {
  it("is true only for ENOENT codes", () => {
    expect(
      isMissingPathError(Object.assign(new Error("x"), { code: "ENOENT" })),
    ).toBe(true);
    expect(isMissingPathError(new Error("fatal: not a git repository"))).toBe(
      false,
    );
  });
});

describe("parseWorktreeList", () => {
  it("parses porcelain output", () => {
    const input = [
      "worktree /Users/user/project",
      "HEAD abc123def456",
      "branch refs/heads/main",
      "",
      "worktree /Users/user/project-feature",
      "HEAD 789abc012def",
      "branch refs/heads/feature",
      "",
    ].join("\n");

    expect(parseWorktreeList(input)).toEqual([
      { path: "/Users/user/project", head: "abc123def456", branch: "main" },
      {
        path: "/Users/user/project-feature",
        head: "789abc012def",
        branch: "feature",
      },
    ]);
  });

  it("tags agent-spawned worktrees with origin='agent'", () => {
    const home = homedir();
    const input = [
      `worktree ${home}/.parasor/worktrees/parasor/wiry-industry`,
      "HEAD aaa",
      "branch refs/heads/feat/x",
      "",
      `worktree ${home}/.claude/teams/parasor-team-1/issue-300`,
      "HEAD bbb",
      "branch refs/heads/feat/y",
      "",
      "worktree /private/tmp/parasor-issue-300",
      "HEAD ccc",
      "branch refs/heads/feat/z",
      "",
      "worktree /tmp/parasor-issue-42",
      "HEAD ddd",
      "branch refs/heads/feat/w",
      "",
      "worktree /Users/user/project",
      "HEAD eee",
      "branch refs/heads/main",
      "",
    ].join("\n");

    const out = parseWorktreeList(input);
    expect(out.map((w) => [w.path, w.origin])).toEqual([
      [`${home}/.parasor/worktrees/parasor/wiry-industry`, "agent"],
      [`${home}/.claude/teams/parasor-team-1/issue-300`, "agent"],
      ["/private/tmp/parasor-issue-300", "agent"],
      ["/tmp/parasor-issue-42", "agent"],
      ["/Users/user/project", undefined],
    ]);
  });

  it("marks prunable worktrees as orphaned", () => {
    const input = [
      "worktree /Users/user/project",
      "HEAD abc123def456",
      "branch refs/heads/main",
      "",
      "worktree /Users/user/project-gone",
      "HEAD 789abc012def",
      "branch refs/heads/gone",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");

    expect(parseWorktreeList(input)).toEqual([
      { path: "/Users/user/project", head: "abc123def456", branch: "main" },
      {
        path: "/Users/user/project-gone",
        head: "789abc012def",
        branch: "gone",
        orphan: true,
      },
    ]);
  });
});

describe("createProjectQueries", () => {
  let projects: Map<string, ReturnType<typeof makeProject>>;
  let projectManager: ProjectManager;

  beforeEach(() => {
    projects = new Map();
    projectManager = {
      get: vi.fn((id: string) => projects.get(id)),
      list: vi.fn(() => [...projects.values()]),
    } as unknown as ProjectManager;
  });

  it("returns diff output when git succeeds", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async () => "diff --git a/file b/file");
    const queries = createProjectQueries({
      projectManager,
      runGit,
    });

    await expect(
      queries.getProjectDiff("proj-1", "/tmp/proj/wt"),
    ).resolves.toBe("diff --git a/file b/file");
    expect(runGit).toHaveBeenCalledWith("/tmp/proj/wt", [
      "diff",
      "HEAD",
      "--no-color",
    ]);
  });

  it("getProjectCommitDiff runs against the resolved worktree", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async () => "commit-diff");
    const queries = createProjectQueries({
      projectManager,
      runGit,
    });

    await expect(
      queries.getProjectCommitDiff("proj-1", "deadbeef", "/tmp/proj/wt"),
    ).resolves.toBe("commit-diff");
    expect(runGit).toHaveBeenCalledWith("/tmp/proj/wt", [
      "show",
      "--no-color",
      "--format=",
      "deadbeef",
    ]);
  });

  it("returns worktrees enriched with counters when git succeeds", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async (_: string, args: string[]) => {
      if (args[0] === "worktree") {
        return [
          "worktree /tmp/proj",
          "HEAD abc",
          "branch refs/heads/main",
          "",
        ].join("\n");
      }
      if (args[0] === "status") {
        return ["# branch.ab +2 -1", "1 .M N... 1 1 1 a b src/a.ts", ""].join(
          "\n",
        );
      }
      return "";
    });
    const queries = createProjectQueries({
      projectManager,
      runGit,
    });

    await expect(queries.getProjectWorktrees("proj-1")).resolves.toEqual({
      status: "ok",
      worktrees: [
        {
          path: "/tmp/proj",
          head: "abc",
          branch: "main",
          ahead: 2,
          behind: 1,
          dirtyCount: 1,
        },
      ],
    });
  });

  it("merges persisted lineage metadata into hydrated worktrees", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const lineage = {
      instanceId: "wt-inst-1",
      creationSource: "ui" as const,
      createdAt: 100,
      parentWorktreePath: "/tmp/proj",
      lineageCapture: {
        source: "create-worktree-request" as const,
        confidence: "explicit" as const,
      },
    };
    const runGit = vi.fn(async (_: string, args: string[]) => {
      if (args[0] === "worktree") {
        return [
          "worktree /tmp/proj",
          "HEAD abc",
          "branch refs/heads/main",
          "",
          "worktree /tmp/proj.worktrees/feat",
          "HEAD def",
          "branch refs/heads/feat",
          "",
        ].join("\n");
      }
      if (args[0] === "status") return ["# branch.ab +0 -0", ""].join("\n");
      return "";
    });
    const queries = createProjectQueries({
      projectManager,
      runGit,
      getWorktreeMetadata: () => ({
        "/tmp/proj.worktrees/feat": lineage,
      }),
    });

    await expect(queries.getProjectWorktrees("proj-1")).resolves.toEqual({
      status: "ok",
      worktrees: [
        {
          path: "/tmp/proj",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/tmp/proj.worktrees/feat",
          head: "def",
          branch: "feat",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
          lineage,
        },
      ],
    });
  });

  it("merges persisted lineage metadata into all hydrated worktree snapshots", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    projects.set(
      "proj-2",
      makeProject({ id: "proj-2", path: "/tmp/proj2", name: "proj2" }),
    );
    const lineage = {
      instanceId: "wt-inst-2",
      creationSource: "ui" as const,
      createdAt: 200,
      parentWorktreePath: "/tmp/proj2",
      lineageCapture: {
        source: "create-worktree-request" as const,
        confidence: "explicit" as const,
      },
    };
    const metadataByProject: Record<string, Record<string, typeof lineage>> = {
      "proj-2": { "/tmp/proj2.worktrees/child": lineage },
    };
    const runGit = vi.fn(async (cwd: string, args: string[]) => {
      if (args[0] === "worktree" && cwd === "/tmp/proj") {
        return [
          "worktree /tmp/proj",
          "HEAD abc",
          "branch refs/heads/main",
          "",
        ].join("\n");
      }
      if (args[0] === "worktree" && cwd === "/tmp/proj2") {
        return [
          "worktree /tmp/proj2",
          "HEAD ghi",
          "branch refs/heads/main",
          "",
          "worktree /tmp/proj2.worktrees/child",
          "HEAD jkl",
          "branch refs/heads/child",
          "",
        ].join("\n");
      }
      if (args[0] === "status") return ["# branch.ab +0 -0", ""].join("\n");
      return "";
    });
    const queries = createProjectQueries({
      projectManager,
      runGit,
      getWorktreeMetadata: (projectId) => metadataByProject[projectId] ?? {},
    });

    await expect(queries.listAllWorktrees()).resolves.toMatchObject({
      "proj-1": [{ path: "/tmp/proj", branch: "main" }],
      "proj-2": [
        { path: "/tmp/proj2", branch: "main" },
        {
          path: "/tmp/proj2.worktrees/child",
          branch: "child",
          lineage,
        },
      ],
    });
  });

  it("flags orphan=true when the worktree path is gone (ENOENT)", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async (cwd: string, args: string[]) => {
      if (args[0] === "worktree") {
        return [
          "worktree /tmp/proj",
          "HEAD abc",
          "branch refs/heads/main",
          "",
          "worktree /tmp/proj/gone",
          "HEAD def",
          "branch refs/heads/stale",
          "",
        ].join("\n");
      }
      if (args[0] === "status" && cwd === "/tmp/proj/gone") {
        const err = Object.assign(new Error("spawn ENOENT"), {
          code: "ENOENT",
        });
        throw err;
      }
      if (args[0] === "status") {
        return ["# branch.ab +0 -0", ""].join("\n");
      }
      return "";
    });
    const queries = createProjectQueries({
      projectManager,
      runGit,
    });

    const out = await queries.getProjectWorktrees("proj-1");
    expect(out).toEqual({
      status: "ok",
      worktrees: [
        {
          path: "/tmp/proj",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/tmp/proj/gone",
          head: "def",
          branch: "stale",
          orphan: true,
        },
      ],
    });
  });

  it("does not query status for prunable worktrees", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async (cwd: string, args: string[]) => {
      if (args[0] === "worktree") {
        return [
          "worktree /tmp/proj",
          "HEAD abc",
          "branch refs/heads/main",
          "",
          "worktree /tmp/proj/gone",
          "HEAD def",
          "branch refs/heads/stale",
          "prunable gitdir file points to non-existent location",
          "",
        ].join("\n");
      }
      if (args[0] === "status") {
        return ["# branch.ab +0 -0", ""].join("\n");
      }
      throw new Error(`unexpected git ${cwd} ${args.join(" ")}`);
    });
    const queries = createProjectQueries({
      projectManager,
      runGit,
    });

    const out = await queries.getProjectWorktrees("proj-1");

    expect(runGit).not.toHaveBeenCalledWith("/tmp/proj/gone", [
      "status",
      "--porcelain=v2",
      "-b",
    ]);
    expect(out).toEqual({
      status: "ok",
      worktrees: [
        {
          path: "/tmp/proj",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/tmp/proj/gone",
          head: "def",
          branch: "stale",
          orphan: true,
        },
      ],
    });
  });

  it("falls back to bare worktree when status query fails", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async (_: string, args: string[]) => {
      if (args[0] === "worktree") {
        return [
          "worktree /tmp/proj",
          "HEAD abc",
          "branch refs/heads/main",
          "",
        ].join("\n");
      }
      throw new Error("status failed");
    });
    const queries = createProjectQueries({
      projectManager,
      runGit,
    });

    await expect(queries.getProjectWorktrees("proj-1")).resolves.toEqual({
      status: "ok",
      worktrees: [{ path: "/tmp/proj", head: "abc", branch: "main" }],
    });
  });

  it("returns git-error when git is unavailable (non-git repo)", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async () => {
      throw new Error("fatal: not a git repository");
    });
    const queries = createProjectQueries({
      projectManager,
      runGit,
    });

    await expect(queries.getProjectWorktrees("proj-1")).resolves.toEqual({
      status: "git-error",
    });
  });

  it("listAllWorktrees enriches every project with counters", async () => {
    projects.set("p1", makeProject({ id: "p1", path: "/tmp/p1" }));
    projects.set("p2", makeProject({ id: "p2", path: "/tmp/p2" }));
    const runGit = vi.fn(async (cwd: string, args: string[]) => {
      if (args[0] === "worktree") {
        return [
          `worktree ${cwd}`,
          "HEAD abc",
          "branch refs/heads/main",
          "",
        ].join("\n");
      }
      if (args[0] === "status" && cwd === "/tmp/p1") {
        return ["# branch.ab +1 -0", ""].join("\n");
      }
      if (args[0] === "status" && cwd === "/tmp/p2") {
        return ["# branch.ab +0 -3", "? a", "? b", ""].join("\n");
      }
      return "";
    });
    const queries = createProjectQueries({
      projectManager,
      runGit,
    });

    const all = await queries.listAllWorktrees();
    expect(all.p1).toEqual([
      {
        path: "/tmp/p1",
        head: "abc",
        branch: "main",
        ahead: 1,
        behind: 0,
        dirtyCount: 0,
      },
    ]);
    expect(all.p2).toEqual([
      {
        path: "/tmp/p2",
        head: "abc",
        branch: "main",
        ahead: 0,
        behind: 3,
        dirtyCount: 2,
      },
    ]);
  });

  it("caps concurrent status calls during enrichment", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    let inFlight = 0;
    let peakInFlight = 0;
    const runGit = vi.fn(async (_path: string, args: string[]) => {
      if (args[0] === "worktree") {
        return Array.from({ length: 20 }, (_, i) =>
          [
            `worktree /tmp/proj/wt-${i}`,
            "HEAD abc",
            "branch refs/heads/x",
            "",
          ].join("\n"),
        ).join("");
      }
      if (args[0] === "status") {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return "# branch.ab +0 -0\n";
      }
      return "";
    });
    const queries = createProjectQueries({ projectManager, runGit });
    const out = await queries.getProjectWorktrees("proj-1");
    expect(out).toEqual(expect.objectContaining({ status: "ok" }));
    if (out.status === "ok") expect(out.worktrees).toHaveLength(20);
    // 20 worktrees but bounded enrichment must hold the peak ≤ limit.
    expect(peakInFlight).toBeLessThanOrEqual(8);
  });

  it("returns missing-path when cwd spawn is ENOENT", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async () => {
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    });
    const queries = createProjectQueries({ projectManager, runGit });
    await expect(queries.getProjectWorktrees("proj-1")).resolves.toEqual({
      status: "missing-path",
    });
  });

  it("returns ok empty worktrees for empty porcelain", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async () => "");
    const queries = createProjectQueries({ projectManager, runGit });
    await expect(queries.getProjectWorktrees("proj-1")).resolves.toEqual({
      status: "ok",
      worktrees: [],
    });
  });

  it("listAllWorktrees omits missing and git-error projects instead of caching empty", async () => {
    projects.set("ok", makeProject({ id: "ok", path: "/tmp/ok" }));
    projects.set("gone", makeProject({ id: "gone", path: "/tmp/gone" }));
    projects.set("badgit", makeProject({ id: "badgit", path: "/tmp/badgit" }));
    const runGit = vi.fn(async (cwd: string, args: string[]) => {
      if (cwd === "/tmp/gone") {
        throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      }
      if (cwd === "/tmp/badgit") {
        throw new Error("fatal: not a git repository");
      }
      if (args[0] === "worktree") {
        return [
          "worktree /tmp/ok",
          "HEAD abc",
          "branch refs/heads/main",
          "",
        ].join("\n");
      }
      return ["# branch.ab +0 -0", ""].join("\n");
    });
    const queries = createProjectQueries({ projectManager, runGit });
    const all = await queries.listAllWorktrees();
    expect(all).toEqual({
      ok: [
        {
          path: "/tmp/ok",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
      ],
    });
    expect(all).not.toHaveProperty("gone");
    expect(all).not.toHaveProperty("badgit");
  });

  describe("getWorktreeLocalFiles", () => {
    const cleanups: string[] = [];

    afterEach(() => {
      for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
      cleanups.length = 0;
    });

    function makeRepo() {
      const root = mkdtempSync(join(tmpdir(), "parasor-pq-local-files-"));
      cleanups.push(root);
      const projectPath = join(root, "project");
      execFileSync("mkdir", ["-p", projectPath]);
      const env = {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      };
      const g = (args: string[]) =>
        execFileSync("git", args, {
          cwd: projectPath,
          stdio: "pipe",
          env: { ...process.env, ...env },
        });
      g(["init", "-q"]);
      g(["checkout", "-q", "-b", "main"]);
      g(["config", "user.email", "test@example.com"]);
      g(["config", "user.name", "Test"]);
      writeFileSync(join(projectPath, ".gitignore"), ".env\n");
      writeFileSync(join(projectPath, "README.md"), "hello\n");
      g(["add", ".gitignore", "README.md"]);
      g(["commit", "-q", "-m", "init", "--no-gpg-sign"]);
      writeFileSync(join(projectPath, ".env"), "SECRET=1\n");
      return { projectPath };
    }

    it("returns ignored candidates and remembered paths", async () => {
      const { projectPath } = makeRepo();
      projects.set(
        "proj-1",
        Object.assign(makeProject({ id: "proj-1", path: projectPath }), {
          worktreeLocalFileAllowlist: [".env"],
        }),
      );
      const queries = createProjectQueries({ projectManager });

      await expect(queries.getWorktreeLocalFiles("proj-1")).resolves.toEqual({
        candidates: [{ path: ".env", size: 9 }],
        rememberedPaths: [".env"],
      });
    });

    it("defaults rememberedPaths to [] when no allowlist", async () => {
      const { projectPath } = makeRepo();
      projects.set("proj-1", makeProject({ id: "proj-1", path: projectPath }));
      const queries = createProjectQueries({ projectManager });

      const result = await queries.getWorktreeLocalFiles("proj-1");
      expect(result.rememberedPaths).toEqual([]);
    });

    it("throws WorkspaceNotFoundError for a missing project", async () => {
      const queries = createProjectQueries({ projectManager });
      await expect(
        queries.getWorktreeLocalFiles("missing"),
      ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    });
  });

  it("throws for a missing project", async () => {
    const queries = createProjectQueries({
      projectManager,
    });

    await expect(
      queries.getProjectDiff("missing", "/tmp/proj"),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });
});

describe("defaultRunGit", () => {
  // The orphan-detection branch in enrichWithCounters keys on
  // err.code === "ENOENT" -- that signal must arrive when the worktree
  // directory is gone. With `cwd: <missing>`, Node's chdir step in the
  // child fork fails before git runs, surfacing the ENOENT we want.
  // (`git -C <missing>` would instead exit 128 with a localized stderr,
  // which can't be matched safely.)
  it("rejects with code='ENOENT' when cwd does not exist", async () => {
    await expect(
      defaultRunGit("/tmp/parasor-orphan-probe-does-not-exist-xyzzy", [
        "status",
      ]),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

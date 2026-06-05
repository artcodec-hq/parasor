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

    await expect(queries.getProjectWorktrees("proj-1")).resolves.toEqual([
      {
        path: "/tmp/proj",
        head: "abc",
        branch: "main",
        ahead: 2,
        behind: 1,
        dirtyCount: 1,
      },
    ]);
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
    expect(out).toEqual([
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
    ]);
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

    await expect(queries.getProjectWorktrees("proj-1")).resolves.toEqual([
      { path: "/tmp/proj", head: "abc", branch: "main" },
    ]);
  });

  it("returns empty array when git is unavailable (non-git repo)", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const runGit = vi.fn(async () => {
      throw new Error("fatal: not a git repository");
    });
    const queries = createProjectQueries({
      projectManager,
      runGit,
    });

    await expect(queries.getProjectWorktrees("proj-1")).resolves.toEqual([]);
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
    expect(out).toHaveLength(20);
    // 20 worktrees but bounded enrichment must hold the peak ≤ limit.
    expect(peakInFlight).toBeLessThanOrEqual(8);
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

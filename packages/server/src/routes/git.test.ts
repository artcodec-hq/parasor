import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitState, Worktree } from "@parasor/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectRuntime } from "../bootstrap/project-runtime.js";
import type { ProjectManager } from "../state/project-manager.js";
import { WorktreeCache } from "../state/worktree-cache.js";
import { createGitRoutes, parseGitLog } from "./git.js";

const GIT_ROUTE_INTEGRATION_TIMEOUT_MS = 15_000;

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initRepo(path: string) {
  git(path, ["init", "-q"]);
  git(path, ["checkout", "-q", "-b", "main"]);
  git(path, ["config", "user.email", "test@example.com"]);
  git(path, ["config", "user.name", "Test"]);
  git(path, ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"]);
}

interface Harness {
  app: Hono;
  project: { id: string; path: string };
  worktreeCache: WorktreeCache;
  refreshGitState: ReturnType<typeof vi.fn>;
  gitStates: Record<string, Record<string, GitState | null>>;
}

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "parasor-git-route-"));
  const projectPath = join(root, "project");
  execFileSync("mkdir", ["-p", projectPath]);
  initRepo(projectPath);

  const project = { id: "proj-1", path: projectPath };

  const projectManager = {
    get: vi.fn((id: string) => (id === project.id ? project : undefined)),
  } as unknown as ProjectManager;

  const worktreeCache = new WorktreeCache();
  worktreeCache.setAll({});

  const gitStates: Record<string, Record<string, GitState | null>> = {};
  const refreshGitState = vi.fn(async () => {});
  const projectRuntime = {
    refreshGitState,
    getGitStates: () => gitStates,
  } as unknown as ProjectRuntime;

  const app = new Hono();
  app.route(
    "/api/projects",
    createGitRoutes({ projectManager, worktreeCache, projectRuntime }),
  );

  return { app, project, worktreeCache, refreshGitState, gitStates };
}

let harnesses: string[] = [];
function tracked(): Harness {
  const h = makeHarness();
  harnesses.push(h.project.path);
  return h;
}

afterEach(() => {
  for (const path of harnesses) {
    rmSync(path, { recursive: true, force: true });
  }
  harnesses = [];
});

// These exercise real git operations (init, commits, bare remotes,
// fetch/pull/push) that run for seconds and slow further under the full
// parallel suite's CPU contention -- the default 5s timeout flaked them. They
// complete correctly given headroom; raise the timeout rather than mask.
vi.setConfig({ testTimeout: 30_000 });

describe("git routes", () => {
  describe("GET /:id/git/status", () => {
    it("returns 400 when worktreePath is missing", async () => {
      const { app, project } = tracked();
      const res = await app.request(`/api/projects/${project.id}/git/status`);
      expect(res.status).toBe(400);
    });

    // Characterization: pin the exact 400 body so the boundary-cleanup
    // refactor (shared resolveWorktreeOrError helper) stays byte-identical.
    it("returns 400 'worktreePath is required' body when worktreePath is missing", async () => {
      const { app, project } = tracked();
      const res = await app.request(`/api/projects/${project.id}/git/status`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("worktreePath is required");
    });

    it("returns 404 when project is unknown", async () => {
      const { app, project } = tracked();
      const res = await app.request(
        `/api/projects/unknown/git/status?worktreePath=${encodeURIComponent(project.path)}`,
      );
      expect(res.status).toBe(404);
    });

    // Characterization: the project-missing body MUST stay "Project not found"
    // (NOT the application layer's default "Not found").
    it("returns 404 'Project not found' body when project is unknown", async () => {
      const { app, project } = tracked();
      const res = await app.request(
        `/api/projects/unknown/git/status?worktreePath=${encodeURIComponent(project.path)}`,
      );
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Project not found");
    });

    it("refreshes and returns the cached state", async () => {
      const { app, project, refreshGitState, gitStates } = tracked();
      gitStates[project.id] = {};
      refreshGitState.mockImplementation(async (pid: string, wt: string) => {
        const states = gitStates[pid] ?? {};
        gitStates[pid] = states;
        states[wt] = {
          branch: "main",
          dirty: false,
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
          lastChecked: Date.now(),
        };
      });
      const res = await app.request(
        `/api/projects/${project.id}/git/status?worktreePath=${encodeURIComponent(project.path)}`,
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { state: GitState };
      expect(data.state.branch).toBe("main");
      expect(refreshGitState).toHaveBeenCalledOnce();
    });
  });

  describe("POST /:id/git/commit", () => {
    it("rejects empty paths", async () => {
      const { app, project } = tracked();
      const res = await app.request(`/api/projects/${project.id}/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: project.path,
          message: "msg",
          paths: [],
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects missing message", async () => {
      const { app, project } = tracked();
      const res = await app.request(`/api/projects/${project.id}/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: project.path,
          message: "  ",
          paths: ["x"],
        }),
      });
      expect(res.status).toBe(400);
    });

    it("commits the supplied paths", async () => {
      const { app, project, refreshGitState } = tracked();
      writeFileSync(join(project.path, "a.txt"), "hello");
      const res = await app.request(`/api/projects/${project.id}/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: project.path,
          message: "feat: add a.txt",
          paths: ["a.txt"],
        }),
      });
      expect(res.status).toBe(200);
      expect(refreshGitState).toHaveBeenCalledOnce();
      const log = execFileSync("git", ["log", "--oneline", "-1"], {
        cwd: project.path,
      })
        .toString()
        .trim();
      expect(log).toContain("feat: add a.txt");
    });

    it("returns 409 when commit fails (no staged changes)", async () => {
      const { app, project } = tracked();
      const res = await app.request(`/api/projects/${project.id}/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: project.path,
          message: "noop",
          paths: ["nonexistent.txt"],
        }),
      });
      expect(res.status).toBe(409);
    });

    it("rejects an unregistered worktreePath with 404", async () => {
      const { app, project } = tracked();
      const stray = mkdtempSync(join(tmpdir(), "parasor-git-stray-"));
      try {
        const res = await app.request(
          `/api/projects/${project.id}/git/commit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              worktreePath: stray,
              message: "noop",
              paths: ["x"],
            }),
          },
        );
        expect(res.status).toBe(404);
        // Characterization: the unregistered-worktree body is the original
        // WorktreeNotRegisteredError message carrying the client path.
        const data = (await res.json()) as { error: string };
        expect(data.error).toBe(`Worktree not registered: ${stray}`);
      } finally {
        rmSync(stray, { recursive: true, force: true });
      }
    });
  });

  describe("POST /:id/git/fetch and /pull and /push", () => {
    function setupRemote(): {
      app: Hono;
      project: { id: string; path: string };
      remote: string;
      refreshGitState: ReturnType<typeof vi.fn>;
    } {
      const { app, project, refreshGitState } = tracked();
      const remote = mkdtempSync(join(tmpdir(), "parasor-git-remote-"));
      harnesses.push(remote);
      execFileSync("git", ["init", "-q", "--bare"], { cwd: remote });
      git(project.path, ["remote", "add", "origin", remote]);
      git(project.path, ["push", "-q", "-u", "origin", "main"]);
      return { app, project, remote, refreshGitState };
    }

    it("fetch returns ok", async () => {
      const { app, project, refreshGitState } = setupRemote();
      const res = await app.request(`/api/projects/${project.id}/git/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: project.path }),
      });
      expect(res.status).toBe(200);
      expect(refreshGitState).toHaveBeenCalledOnce();
    });

    it("push returns ok with new commits", async () => {
      const { app, project, refreshGitState } = setupRemote();
      writeFileSync(join(project.path, "b.txt"), "hi");
      git(project.path, ["add", "b.txt"]);
      git(project.path, ["commit", "-q", "-m", "add b", "--no-gpg-sign"]);
      const res = await app.request(`/api/projects/${project.id}/git/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: project.path }),
      });
      expect(res.status).toBe(200);
      expect(refreshGitState).toHaveBeenCalledOnce();
    });

    it("pull --rebase returns ok", async () => {
      const { app, project, refreshGitState } = setupRemote();
      const res = await app.request(`/api/projects/${project.id}/git/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: project.path, rebase: true }),
      });
      expect(res.status).toBe(200);
      expect(refreshGitState).toHaveBeenCalledOnce();
    });

    it("switches to a local branch", async () => {
      const { app, project, refreshGitState } = tracked();
      git(project.path, ["checkout", "-q", "-b", "feature/switch"]);
      git(project.path, ["checkout", "-q", "main"]);
      const res = await app.request(`/api/projects/${project.id}/git/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: project.path,
          branch: "feature/switch",
        }),
      });
      expect(res.status).toBe(200);
      expect(
        execFileSync("git", ["branch", "--show-current"], {
          cwd: project.path,
        })
          .toString()
          .trim(),
      ).toBe("feature/switch");
      expect(refreshGitState).toHaveBeenCalledOnce();
    });

    it("rejects invalid switch branch names before running git", async () => {
      const { app, project } = tracked();
      const res = await app.request(`/api/projects/${project.id}/git/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: project.path,
          branch: "-bad",
        }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("reserved character");
    });

    it("creates and switches to a local branch from a remote tracking branch", async () => {
      const { app, project, refreshGitState } = setupRemote();
      git(project.path, ["checkout", "-q", "-b", "remote-source"]);
      writeFileSync(join(project.path, "remote.txt"), "remote");
      git(project.path, ["add", "remote.txt"]);
      git(project.path, [
        "commit",
        "-q",
        "-m",
        "remote source",
        "--no-gpg-sign",
      ]);
      git(project.path, ["push", "-q", "origin", "remote-source"]);
      git(project.path, ["checkout", "-q", "main"]);
      git(project.path, ["branch", "-D", "remote-source"]);
      git(project.path, ["fetch", "-q", "origin"]);

      const res = await app.request(`/api/projects/${project.id}/git/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: project.path,
          branch: "remote-source",
          startPoint: "origin/remote-source",
        }),
      });

      expect(res.status).toBe(200);
      expect(
        execFileSync("git", ["branch", "--show-current"], {
          cwd: project.path,
        })
          .toString()
          .trim(),
      ).toBe("remote-source");
      expect(refreshGitState).toHaveBeenCalledOnce();
    });

    it("log returns recent commits with assigned lanes", async () => {
      const { app, project } = tracked();
      writeFileSync(join(project.path, "a.txt"), "1");
      git(project.path, ["add", "a.txt"]);
      git(project.path, ["commit", "-q", "-m", "add a", "--no-gpg-sign"]);
      writeFileSync(join(project.path, "b.txt"), "2");
      git(project.path, ["add", "b.txt"]);
      git(project.path, ["commit", "-q", "-m", "add b", "--no-gpg-sign"]);
      const res = await app.request(
        `/api/projects/${project.id}/git/log?worktreePath=${encodeURIComponent(
          project.path,
        )}&limit=10`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        commits: Array<{
          subject: string;
          lane: number;
          colorId: number;
          refs: Array<{ label: string; type: string }>;
        }>;
        hasUncommitted: boolean;
      };
      expect(body.commits.length).toBeGreaterThanOrEqual(2);
      expect(body.commits[0].subject).toBe("add b");
      expect(body.commits[0].lane).toBe(0);
      expect(typeof body.commits[0].colorId).toBe("number");
      // HEAD ref shows up on the tip commit with type "head".
      expect(body.commits[0].refs.map((r) => r.label)).toContain("HEAD");
      expect(body.commits[0].refs.find((r) => r.label === "HEAD")?.type).toBe(
        "head",
      );
      expect(body.hasUncommitted).toBe(false);
    });

    it("log surfaces hasUncommitted when working tree dirty", async () => {
      const { app, project } = tracked();
      writeFileSync(join(project.path, "x.txt"), "x");
      const res = await app.request(
        `/api/projects/${project.id}/git/log?worktreePath=${encodeURIComponent(
          project.path,
        )}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { hasUncommitted: boolean };
      expect(body.hasUncommitted).toBe(true);
    });

    it("log paginates with skip and omits hasUncommitted on subsequent pages", async () => {
      const { app, project } = tracked();
      writeFileSync(join(project.path, "x.txt"), "dirty"); // dirty working tree
      // Add 3 more commits on top of the seed commit
      for (let i = 0; i < 3; i++) {
        writeFileSync(join(project.path, `file${i}.txt`), `${i}`);
        git(project.path, ["add", `file${i}.txt`]);
        git(project.path, [
          "commit",
          "-q",
          "-m",
          `commit ${i}`,
          "--no-gpg-sign",
        ]);
      }
      const page1 = (await (
        await app.request(
          `/api/projects/${project.id}/git/log?worktreePath=${encodeURIComponent(
            project.path,
          )}&limit=2`,
        )
      ).json()) as {
        commits: Array<{ subject: string }>;
        hasUncommitted: boolean;
      };
      expect(page1.commits).toHaveLength(2);
      expect(page1.commits[0].subject).toBe("commit 2");
      expect(page1.commits[1].subject).toBe("commit 1");
      expect(page1.hasUncommitted).toBe(true);

      const page2 = (await (
        await app.request(
          `/api/projects/${project.id}/git/log?worktreePath=${encodeURIComponent(
            project.path,
          )}&limit=2&skip=2`,
        )
      ).json()) as {
        commits: Array<{ subject: string }>;
        hasUncommitted: boolean;
      };
      expect(page2.commits.length).toBeGreaterThanOrEqual(1);
      expect(page2.commits[0].subject).toBe("commit 0");
      // hasUncommitted is suppressed on subsequent pages -- the pre-existing
      // dirty file is real but the client already received the flag on page 1.
      expect(page2.hasUncommitted).toBe(false);
    });

    it(
      "log pagination preserves swimlane continuity across page boundaries",
      async () => {
        const { app, project } = tracked();
        // Six commits in a linear chain so every page has one continuing lane.
        for (let i = 0; i < 6; i++) {
          writeFileSync(join(project.path, `file${i}.txt`), `${i}`);
          git(project.path, ["add", `file${i}.txt`]);
          git(project.path, [
            "commit",
            "-q",
            "-m",
            `commit ${i}`,
            "--no-gpg-sign",
          ]);
        }
        type CommitShape = {
          sha: string;
          subject: string;
          outputSwimlanes: Array<{
            colorId: number;
            expectingSha: string | null;
          } | null>;
          inputSwimlanes: Array<{
            colorId: number;
            expectingSha: string | null;
          } | null>;
        };
        const fetchPage = async (
          limit: number,
          skip: number,
        ): Promise<CommitShape[]> => {
          const r = await app.request(
            `/api/projects/${project.id}/git/log?worktreePath=${encodeURIComponent(
              project.path,
            )}&limit=${limit}&skip=${skip}`,
          );
          const body = (await r.json()) as { commits: CommitShape[] };
          return body.commits;
        };
        const page1 = await fetchPage(3, 0);
        const page2 = await fetchPage(3, 3);
        expect(page1).toHaveLength(3);
        expect(page2.length).toBeGreaterThanOrEqual(3);
        // The first commit of page 2 must see the same lane state as the last
        // commit of page 1 produced -- without that, lane indices/colors snap
        // visibly at the boundary.
        expect(page2[0].inputSwimlanes).toEqual(page1[2].outputSwimlanes);
        // The continuing lane keeps its colorId across the boundary so the
        // renderer paints one continuous branch line through the page join.
        const last1 = page1[2].outputSwimlanes.find((s) => s !== null);
        const first2 = page2[0].inputSwimlanes.find((s) => s !== null);
        expect(last1).toBeDefined();
        expect(first2).toBeDefined();
        expect(first2?.colorId).toBe(last1?.colorId);
      },
      GIT_ROUTE_INTEGRATION_TIMEOUT_MS,
    );

    it("log returns an empty array on an unborn-branch repository", async () => {
      // Custom harness -- `tracked()` seeds an initial commit, so we can't
      // reuse it for the empty-repo case.
      const root = mkdtempSync(join(tmpdir(), "parasor-git-empty-"));
      harnesses.push(root);
      const projectPath = join(root, "project");
      execFileSync("mkdir", ["-p", projectPath]);
      git(projectPath, ["init", "-q"]);
      git(projectPath, ["checkout", "-q", "-b", "main"]);
      const project = { id: "proj-empty", path: projectPath };
      const projectManager = {
        get: vi.fn((id: string) => (id === project.id ? project : undefined)),
      } as unknown as ProjectManager;
      const worktreeCache = new WorktreeCache();
      worktreeCache.setAll({});
      const projectRuntime = {
        refreshGitState: vi.fn(async () => {}),
        getGitStates: () => ({}),
      } as unknown as ProjectRuntime;
      const app = new Hono();
      app.route(
        "/api/projects",
        createGitRoutes({ projectManager, worktreeCache, projectRuntime }),
      );
      const res = await app.request(
        `/api/projects/${project.id}/git/log?worktreePath=${encodeURIComponent(
          project.path,
        )}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        commits: unknown[];
        hasUncommitted: boolean;
      };
      expect(body.commits).toEqual([]);
    });

    it("log includeRemotes=1 returns remote commits when local HEAD is unborn", async () => {
      // Build a bare remote that already has a commit.
      const remoteDir = mkdtempSync(
        join(tmpdir(), "parasor-git-unborn-remote-"),
      );
      harnesses.push(remoteDir);
      git(remoteDir, ["init", "-q", "--bare"]);
      const seedClone = mkdtempSync(join(tmpdir(), "parasor-git-unborn-seed-"));
      harnesses.push(seedClone);
      git(seedClone, ["clone", "-q", remoteDir, "."]);
      git(seedClone, ["checkout", "-q", "-b", "main"]);
      writeFileSync(join(seedClone, "seed.txt"), "x");
      git(seedClone, ["add", "seed.txt"]);
      git(seedClone, ["commit", "-q", "-m", "seed", "--no-gpg-sign"]);
      git(seedClone, [
        "push",
        "-q",
        "--set-upstream",
        "origin",
        "main",
        "--no-verify",
      ]);

      // Now build the project repo as unborn HEAD with a fetched remote ref --
      // simulates a fresh clone before the initial checkout, or a brand-new
      // repo that just added a remote.
      const root = mkdtempSync(join(tmpdir(), "parasor-git-unborn-proj-"));
      harnesses.push(root);
      const projectPath = join(root, "project");
      execFileSync("mkdir", ["-p", projectPath]);
      git(projectPath, ["init", "-q"]);
      git(projectPath, ["checkout", "-q", "-b", "main"]);
      git(projectPath, ["remote", "add", "origin", remoteDir]);
      git(projectPath, ["fetch", "-q", "origin"]);

      const project = { id: "proj-unborn-remote", path: projectPath };
      const projectManager = {
        get: vi.fn((id: string) => (id === project.id ? project : undefined)),
      } as unknown as ProjectManager;
      const worktreeCache = new WorktreeCache();
      worktreeCache.setAll({});
      const projectRuntime = {
        refreshGitState: vi.fn(async () => {}),
        getGitStates: () => ({}),
      } as unknown as ProjectRuntime;
      const app = new Hono();
      app.route(
        "/api/projects",
        createGitRoutes({ projectManager, worktreeCache, projectRuntime }),
      );
      const res = await app.request(
        `/api/projects/${project.id}/git/log?worktreePath=${encodeURIComponent(
          project.path,
        )}&includeRemotes=1`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        commits: Array<{ subject: string }>;
      };
      // Without the unborn-HEAD retry the whole graph would be empty even
      // though origin/main is fetched; with the retry the seed commit shows up.
      expect(body.commits.find((c) => c.subject === "seed")).toBeDefined();
    });

    it(
      "log includeRemotes=1 surfaces commits reachable from remote branches only",
      async () => {
        const { app, project } = tracked();
        git(project.path, ["checkout", "-q", "-b", "remote-only"]);
        writeFileSync(join(project.path, "remote-only.txt"), "r");
        git(project.path, ["add", "remote-only.txt"]);
        git(project.path, [
          "commit",
          "-q",
          "-m",
          "remote-only commit",
          "--no-gpg-sign",
        ]);
        git(project.path, [
          "update-ref",
          "refs/remotes/origin/remote-only",
          "HEAD",
        ]);
        git(project.path, ["checkout", "-q", "main"]);
        git(project.path, ["branch", "-D", "remote-only"]);

        // Default (no includeRemotes) -- only HEAD-reachable commits, so the
        // remote-only commit is invisible.
        const defaultRes = (await (
          await app.request(
            `/api/projects/${project.id}/git/log?worktreePath=${encodeURIComponent(
              project.path,
            )}`,
          )
        ).json()) as { commits: Array<{ subject: string }> };
        expect(
          defaultRes.commits.find((c) => c.subject === "remote-only commit"),
        ).toBeUndefined();

        // includeRemotes=1 -- walks origin/remote-only too, surfacing the commit.
        const remoteRes = (await (
          await app.request(
            `/api/projects/${project.id}/git/log?worktreePath=${encodeURIComponent(
              project.path,
            )}&includeRemotes=1`,
          )
        ).json()) as {
          commits: Array<{
            subject: string;
            refs: Array<{ label: string; type: string }>;
          }>;
        };
        const remoteCommit = remoteRes.commits.find(
          (c) => c.subject === "remote-only commit",
        );
        expect(remoteCommit).toBeDefined();
        expect(remoteCommit?.refs.find((r) => r.type === "remote")?.label).toBe(
          "origin/remote-only",
        );
      },
      GIT_ROUTE_INTEGRATION_TIMEOUT_MS,
    );

    it("init creates a repo in a non-git project", async () => {
      const { refreshGitState } = tracked();
      const root = mkdtempSync(join(tmpdir(), "parasor-git-noinit-"));
      harnesses.push(root);
      const projectPath = join(root, "project");
      execFileSync("mkdir", ["-p", projectPath]);

      const project = { id: "noinit-1", path: projectPath };
      const projectManager = {
        get: vi.fn((id: string) => (id === project.id ? project : undefined)),
      } as unknown as ProjectManager;
      const worktreeCache = new WorktreeCache();
      worktreeCache.setAll({});
      const localApp = new Hono();
      localApp.route(
        "/api/projects",
        createGitRoutes({
          projectManager,
          worktreeCache,
          projectRuntime: {
            refreshGitState: refreshGitState as never,
            getGitStates: () => ({}),
          } as unknown as ProjectRuntime,
        }),
      );

      const res = await localApp.request(
        `/api/projects/${project.id}/git/init`,
        { method: "POST" },
      );
      expect(res.status).toBe(200);
      // git init produces a .git dir; verify by running rev-parse.
      execFileSync("git", ["-C", projectPath, "rev-parse", "--git-dir"]);
    });

    it("init returns 409 when project is already a repo", async () => {
      const { app, project } = tracked();
      const res = await app.request(`/api/projects/${project.id}/git/init`, {
        method: "POST",
      });
      expect(res.status).toBe(409);
    });

    it("commit accepts a registered linked worktree", async () => {
      const { app, project, worktreeCache } = tracked();
      const wtPath = join(`${project.path}.worktrees`, "feat");
      git(project.path, ["worktree", "add", "-q", "-b", "feat", wtPath]);
      const wts: Worktree[] = [{ path: wtPath, head: "", branch: "feat" }];
      worktreeCache.setProject(project.id, wts);
      writeFileSync(join(wtPath, "z.txt"), "hi");
      const res = await app.request(`/api/projects/${project.id}/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: wtPath,
          message: "feat: z",
          paths: ["z.txt"],
        }),
      });
      expect(res.status).toBe(200);
      // cleanup before afterEach (linked worktree path lives outside project.path)
      harnesses.push(wtPath);
    });
  });

  describe("parseGitLog", () => {
    it("assigns lanes and parses refs for a linear chain", () => {
      // `--decorate=full` form: refs/heads, refs/remotes, refs/tags prefixes.
      const raw =
        "abc\x00def\x00alice\x001700000010\x00HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0.0\x00add b\x1e" +
        "def\x00\x00alice\x001700000000\x00\x00init\x1e";
      const out = parseGitLog(raw);
      expect(out).toHaveLength(2);
      expect(out[0].sha).toBe("abc");
      expect(out[0].parents).toEqual(["def"]);
      expect(out[0].refs).toEqual([
        { label: "HEAD", type: "head" },
        { label: "main", type: "local" },
        { label: "origin/main", type: "remote" },
        { label: "v1.0.0", type: "tag" },
      ]);
      expect(out[0].lane).toBe(0);
      expect(out[1].lane).toBe(0);
      expect(out[0].colorId).toBe(out[1].colorId);
    });

    it("distinguishes local branches with slashes from remote branches", () => {
      const raw =
        "abc\x00\x00alice\x001\x00refs/heads/feat/foo, refs/remotes/origin/feat/foo\x00x\x1e";
      const out = parseGitLog(raw);
      expect(out[0].refs).toEqual([
        { label: "feat/foo", type: "local" },
        { label: "origin/feat/foo", type: "remote" },
      ]);
    });

    it("emits per-row swimlane snapshots for a linear chain", () => {
      const raw =
        "abc\x00def\x00alice\x002\x00\x00b\x1e" +
        "def\x00\x00alice\x001\x00\x00a\x1e";
      const out = parseGitLog(raw);
      // Row 0: input is a fresh lane (no inherited snapshot from above), output points at parent def.
      expect(out[0].inputSwimlanes).toHaveLength(0);
      expect(out[0].outputSwimlanes).toEqual([
        { colorId: out[0].colorId, expectingSha: "def" },
      ]);
      // Row 1 (root): output empties because no parent.
      expect(out[1].inputSwimlanes).toEqual([
        { colorId: out[0].colorId, expectingSha: "def" },
      ]);
      expect(out[1].outputSwimlanes).toEqual([]);
    });

    it("assigns a fresh lane and color to a side branch", () => {
      // root <- main <- merge ; merge has parents [main, side]; side <- root
      const raw =
        "merge\x00main side\x00alice\x004\x00HEAD\x00merge\x1e" +
        "main\x00root\x00alice\x003\x00\x00main commit\x1e" +
        "side\x00root\x00alice\x002\x00\x00side commit\x1e" +
        "root\x00\x00alice\x001\x00\x00root\x1e";
      const out = parseGitLog(raw);
      expect(out[0].lane).toBe(0);
      expect(out[1].lane).toBe(0);
      expect(out[2].lane).toBe(1);
      expect(out[3].lane).toBe(0);
      // Side branch gets a different color from main.
      expect(out[2].colorId).not.toBe(out[1].colorId);
      // Merge commit's outputSwimlanes carries both parents.
      const expecting = out[0].outputSwimlanes.map((s) => s?.expectingSha);
      expect(expecting).toContain("main");
      expect(expecting).toContain("side");
    });

    it("compacts lanes when a side branch ends mid-page", () => {
      // tip(0) -> a(0) ; tip's 2nd parent = sideTip(1) -> sideMid(1) -> a(0)
      // After sideMid resolves into 'a', lane 1 should free, so 'a' sits at lane 0
      // and outputSwimlanes carries only one entry (compaction worked).
      const raw =
        "tip\x00a sideTip\x00alice\x005\x00\x00merge tip\x1e" +
        "sideTip\x00sideMid\x00alice\x004\x00\x00side tip\x1e" +
        "sideMid\x00a\x00alice\x003\x00\x00side mid\x1e" +
        "a\x00b\x00alice\x002\x00\x00a\x1e" +
        "b\x00\x00alice\x001\x00\x00b\x1e";
      const out = parseGitLog(raw);
      // After 'a' merges, only one lane should remain heading to 'b'.
      const aIdx = out.findIndex((c) => c.sha === "a");
      expect(out[aIdx].outputSwimlanes).toHaveLength(1);
      expect(out[aIdx].outputSwimlanes[0]?.expectingSha).toBe("b");
    });

    it("preserves subjects with embedded newlines/spaces", () => {
      const raw = "abc\x00\x00alice\x001\x00\x00line1\nline2 with spaces\x1e";
      const out = parseGitLog(raw);
      expect(out[0].subject).toBe("line1\nline2 with spaces");
    });

    it("ignores empty trailing record", () => {
      const raw = "abc\x00\x00alice\x001\x00\x00init\x1e\n";
      const out = parseGitLog(raw);
      expect(out).toHaveLength(1);
    });

    it("terminates lanes whose parent is out-of-window so later branch tips don't get pushed right", () => {
      // Three independent branch tips, all with parents that are NOT in this
      // result page. Without termination, each tip would consume a permanent
      // column and the third tip would land at lane 2 (or higher). With
      // out-of-window detection, every tip terminates immediately and reuses
      // lane 0.
      const raw =
        "tipA\x00missingA\x00alice\x003\x00refs/remotes/origin/featA\x00A\x1e" +
        "tipB\x00missingB\x00alice\x002\x00refs/remotes/origin/featB\x00B\x1e" +
        "tipC\x00missingC\x00alice\x001\x00refs/remotes/origin/featC\x00C\x1e";
      const out = parseGitLog(raw);
      expect(out).toHaveLength(3);
      // Every tip terminates because its parent isn't loaded.
      expect(out[0].outputSwimlanes).toEqual([]);
      expect(out[1].outputSwimlanes).toEqual([]);
      expect(out[2].outputSwimlanes).toEqual([]);
      // Each tip therefore lands in lane 0 -- no rightward staircase.
      expect(out.map((c) => c.lane)).toEqual([0, 0, 0]);
    });
  });
});

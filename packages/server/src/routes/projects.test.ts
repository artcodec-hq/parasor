import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  IdeCommandConfig,
  Project,
  ProjectState,
  Session,
  Worktree,
} from "@parasor/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdeEditor } from "../lib/open-in-ide.js";
import type { PtyHost } from "../pty/host.js";
import type {
  AppStateStore,
  ProjectStatesMutateView,
  ProjectsMutateView,
} from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { WorktreeCache } from "../state/worktree-cache.js";
import type { EventBus } from "../ws/events.js";
import { createProjectRoutes } from "./projects.js";

// Several route cases exercise real git repositories and ignored-file scans.
// Give them the same kind of headroom as the git route integration tests.
vi.setConfig({ testTimeout: 15_000 });

function makeProject(
  overrides: Partial<{
    id: string;
    path: string;
    name: string;
    pinned: boolean;
  }> = {},
): Project {
  return {
    id: overrides.id ?? "proj-1",
    path: overrides.path ?? "/tmp/proj",
    name: overrides.name ?? "proj",
    pinned: overrides.pinned ?? false,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  };
}

function makeSession(id: string, projectId: string): Session {
  return {
    id,
    projectId,
    state: "running",
    pid: 1234,
    cwd: "/tmp/proj",
    generation: 0,
    title: "bash",
    command: { type: "shell" },
    shell: "/bin/bash",
    createdAt: 1,
  };
}

function makeProjectState(
  projectId: string,
  layout: ProjectState["layout"] = null,
): ProjectState {
  return {
    projectId,
    layout,
    worktrees: [],
    openFiles: [],
    lastFocusedPaneId: null,
    focusedPaneId: null,
    lastAccessedAt: 1,
  };
}

function makeMocks() {
  const projects = new Map<string, Project>();

  const pm = {
    list: vi.fn(() => [...projects.values()]),
    get: vi.fn((id: string) => projects.get(id)),
    create: vi.fn((opts: { path: string; name?: string; color?: string }) => {
      const p = makeProject({
        path: opts.path,
        name: opts.name ?? opts.path.split("/").pop(),
      });
      projects.set(p.id, p);
      return p;
    }),
    update: vi.fn(
      (
        id: string,
        data: Partial<Pick<Project, "name" | "pinned" | "readOnly">>,
      ) => {
        const p = projects.get(id);
        if (!p) return undefined;
        Object.assign(p, data);
        return p;
      },
    ),
    delete: vi.fn((id: string) => {
      projects.delete(id);
      return true;
    }),
    reorder: vi.fn((ids: string[]) => {
      if (ids.length !== projects.size) return undefined;
      const idSet = new Set(ids);
      if (idSet.size !== ids.length) return undefined;
      for (const id of projects.keys()) {
        if (!idSet.has(id)) return undefined;
      }
      ids.forEach((id, idx) => {
        const p = projects.get(id);
        if (p) p.order = idx;
      });
      return [...projects.values()];
    }),
  } as unknown as ProjectManager;

  const eventBus = { broadcast: vi.fn() } as unknown as EventBus;

  const ptyManager = {
    listByProject: vi.fn(() => []),
    dispose: vi.fn(async () => {}),
  } as unknown as PtyHost;

  const projectStates: Record<string, ProjectState> = {};
  const workItems = {};
  let ideCommands: IdeCommandConfig[] = [];
  const store = {
    get: vi.fn(() => ({
      projects: [...projects.values()],
      sessions: [],
      projectStates,
      workItems,
      ideCommands,
    })),
    mutateProjects: vi.fn((fn: (s: ProjectsMutateView) => void) =>
      fn({ projects: [...projects.values()], projectStates, workItems }),
    ),
    mutateProjectStates: vi.fn((fn: (s: ProjectStatesMutateView) => void) =>
      fn({ projectStates, projects: [...projects.values()], sessions: [] }),
    ),
    mutateIdeCommands: vi.fn(
      (fn: (s: { ideCommands: IdeCommandConfig[] }) => void) => {
        const state = { ideCommands };
        fn(state);
        ideCommands = state.ideCommands;
      },
    ),
  } as unknown as AppStateStore;

  const worktreeStore = new Map<string, Worktree[]>();
  const worktreeCache = {
    get: vi.fn(() => Object.fromEntries(worktreeStore)),
    setAll: vi.fn(),
    setProject: vi.fn((id: string, list: Worktree[]) => {
      worktreeStore.set(id, list);
    }),
    appendWorktree: vi.fn(),
    removeProject: vi.fn(),
  } as unknown as WorktreeCache;

  return {
    pm,
    eventBus,
    ptyManager,
    projects,
    store,
    projectStates,
    worktreeCache,
    worktreeStore,
  };
}

function createApp(
  mocks: ReturnType<typeof makeMocks>,
  opts: {
    openInIde?: (
      target: string,
      editor: IdeEditor,
      opts?: { customCommands?: IdeCommandConfig[] },
    ) => Promise<void>;
    isLocalMachineAddress?: (address: string | null) => boolean;
    remoteAddress?: (c: Context) => string | null;
  } = {},
) {
  const app = new Hono();
  app.route(
    "/api/projects",
    createProjectRoutes(
      mocks.pm,
      mocks.eventBus,
      mocks.ptyManager,
      mocks.store,
      mocks.worktreeCache,
      undefined,
      { remoteAddress: () => "127.0.0.1", ...opts },
    ),
  );
  return app;
}

describe("project routes", () => {
  let mocks: ReturnType<typeof makeMocks>;
  let app: Hono;

  beforeEach(() => {
    mocks = makeMocks();
    app = createApp(mocks);
  });

  describe("GET /api/projects", () => {
    it("returns empty array when no projects", async () => {
      const res = await app.request("/api/projects");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.projects).toEqual([]);
    });

    it("returns all projects", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      mocks.projects.set("p2", makeProject({ id: "p2" }));
      const res = await app.request("/api/projects");
      const data = await res.json();
      expect(data.projects).toHaveLength(2);
    });
  });

  describe("POST /api/projects", () => {
    it("creates project with path", async () => {
      const res = await app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/home/user/app" }),
      });
      expect(res.status).toBe(201);
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "project-created" }),
      );
    });

    it("returns 400 without path", async () => {
      const res = await app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "no-path" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("path is required");
    });

    it("handles malformed JSON", async () => {
      const res = await app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "bad json",
      });
      expect(res.status).toBe(400);
    });

    it("passes name to create", async () => {
      await app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "/tmp/x",
          name: "My App",
        }),
      });
      expect(mocks.pm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/tmp/x",
          name: "My App",
        }),
      );
    });
  });

  describe("PUT /api/projects/order", () => {
    it("reorders projects and broadcasts project-updated for each", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      mocks.projects.set("p2", makeProject({ id: "p2" }));
      mocks.projects.set("p3", makeProject({ id: "p3" }));
      const res = await app.request("/api/projects/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["p3", "p1", "p2"] }),
      });
      expect(res.status).toBe(200);
      expect(mocks.projects.get("p3")?.order).toBe(0);
      expect(mocks.projects.get("p1")?.order).toBe(1);
      expect(mocks.projects.get("p2")?.order).toBe(2);
      const updates = vi
        .mocked(mocks.eventBus.broadcast)
        .mock.calls.filter((c) => c[0].type === "project-updated");
      expect(updates).toHaveLength(3);
    });

    it("returns 400 when ids do not match the project set", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["p1", "missing"] }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when ids is not an array of strings", async () => {
      const res = await app.request("/api/projects/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [1, 2] }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON", async () => {
      const res = await app.request("/api/projects/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/projects/:id/sidebar-state", () => {
    it("merges sidebar state patches and broadcasts the full sidebar state", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      mocks.projectStates.p1 = {
        ...makeProjectState("p1"),
        sidebar: {
          paneOrder: { "/old": ["terminal:old"] },
          worktreeOpen: { "/repo": true },
        },
      };

      const res = await app.request("/api/projects/p1/sidebar-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paneOrder: { "/repo": ["terminal:s1"], "/old": null },
          worktreeOpen: { "/repo": false },
        }),
      });

      expect(res.status).toBe(200);
      expect(mocks.projectStates.p1.sidebar).toEqual({
        paneOrder: { "/repo": ["terminal:s1"] },
        worktreeOpen: { "/repo": false },
      });
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith({
        type: "sidebar-state-changed",
        projectId: "p1",
        sidebar: {
          paneOrder: { "/repo": ["terminal:s1"] },
          worktreeOpen: { "/repo": false },
        },
      });
    });

    it("returns 400 for invalid sidebar patch payloads", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      mocks.projectStates.p1 = makeProjectState("p1");
      const res = await app.request("/api/projects/p1/sidebar-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreeOpen: { "/repo": "nope" } }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 when the project does not exist", async () => {
      const res = await app.request("/api/projects/missing/sidebar-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreeOpen: { "/repo": false } }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/projects/:id", () => {
    it("updates project name", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      });
      expect(res.status).toBe(200);
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "project-updated" }),
      );
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.request("/api/projects/nonexistent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("returns 404 for nonexistent project", async () => {
      const res = await app.request("/api/projects/nonexistent", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });

    it("returns 409 for pinned project without force", async () => {
      mocks.projects.set("pinned", makeProject({ id: "pinned", pinned: true }));
      const res = await app.request("/api/projects/pinned", {
        method: "DELETE",
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("pinned");
    });

    it("deletes pinned project with force=true", async () => {
      mocks.projects.set("pinned", makeProject({ id: "pinned", pinned: true }));
      const res = await app.request("/api/projects/pinned?force=true", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
    });

    it("terminates sessions before deleting project", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      vi.mocked(mocks.ptyManager.listByProject).mockReturnValueOnce([
        makeSession("s1", "p1"),
        makeSession("s2", "p1"),
      ]);
      const res = await app.request("/api/projects/p1", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(mocks.ptyManager.dispose).toHaveBeenCalledTimes(2);
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "project-deleted", projectId: "p1" }),
      );
    });
  });

  describe("PATCH readOnly", () => {
    it("toggles readOnly via PATCH and broadcasts", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readOnly: true }),
      });
      expect(res.status).toBe(200);
      expect(mocks.pm.update).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ readOnly: true }),
      );
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "project-updated" }),
      );
    });
  });

  describe("GET /api/projects/:id/diff", () => {
    it("returns 400 without worktreePath", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/diff");
      expect(res.status).toBe(400);
    });

    // Characterization: pin the exact 400 body for the missing-worktreePath
    // branch so the boundary-cleanup refactor stays byte-identical.
    it("returns 400 'worktreePath is required' body without worktreePath", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/diff");
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("worktreePath is required");
    });

    it("returns 404 for nonexistent project even with worktreePath", async () => {
      const res = await app.request(
        `/api/projects/nonexistent/diff?worktreePath=${encodeURIComponent(
          "/tmp/wt",
        )}`,
      );
      expect(res.status).toBe(404);
    });

    // Characterization: the project-missing body MUST stay "Project not found"
    // (NOT the application layer's default "Not found").
    it("returns 404 'Project not found' body for nonexistent project", async () => {
      const res = await app.request(
        `/api/projects/nonexistent/diff?worktreePath=${encodeURIComponent(
          "/tmp/wt",
        )}`,
      );
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Project not found");
    });

    it("returns 404 when worktreePath is not registered", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request(
        `/api/projects/p1/diff?worktreePath=${encodeURIComponent(
          "/Users/somebody/secret",
        )}`,
      );
      expect(res.status).toBe(404);
    });

    // Characterization: the unregistered-worktree body is the original
    // WorktreeNotRegisteredError message carrying the client-supplied path.
    it("returns 404 'Worktree not registered' body for an unregistered worktreePath", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request(
        `/api/projects/p1/diff?worktreePath=${encodeURIComponent(
          "/Users/somebody/secret",
        )}`,
      );
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe(
        "Worktree not registered: /Users/somebody/secret",
      );
    });

    // The fence-passing path runs a real `git show` / `git diff` against a
    // tmp repo so the test exercises that the resolved path actually drives
    // the git invocation (regression guard for git environment regression).
    describe("with a real git worktree", () => {
      const cleanups: string[] = [];

      afterEach(() => {
        for (const dir of cleanups)
          rmSync(dir, { recursive: true, force: true });
        cleanups.length = 0;
      });

      function makeRepo() {
        const root = mkdtempSync(join(tmpdir(), "parasor-projects-diff-"));
        cleanups.push(root);
        const projectPath = join(root, "project");
        execFileSync("mkdir", ["-p", projectPath]);
        const env = {
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_SYSTEM: "/dev/null",
        };
        const git = (args: string[]) =>
          execFileSync("git", args, {
            cwd: projectPath,
            stdio: "pipe",
            env: { ...process.env, ...env },
          });
        git(["init", "-q"]);
        git(["checkout", "-q", "-b", "main"]);
        git(["config", "user.email", "test@example.com"]);
        git(["config", "user.name", "Test"]);
        writeFileSync(join(projectPath, "a.txt"), "hello\n");
        git(["add", "a.txt"]);
        git(["commit", "-q", "-m", "init", "--no-gpg-sign"]);
        const sha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: projectPath,
          encoding: "utf8",
        }).trim();
        return { projectPath, sha };
      }

      it("returns commit diff when sha + worktreePath resolve cleanly", async () => {
        const { projectPath, sha } = makeRepo();
        mocks.projects.set("p1", makeProject({ id: "p1", path: projectPath }));
        mocks.worktreeStore.set("p1", [
          { path: projectPath, head: sha, branch: "main" },
        ]);

        const res = await app.request(
          `/api/projects/p1/diff?sha=${sha}&worktreePath=${encodeURIComponent(
            projectPath,
          )}`,
        );
        expect(res.status).toBe(200);
        const data = (await res.json()) as { diff: string };
        expect(data.diff).toContain("+hello");
        expect(data.diff).toContain("a.txt");
      });
    });
  });

  describe("GET /api/projects/:id/worktrees", () => {
    it("returns 404 for nonexistent project", async () => {
      const res = await app.request("/api/projects/nonexistent/worktrees");
      expect(res.status).toBe(404);
    });

    it("returns 200 with missing flag when the project directory is gone", async () => {
      mocks.projects.set(
        "p1",
        makeProject({
          id: "p1",
          path: `/tmp/parasor-missing-never-${Date.now()}`,
        }),
      );
      const res = await app.request("/api/projects/p1/worktrees");
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        worktrees: [],
        missing: true,
      });
    });

    it("returns 200 with git-error and cached worktrees when git fails", async () => {
      const dir = mkdtempSync(join(tmpdir(), "parasor-not-git-"));
      mocks.projects.set("p1", makeProject({ id: "p1", path: dir }));
      mocks.worktreeStore.set("p1", [
        { path: dir, head: "abc", branch: "main" },
      ]);
      const res = await app.request("/api/projects/p1/worktrees");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error).toBe("git-error");
      expect(body.worktrees).toEqual([
        { path: dir, head: "abc", branch: "main" },
      ]);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("GET /api/projects/:id/worktree-local-files", () => {
    const cleanups: string[] = [];

    afterEach(() => {
      for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
      cleanups.length = 0;
    });

    function makeRepo() {
      const root = mkdtempSync(join(tmpdir(), "parasor-local-files-"));
      cleanups.push(root);
      const projectPath = join(root, "project");
      execFileSync("mkdir", ["-p", projectPath]);
      const env = {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      };
      const git = (args: string[]) =>
        execFileSync("git", args, {
          cwd: projectPath,
          stdio: "pipe",
          env: { ...process.env, ...env },
        });
      git(["init", "-q"]);
      git(["checkout", "-q", "-b", "main"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      writeFileSync(join(projectPath, ".gitignore"), ".env\n");
      writeFileSync(join(projectPath, "README.md"), "hello\n");
      git(["add", ".gitignore", "README.md"]);
      git(["commit", "-q", "-m", "init", "--no-gpg-sign"]);
      writeFileSync(join(projectPath, ".env"), "SECRET=1\n");
      return { projectPath };
    }

    it("returns candidate metadata and remembered paths", async () => {
      const { projectPath } = makeRepo();
      mocks.projects.set(
        "p1",
        makeProject({
          id: "p1",
          path: projectPath,
        }),
      );
      const project = mocks.projects.get("p1");
      if (!project) throw new Error("missing project fixture");
      project.worktreeLocalFileAllowlist = [".env"];

      const res = await app.request("/api/projects/p1/worktree-local-files");

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        candidates: [{ path: ".env", size: 9 }],
        rememberedPaths: [".env"],
      });
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.request(
        "/api/projects/nonexistent/worktree-local-files",
      );
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: "Not found" });
    });
  });

  describe("POST /api/projects/:id/worktrees", () => {
    const cleanups: string[] = [];

    afterEach(() => {
      for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
      cleanups.length = 0;
    });

    function makeRepo() {
      const root = mkdtempSync(join(tmpdir(), "parasor-create-wt-"));
      cleanups.push(root);
      const projectPath = join(root, "project");
      execFileSync("mkdir", ["-p", projectPath]);
      const env = {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      };
      const git = (args: string[]) =>
        execFileSync("git", args, {
          cwd: projectPath,
          stdio: "pipe",
          env: { ...process.env, ...env },
        });
      git(["init", "-q"]);
      git(["checkout", "-q", "-b", "main"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      writeFileSync(join(projectPath, ".gitignore"), ".env\n");
      writeFileSync(join(projectPath, "README.md"), "hello\n");
      git(["add", ".gitignore", "README.md"]);
      git(["commit", "-q", "-m", "init", "--no-gpg-sign"]);
      writeFileSync(join(projectPath, ".env"), "SECRET=1\n");
      return { projectPath };
    }

    it("copies selected ignored local files and remembers the selection", async () => {
      const { projectPath } = makeRepo();
      const project = makeProject({ id: "p1", path: projectPath });
      mocks.projects.set("p1", project);

      const res = await app.request("/api/projects/p1/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: "feature/env-copy",
          copyLocalFiles: [".env"],
          rememberLocalFiles: true,
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as {
        path: string;
        localFileCopies: Array<{
          path: string;
          status: string;
          size: number;
        }>;
      };
      expect(data.localFileCopies).toEqual([
        { path: ".env", size: 9, status: "copied" },
      ]);
      expect(readFileSync(join(data.path, ".env"), "utf8")).toBe("SECRET=1\n");
      expect(project.worktreeLocalFileAllowlist).toEqual([".env"]);
    }, 15_000);

    it("stores lineage metadata from the create request", async () => {
      const { projectPath } = makeRepo();
      const project = makeProject({ id: "p1", path: projectPath });
      mocks.projects.set("p1", project);
      mocks.projectStates.p1 = {
        ...makeProjectState("p1"),
        worktreeMetadata: {
          [projectPath]: {
            instanceId: "root-inst",
            creationSource: "ui",
            createdAt: 1,
            lineageCapture: {
              source: "manual",
              confidence: "explicit",
            },
          },
        },
      };

      const res = await app.request("/api/projects/p1/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: "feature/lineage",
          lineage: {
            creationSource: "ui",
            parentWorktreePath: projectPath,
            createdByPaneCommandId: "cmd:dev",
            createdByPaneCommandLabel: "Dev",
          },
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as { path: string };
      expect(
        mocks.projectStates.p1.worktreeMetadata?.[data.path],
      ).toMatchObject({
        creationSource: "ui",
        createdByPaneCommandId: "cmd:dev",
        createdByPaneCommandLabel: "Dev",
        parentWorktreePath: projectPath,
        parentWorktreeInstanceId: "root-inst",
        lineageCapture: {
          source: "create-worktree-request",
          confidence: "explicit",
        },
      });
    }, 15_000);
  });

  describe("POST /api/projects/:id/worktrees/open-os", () => {
    it("returns 400 without worktreePath", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees/open-os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.request(
        "/api/projects/nonexistent/worktrees/open-os",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ worktreePath: "/tmp/wt" }),
        },
      );
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: "Not found" });
    });

    it("rejects with 404 when worktreePath is not registered", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      // No worktrees registered for p1 -> fence rejects an arbitrary path.
      const res = await app.request("/api/projects/p1/worktrees/open-os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: "/Users/somebody/Library/secrets",
        }),
      });
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({
        error: "Worktree not registered: /Users/somebody/Library/secrets",
      });
    });
  });

  describe("POST /api/projects/:id/worktrees/open-ide", () => {
    it("reports whether the current viewer can open local IDEs", async () => {
      app = createApp(mocks, {
        isLocalMachineAddress: (address) => address === "192.168.1.42",
        remoteAddress: () => "192.168.1.42",
      });

      const res = await app.request("/api/projects/local-ide-capability", {
        method: "GET",
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ canOpenLocalIde: true });
    });

    it("returns 400 without worktreePath", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees/open-ide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editor: "cursor" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for unsupported editor", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees/open-ide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: "/tmp/wt", editor: "vim" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.request(
        "/api/projects/nonexistent/worktrees/open-ide",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ worktreePath: "/tmp/wt", editor: "cursor" }),
        },
      );
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: "Not found" });
    });

    it("rejects with 404 when worktreePath is not registered", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees/open-ide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: "/Users/somebody/Library/secrets",
          editor: "cursor",
        }),
      });
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({
        error: "Worktree not registered: /Users/somebody/Library/secrets",
      });
    });

    it("rejects non-loopback clients before launching", async () => {
      const launchIde = vi.fn(async () => undefined);
      app = createApp(mocks, {
        openInIde: launchIde,
        remoteAddress: () => "192.168.1.42",
      });
      mocks.projects.set("p1", makeProject({ id: "p1" }));

      const res = await app.request("/api/projects/p1/worktrees/open-ide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: "/tmp/wt", editor: "cursor" }),
      });

      expect(res.status).toBe(403);
      expect(launchIde).not.toHaveBeenCalled();
    });

    it("launches for same-host non-loopback clients after fencing the worktree path", async () => {
      const root = mkdtempSync(join(tmpdir(), "parasor-open-ide-local-"));
      const worktreePath = join(root, "repo");
      execFileSync("git", ["init", worktreePath]);
      const launchIde = vi.fn(async () => undefined);
      app = createApp(mocks, {
        openInIde: launchIde,
        isLocalMachineAddress: (address) => address === "192.168.1.42",
        remoteAddress: () => "192.168.1.42",
      });
      mocks.projects.set("p1", makeProject({ id: "p1", path: worktreePath }));
      mocks.worktreeStore.set("p1", [
        { path: worktreePath, head: "abc", branch: "main" },
      ]);

      try {
        const res = await app.request("/api/projects/p1/worktrees/open-ide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ worktreePath, editor: "cursor" }),
        });

        expect(res.status).toBe(200);
        expect(launchIde).toHaveBeenCalledWith(
          realpathSync(worktreePath),
          "cursor",
          { customCommands: [] },
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("launches a supported IDE after fencing the worktree path", async () => {
      const root = mkdtempSync(join(tmpdir(), "parasor-open-ide-"));
      const worktreePath = join(root, "repo");
      execFileSync("git", ["init", worktreePath]);
      const launchIde = vi.fn(async () => undefined);
      app = createApp(mocks, { openInIde: launchIde });
      mocks.projects.set("p1", makeProject({ id: "p1", path: worktreePath }));
      mocks.worktreeStore.set("p1", [
        { path: worktreePath, head: "abc", branch: "main" },
      ]);

      try {
        const res = await app.request("/api/projects/p1/worktrees/open-ide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ worktreePath, editor: "cursor" }),
        });

        expect(res.status).toBe(200);
        expect(launchIde).toHaveBeenCalledWith(
          realpathSync(worktreePath),
          "cursor",
          { customCommands: [] },
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("launches a custom IDE command after fencing the worktree path", async () => {
      const root = mkdtempSync(join(tmpdir(), "parasor-open-custom-ide-"));
      const worktreePath = join(root, "repo");
      execFileSync("git", ["init", worktreePath]);
      const launchIde = vi.fn(async () => undefined);
      app = createApp(mocks, { openInIde: launchIde });
      const customCommands = [
        { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
      ];
      mocks.store.mutateIdeCommands((state) => {
        state.ideCommands = customCommands;
      });
      mocks.projects.set("p1", makeProject({ id: "p1", path: worktreePath }));
      mocks.worktreeStore.set("p1", [
        { path: worktreePath, head: "abc", branch: "main" },
      ]);

      try {
        const res = await app.request("/api/projects/p1/worktrees/open-ide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ worktreePath, editor: "zed" }),
        });

        expect(res.status).toBe(200);
        expect(launchIde).toHaveBeenCalledWith(
          realpathSync(worktreePath),
          "zed",
          {
            customCommands,
          },
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("PATCH /api/projects/:id/worktrees", () => {
    it("returns 400 without worktreePath", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newBranch: "x" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 without newBranch", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: "/tmp/wt" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid branch name", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: "/tmp/wt",
          newBranch: "bad name",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.request("/api/projects/nonexistent/worktrees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: "/tmp/wt", newBranch: "feat" }),
      });
      expect(res.status).toBe(404);
    });

    it("rejects with 404 when worktreePath is not registered", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: "/Users/somebody/secret-repo",
          newBranch: "feat",
        }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/projects/:id/worktrees", () => {
    it("returns 400 without worktreePath", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.request("/api/projects/nonexistent/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: "/tmp/wt" }),
      });
      expect(res.status).toBe(404);
    });

    it("rejects with 404 when worktreePath is not registered", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worktreePath: "/Users/somebody/secret-repo",
        }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/projects/:id/layout", () => {
    it("updates layout and broadcasts event", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      mocks.projectStates.p1 = makeProjectState("p1");
      const layout = { type: "terminal", id: "t1", sessionId: "s1" };
      const res = await app.request("/api/projects/p1/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout }),
      });
      expect(res.status).toBe(200);
      expect(mocks.store.mutateProjectStates).toHaveBeenCalled();
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "layout-updated", projectId: "p1" }),
      );
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.request("/api/projects/nonexistent/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: null }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid JSON", async () => {
      mocks.projects.set("p1", makeProject({ id: "p1" }));
      const res = await app.request("/api/projects/p1/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "bad json",
      });
      expect(res.status).toBe(400);
    });
  });
});

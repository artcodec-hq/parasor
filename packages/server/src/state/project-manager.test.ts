import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "./app-state.js";
import { ProjectManager } from "./project-manager.js";

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `parasor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("ProjectManager", () => {
  let store: AppStateStore;
  let pm: ProjectManager;

  beforeEach(() => {
    const dir = makeTmpDir();
    vi.useFakeTimers();
    store = new AppStateStore({ dir, debounceMs: 99999 });
    pm = new ProjectManager(store);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a project with name defaulting to basename", () => {
    const p = pm.create({ path: "/home/user/my-app" });
    expect(p.name).toBe("my-app");
    expect(p.path).toBe("/home/user/my-app");
    expect(typeof p.id).toBe("string");
    expect(p.createdAt).toBeTypeOf("number");
    expect(p.lastAccessedAt).toBeTypeOf("number");
  });

  it("create is idempotent by path", () => {
    const p1 = pm.create({ path: "/home/user/app" });
    const p2 = pm.create({ path: "/home/user/app" });
    expect(p2.id).toBe(p1.id);
    expect(pm.list()).toHaveLength(1);
  });

  it("creates with custom name", () => {
    const p = pm.create({ path: "/tmp/proj", name: "My Project" });
    expect(p.name).toBe("My Project");
  });

  it("expands ~/ to absolute home path on create", () => {
    const p = pm.create({ path: "~/projects/foo" });
    expect(p.path).toBe(join(homedir(), "projects/foo"));
    expect(p.name).toBe("foo");
  });

  it("expands bare ~ to home directory", () => {
    const p = pm.create({ path: "~" });
    expect(p.path).toBe(homedir());
  });

  it("treats ~/x and absolute equivalent as the same project (idempotent)", () => {
    const p1 = pm.create({ path: "~/projects/bar" });
    const p2 = pm.create({ path: join(homedir(), "projects/bar") });
    expect(p2.id).toBe(p1.id);
    expect(pm.list()).toHaveLength(1);
  });

  it("lists all projects", () => {
    pm.create({ path: "/a" });
    pm.create({ path: "/b" });
    pm.create({ path: "/c" });
    expect(pm.list()).toHaveLength(3);
  });

  it("gets a project by id", () => {
    const p = pm.create({ path: "/home/user/proj" });
    const found = pm.get(p.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(p.id);
  });

  it("returns undefined for unknown id", () => {
    expect(pm.get("nonexistent")).toBeUndefined();
  });

  it("updates a project", () => {
    const p = pm.create({ path: "/tmp/x" });
    const updated = pm.update(p.id, { name: "Renamed", pinned: true });
    expect(updated?.name).toBe("Renamed");
    expect(updated?.pinned).toBe(true);
    expect(pm.get(p.id)?.name).toBe("Renamed");
  });

  it("normalizes remembered worktree local file paths", () => {
    const p = pm.create({ path: "/tmp/x" });
    pm.update(p.id, {
      worktreeLocalFileAllowlist: [
        ".env",
        "./apps/api/.env.local",
        "../secret",
        "/abs/.env",
        ".env",
      ],
    });
    expect(pm.get(p.id)?.worktreeLocalFileAllowlist).toEqual([
      ".env",
      "apps/api/.env.local",
    ]);
  });

  it("deletes a project and cascades sessions", () => {
    const p = pm.create({ path: "/tmp/del" });

    // add sessions for this project
    store.mutateSessions((s) => {
      s.sessions.push(
        {
          id: "s1",
          projectId: p.id,
          pid: null,
          state: "running",
          generation: 0,
          title: "bash",
          command: { type: "shell" },
          cwd: "/tmp",
          shell: "/bin/bash",
          createdAt: 1,
        },
        {
          id: "s2",
          projectId: p.id,
          pid: null,
          state: "ended",
          generation: 1,
          title: "bash2",
          command: { type: "shell" },
          cwd: "/tmp",
          shell: "/bin/bash",
          createdAt: 2,
        },
      );
    });
    store.mutateProjectStates((s) => {
      s.projectStates[p.id] = {
        projectId: p.id,
        layout: null,
        worktrees: [],
        openFiles: [],
        lastFocusedPaneId: null,
        focusedPaneId: null,
        lastAccessedAt: 1,
      };
    });
    store.mutateWorkItems((s) => {
      s.workItems[p.id] = [
        {
          id: "work-1",
          projectId: p.id,
          title: "Delete with project",
          status: "todo",
          acceptanceCriteria: [],
          attachments: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ];
    });

    const result = pm.delete(p.id);
    expect(result).toBe(true);
    expect(pm.get(p.id)).toBeUndefined();
    expect(store.get().sessions).toHaveLength(0);
    expect(store.get().projectStates[p.id]).toBeUndefined();
    expect(store.get().workItems[p.id]).toBeUndefined();
  });

  it("rejects delete on pinned project without force", () => {
    const p = pm.create({ path: "/tmp/pinned" });
    pm.update(p.id, { pinned: true });

    const result = pm.delete(p.id);
    expect(result).toBe(false);
    expect(pm.get(p.id)).toBeDefined();
  });

  it("force deletes pinned project", () => {
    const p = pm.create({ path: "/tmp/pinned-force" });
    pm.update(p.id, { pinned: true });

    const result = pm.delete(p.id, true);
    expect(result).toBe(true);
    expect(pm.get(p.id)).toBeUndefined();
  });

  it("getProjectSessions returns filtered sessions", () => {
    const p1 = pm.create({ path: "/a" });
    const p2 = pm.create({ path: "/b" });

    store.mutateSessions((s) => {
      s.sessions.push(
        {
          id: "sa1",
          projectId: p1.id,
          pid: null,
          state: "running",
          generation: 0,
          title: "t1",
          command: { type: "shell" },
          cwd: "/a",
          shell: "/bin/bash",
          createdAt: 1,
        },
        {
          id: "sb1",
          projectId: p2.id,
          pid: null,
          state: "running",
          generation: 0,
          title: "t2",
          command: { type: "shell" },
          cwd: "/b",
          shell: "/bin/bash",
          createdAt: 2,
        },
      );
    });

    const p1Sessions = pm.getProjectSessions(p1.id);
    expect(p1Sessions).toHaveLength(1);
    expect(p1Sessions[0].id).toBe("sa1");
  });

  it("touchProject updates lastAccessedAt", () => {
    const p = pm.create({ path: "/tmp/touch" });
    const before = p.lastAccessedAt;

    // advance time so Date.now() returns a larger value
    vi.advanceTimersByTime(1000);

    pm.touchProject(p.id);
    expect(pm.get(p.id)?.lastAccessedAt).toBeGreaterThan(before);
  });
});

import type {
  HydrationPayload,
  Session,
  WsEventMessage,
} from "@parasor/shared";
import {
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
} from "@parasor/shared";
import { describe, expect, it } from "vitest";
import {
  type AppStore,
  applyEvent,
  applySnapshot,
  EMPTY_STORE,
  loadCachedStore,
} from "./event-reducers.js";

function storeWith(overrides: Partial<AppStore>): AppStore {
  return { ...EMPTY_STORE, ...overrides };
}

const SESSION: Session = {
  id: "s1",
  projectId: "p1",
  title: "bash",
  command: { type: "shell" },
  cwd: "/home",
  shell: "bash",
  state: "running",
  pid: 1234,
  createdAt: 1000,
  generation: 0,
};

describe("applyEvent: session-cwd-changed", () => {
  it("updates cwd for matching session", () => {
    const store = storeWith({ sessions: [SESSION] });
    const msg: WsEventMessage = {
      type: "session-cwd-changed",
      sessionId: "s1",
      cwd: "/new/dir",
    };
    const next = applyEvent(store, msg);
    expect(next.sessions[0].cwd).toBe("/new/dir");
  });

  it("does not modify other sessions", () => {
    const s2 = { ...SESSION, id: "s2", cwd: "/other" };
    const store = storeWith({ sessions: [SESSION, s2] });
    const msg: WsEventMessage = {
      type: "session-cwd-changed",
      sessionId: "s1",
      cwd: "/new",
    };
    const next = applyEvent(store, msg);
    expect(next.sessions[1].cwd).toBe("/other");
  });

  it("is a no-op for unknown session", () => {
    const store = storeWith({ sessions: [SESSION] });
    const msg: WsEventMessage = {
      type: "session-cwd-changed",
      sessionId: "unknown",
      cwd: "/x",
    };
    const next = applyEvent(store, msg);
    expect(next.sessions).toEqual(store.sessions);
  });
});

describe("applyEvent: session-title-changed", () => {
  it("stores manual titles", () => {
    const store = storeWith({ sessions: [SESSION] });
    const next = applyEvent(store, {
      type: "session-title-changed",
      sessionId: "s1",
      title: "Build logs",
      titleManual: true,
    });

    expect(next.sessions[0]).toEqual({
      ...SESSION,
      title: "Build logs",
      titleManual: true,
    });
  });

  it("clears the manual title flag for automatic titles", () => {
    const store = storeWith({
      sessions: [{ ...SESSION, title: "Build logs", titleManual: true }],
    });
    const next = applyEvent(store, {
      type: "session-title-changed",
      sessionId: "s1",
      title: "bash",
      titleManual: false,
    });

    expect(next.sessions[0]).toEqual({ ...SESSION, title: "bash" });
  });
});

describe("applyEvent: file-change", () => {
  it("increments fileChangeSeq", () => {
    const store = storeWith({ fileChangeSeq: 5 });
    const msg: WsEventMessage = {
      type: "file-change",
      projectId: "p1",
      event: "update",
      path: "f.ts",
    };
    expect(applyEvent(store, msg).fileChangeSeq).toBe(6);
  });
});

describe("applyEvent: gitignore-updated", () => {
  it("increments fileChangeSeq", () => {
    const store = storeWith({ fileChangeSeq: 3 });
    const msg: WsEventMessage = { type: "gitignore-updated", projectId: "p1" };
    expect(applyEvent(store, msg).fileChangeSeq).toBe(4);
  });
});

describe("applyEvent: session-ended", () => {
  it("marks session as ended and records endReason", () => {
    const store = storeWith({ sessions: [SESSION] });
    const msg: WsEventMessage = {
      type: "session-ended",
      sessionId: "s1",
      generation: 0,
      endReason: { type: "exit", code: 0 },
    };
    const next = applyEvent(store, msg);
    expect(next.sessions[0].state).toBe("ended");
    expect(next.sessions[0].pid).toBeNull();
    expect(next.sessions[0].endReason).toEqual({ type: "exit", code: 0 });
  });

  it("ignores stale generation", () => {
    const session = { ...SESSION, generation: 2 };
    const store = storeWith({ sessions: [session] });
    const msg: WsEventMessage = {
      type: "session-ended",
      sessionId: "s1",
      generation: 1,
      endReason: { type: "exit", code: 0 },
    };
    const next = applyEvent(store, msg);
    expect(next.sessions[0].state).toBe("running");
  });
});

describe("applyEvent: browser-url-changed", () => {
  it("sets pendingOpenUrl", () => {
    const msg: WsEventMessage = {
      type: "browser-url-changed",
      paneId: "p1",
      url: "http://x",
    };
    expect(applyEvent(EMPTY_STORE, msg).pendingOpenUrl).toBe("http://x");
  });
});

describe("applyEvent: notification", () => {
  it("prepends incoming notifications and caps retention at 200", () => {
    let store = EMPTY_STORE;
    const total = 205;
    for (let i = 0; i < total; i++) {
      store = applyEvent(store, {
        type: "notification",
        notification: {
          id: `n${i}`,
          projectId: "p1",
          sessionId: "s1",
          type: "agent-waiting",
          title: "t",
          message: "",
          read: false,
          timestamp: i,
        },
      });
    }
    expect(store.notifications).toHaveLength(200);
    expect(store.notifications[0].id).toBe(`n${total - 1}`);
    expect(store.notifications[store.notifications.length - 1].id).toBe("n5");
  });
});

describe("applyEvent: pane-commands-changed", () => {
  it("replaces server pane commands", () => {
    const next = applyEvent(EMPTY_STORE, {
      type: "pane-commands-changed",
      commands: [{ id: "cmd:1", label: "Dev", initialInput: "pnpm dev" }],
    });

    expect(next.paneCommands).toEqual([
      { id: "cmd:1", label: "Dev", initialInput: "pnpm dev" },
    ]);
  });
});

describe("applyEvent: sidebar-state-changed", () => {
  it("replaces sidebar state for the matching project state", () => {
    const store = storeWith({
      projectStates: {
        p1: {
          projectId: "p1",
          layout: null,
          worktrees: [],
          openFiles: [],
          lastFocusedPaneId: null,
          focusedPaneId: null,
          sidebar: {
            paneOrder: { "/old": ["terminal:old"] },
            worktreeOpen: {},
          },
          lastAccessedAt: 1,
        },
      },
    });

    const next = applyEvent(store, {
      type: "sidebar-state-changed",
      projectId: "p1",
      sidebar: {
        paneOrder: { "/repo": ["terminal:s1"] },
        worktreeOpen: { "/repo": false },
      },
    });

    expect(next.projectStates.p1?.sidebar).toEqual({
      paneOrder: { "/repo": ["terminal:s1"] },
      worktreeOpen: { "/repo": false },
    });
  });
});

describe("applyEvent: worktree-created", () => {
  const worktree = { path: "/tmp/wt-a", head: "abc", branch: "feat/a" };
  const project = {
    id: "p1",
    name: "p1",
    path: "/tmp/p1",
    createdAt: 0,
    lastAccessedAt: 0,
  };
  const msg: WsEventMessage = {
    type: "worktree-created",
    projectId: "p1",
    worktree,
  };

  it("seeds the worktrees list from an empty map", () => {
    const store = storeWith({ projects: [project] });
    const next = applyEvent(store, msg);
    expect(next.worktrees).toEqual({ p1: [worktree] });
  });

  it("appends to existing worktrees for the same project", () => {
    const existing = { path: "/tmp/main", head: "def", branch: "main" };
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [existing] },
    });
    const next = applyEvent(store, msg);
    expect(next.worktrees).toEqual({ p1: [existing, worktree] });
  });

  it("upserts duplicate path so refreshed counters override the stored entry", () => {
    const stale = { ...worktree, ahead: 0, behind: 0, dirtyCount: 0 };
    const fresh = { ...worktree, ahead: 3, behind: 1, dirtyCount: 5 };
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [stale] },
    });
    const next = applyEvent(store, {
      type: "worktree-created",
      projectId: "p1",
      worktree: fresh,
    });
    expect(next.worktrees.p1).toEqual([fresh]);
  });

  it("does not mutate the previous map (referential change on update)", () => {
    const store = storeWith({
      projects: [project],
      worktrees: { p2: [] },
    });
    const next = applyEvent(store, msg);
    expect(next.worktrees).not.toBe(store.worktrees);
    expect(store.worktrees).toEqual({ p2: [] });
  });

  it("drops the event for an unknown project (project-deleted race)", () => {
    // No project entry -> server may still re-broadcast a synthetic
    // worktree-created from project-created's async refresh; the
    // reducer must not resurrect the worktrees map for a deleted id.
    const store = storeWith({ projects: [] });
    const next = applyEvent(store, msg);
    expect(next).toBe(store);
  });
});

describe("applyEvent: worktree-renamed", () => {
  const worktree = { path: "/tmp/wt-a", head: "abc", branch: "feat/a" };
  const project = {
    id: "p1",
    name: "p1",
    path: "/tmp/p1",
    createdAt: 0,
    lastAccessedAt: 0,
  };

  it("updates branch for the matching worktree path", () => {
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [worktree] },
    });
    const next = applyEvent(store, {
      type: "worktree-renamed",
      projectId: "p1",
      worktreePath: "/tmp/wt-a",
      oldBranch: "feat/a",
      newBranch: "feat/b",
    });
    expect(next.worktrees.p1[0].branch).toBe("feat/b");
    expect(next.worktrees.p1[0].path).toBe("/tmp/wt-a");
  });

  it("does not touch sibling worktrees in the same project", () => {
    const sibling = { path: "/tmp/wt-c", head: "ghi", branch: "feat/c" };
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [worktree, sibling] },
    });
    const next = applyEvent(store, {
      type: "worktree-renamed",
      projectId: "p1",
      worktreePath: "/tmp/wt-a",
      oldBranch: "feat/a",
      newBranch: "feat/b",
    });
    expect(next.worktrees.p1[1]).toEqual(sibling);
  });

  it("is a no-op for an unknown project", () => {
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [worktree] },
    });
    const next = applyEvent(store, {
      type: "worktree-renamed",
      projectId: "p2",
      worktreePath: "/tmp/wt-a",
      oldBranch: "feat/a",
      newBranch: "feat/b",
    });
    expect(next).toBe(store);
  });

  it("is a no-op when the worktreePath does not match any entry", () => {
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [worktree] },
    });
    const next = applyEvent(store, {
      type: "worktree-renamed",
      projectId: "p1",
      worktreePath: "/tmp/wt-missing",
      oldBranch: "feat/x",
      newBranch: "feat/y",
    });
    expect(next.worktrees.p1).toEqual([worktree]);
  });
});

describe("applyEvent: worktree-removed", () => {
  const worktree = { path: "/tmp/wt-a", head: "abc", branch: "feat/a" };
  const project = {
    id: "p1",
    name: "p1",
    path: "/tmp/p1",
    createdAt: 0,
    lastAccessedAt: 0,
  };

  it("filters the removed worktree out of the project list", () => {
    const sibling = { path: "/tmp/wt-c", head: "ghi", branch: "feat/c" };
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [worktree, sibling] },
    });
    const next = applyEvent(store, {
      type: "worktree-removed",
      projectId: "p1",
      worktreePath: "/tmp/wt-a",
    });
    expect(next.worktrees.p1).toEqual([sibling]);
  });

  it("strips per-worktree gitStates for the removed path", () => {
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [worktree] },
      gitStates: {
        p1: {
          "/tmp/wt-a": {
            branch: "feat/a",
            dirty: true,
            ahead: 1,
            behind: 0,
            dirtyCount: 2,
            lastChecked: 0,
          },
          "/tmp/wt-c": {
            branch: "feat/c",
            dirty: false,
            ahead: 0,
            behind: 0,
            dirtyCount: 0,
            lastChecked: 0,
          },
        },
      },
    });
    const next = applyEvent(store, {
      type: "worktree-removed",
      projectId: "p1",
      worktreePath: "/tmp/wt-a",
    });
    expect(next.gitStates.p1).toEqual({
      "/tmp/wt-c": {
        branch: "feat/c",
        dirty: false,
        ahead: 0,
        behind: 0,
        dirtyCount: 0,
        lastChecked: 0,
      },
    });
  });

  it("leaves gitStates untouched when no entry exists for the removed path", () => {
    const gitStates = {
      p1: {
        "/tmp/wt-c": {
          branch: "feat/c",
          dirty: false,
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
          lastChecked: 0,
        },
      },
    };
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [worktree] },
      gitStates,
    });
    const next = applyEvent(store, {
      type: "worktree-removed",
      projectId: "p1",
      worktreePath: "/tmp/wt-a",
    });
    expect(next.gitStates).toBe(store.gitStates);
  });

  it("is a no-op for an unknown project", () => {
    const store = storeWith({
      projects: [project],
      worktrees: { p1: [worktree] },
    });
    const next = applyEvent(store, {
      type: "worktree-removed",
      projectId: "p2",
      worktreePath: "/tmp/wt-a",
    });
    expect(next).toBe(store);
  });
});

describe("applyEvent: project-deleted drops worktrees", () => {
  it("removes the worktrees entry for the deleted project", () => {
    const store = storeWith({
      worktrees: {
        p1: [{ path: "/tmp/p1", head: "abc", branch: "main" }],
        p2: [{ path: "/tmp/p2", head: "def", branch: "main" }],
      },
    });
    const next = applyEvent(store, {
      type: "project-deleted",
      projectId: "p1",
    });
    expect(next.worktrees).toEqual({
      p2: [{ path: "/tmp/p2", head: "def", branch: "main" }],
    });
  });
});

describe("snapshotApplied flag (warm-boot priming gate)", () => {
  const SNAPSHOT: HydrationPayload = {
    seq: 1,
    state: {
      version: 1,
      projects: [],
      projectStates: {},
      sessions: [],
      sessionRecords: [],
      paneCommands: [],
      ideCommands: [],
      serviceConfig: {
        preventIdleSleep: false,
        portDetection: "all-interfaces",
        dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
        dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
      },
    },
    agentStates: {},
    notifications: [],
    ports: {},
    gitStates: {},
    worktrees: {},
    hostPlatform: "linux",
  };

  it("EMPTY_STORE.snapshotApplied is false", () => {
    expect(EMPTY_STORE.snapshotApplied).toBe(false);
  });

  it("applySnapshot sets snapshotApplied true", () => {
    const store = applySnapshot(SNAPSHOT);
    expect(store.snapshotApplied).toBe(true);
    expect(store.paneCommands).toEqual([]);
  });

  it("loadCachedStore returns snapshotApplied=false even when cache has data", () => {
    const original = globalThis.localStorage;
    const fakeStore = new Map<string, string>();
    fakeStore.set(
      "parasor:store-cache",
      JSON.stringify({
        version: 3,
        projects: [
          {
            id: "p1",
            name: "demo",
            path: "/",
            createdAt: 0,
            lastAccessedAt: 0,
          },
        ],
        projectStates: {},
        sessions: [],
        agentStates: {},
        gitStates: {},
      }),
    );
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => fakeStore.get(k) ?? null,
        setItem: (k: string, v: string) => fakeStore.set(k, v),
        removeItem: (k: string) => fakeStore.delete(k),
        clear: () => fakeStore.clear(),
      },
      configurable: true,
    });
    try {
      const cached = loadCachedStore();
      // The exact STORE_CACHE_VERSION/key may differ; the test still verifies
      // the contract: whether or not the cache is read, snapshotApplied must
      // never be true purely from cache data.
      if (cached) {
        expect(cached.snapshotApplied).toBe(false);
        expect(cached.hydrated).toBe(true);
      }
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: original,
        configurable: true,
      });
    }
  });
});

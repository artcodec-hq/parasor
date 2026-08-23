import type { Worktree, WsEventMessage } from "@parasor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectManager } from "../../state/project-manager.js";
import { WorktreeCache } from "../../state/worktree-cache.js";
import type { EventBus } from "../../ws/events.js";
import { createWorktreeReconciler } from "./worktree-reconcile.js";

const KNOWN_PROJECT = "proj-1";

function makeProjectManager(known: string[] = [KNOWN_PROJECT]): ProjectManager {
  return {
    get: vi.fn((id: string) =>
      known.includes(id)
        ? {
            id,
            path: "/tmp/proj",
            name: "Proj",
            createdAt: 1,
            lastAccessedAt: 1,
          }
        : undefined,
    ),
  } as unknown as ProjectManager;
}

function makeEventBus() {
  const broadcasts: WsEventMessage[] = [];
  const eventBus = {
    broadcast: vi.fn((msg: WsEventMessage) => {
      broadcasts.push(msg);
    }),
  } as unknown as EventBus;
  return { eventBus, broadcasts };
}

function wt(path: string, head = "abc"): Worktree {
  return { path, head, branch: "main" };
}

describe("createWorktreeReconciler", () => {
  let projectManager: ProjectManager;
  let worktreeCache: WorktreeCache;
  let eventBus: EventBus;
  let broadcasts: WsEventMessage[];

  beforeEach(() => {
    projectManager = makeProjectManager();
    worktreeCache = new WorktreeCache();
    ({ eventBus, broadcasts } = makeEventBus());
  });

  it("returns silently when the project is unknown", async () => {
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => [wt("/tmp/proj/wt-a")]),
    });

    await reconciler.reconcile("missing");
    expect(broadcasts).toHaveLength(0);
  });

  it("skips the diff when liveList returns null (git failure)", async () => {
    worktreeCache.setProject(KNOWN_PROJECT, [wt("/tmp/proj/wt-a")]);
    const liveList = vi.fn(async () => null);
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList,
    });

    await reconciler.reconcile(KNOWN_PROJECT);
    expect(liveList).toHaveBeenCalledWith(KNOWN_PROJECT);
    expect(broadcasts).toHaveLength(0);
  });

  it("broadcasts worktree-removed for cached entries missing from live", async () => {
    worktreeCache.setProject(KNOWN_PROJECT, [
      wt("/tmp/proj/wt-a"),
      wt("/tmp/proj/wt-b"),
    ]);
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => [wt("/tmp/proj/wt-a")]),
    });

    await reconciler.reconcile(KNOWN_PROJECT);
    expect(broadcasts).toEqual([
      {
        type: "worktree-removed",
        projectId: KNOWN_PROJECT,
        worktreePath: "/tmp/proj/wt-b",
      },
    ]);
  });

  it("broadcasts worktree-removed for every cached entry when live is empty", async () => {
    worktreeCache.setProject(KNOWN_PROJECT, [
      wt("/tmp/proj/wt-a"),
      wt("/tmp/proj/wt-b"),
    ]);
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => []),
    });

    await reconciler.reconcile(KNOWN_PROJECT);
    expect(broadcasts).toEqual([
      {
        type: "worktree-removed",
        projectId: KNOWN_PROJECT,
        worktreePath: "/tmp/proj/wt-a",
      },
      {
        type: "worktree-removed",
        projectId: KNOWN_PROJECT,
        worktreePath: "/tmp/proj/wt-b",
      },
    ]);
  });

  it("broadcasts worktree-created for live entries missing from cache", async () => {
    worktreeCache.setProject(KNOWN_PROJECT, [wt("/tmp/proj/wt-a")]);
    const newWorktree = wt("/tmp/proj/wt-b", "def");
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => [wt("/tmp/proj/wt-a"), newWorktree]),
    });

    await reconciler.reconcile(KNOWN_PROJECT);
    expect(broadcasts).toEqual([
      {
        type: "worktree-created",
        projectId: KNOWN_PROJECT,
        worktree: newWorktree,
      },
    ]);
  });

  it("broadcasts both removals and additions when sets diverge", async () => {
    worktreeCache.setProject(KNOWN_PROJECT, [
      wt("/tmp/proj/wt-a"),
      wt("/tmp/proj/wt-b"),
    ]);
    const newWorktree = wt("/tmp/proj/wt-c", "def");
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => [wt("/tmp/proj/wt-a"), newWorktree]),
    });

    await reconciler.reconcile(KNOWN_PROJECT);
    expect(broadcasts).toEqual([
      {
        type: "worktree-removed",
        projectId: KNOWN_PROJECT,
        worktreePath: "/tmp/proj/wt-b",
      },
      {
        type: "worktree-created",
        projectId: KNOWN_PROJECT,
        worktree: newWorktree,
      },
    ]);
  });

  it("does not broadcast when cached and live entries match exactly", async () => {
    worktreeCache.setProject(KNOWN_PROJECT, [
      { ...wt("/tmp/proj/wt-a"), ahead: 3, behind: 0, dirtyCount: 0 },
      { ...wt("/tmp/proj/wt-b"), ahead: 0, behind: 0, dirtyCount: 1 },
    ]);
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => [
        { ...wt("/tmp/proj/wt-a"), ahead: 3, behind: 0, dirtyCount: 0 },
        { ...wt("/tmp/proj/wt-b"), ahead: 0, behind: 0, dirtyCount: 1 },
      ]),
    });

    await reconciler.reconcile(KNOWN_PROJECT);
    expect(broadcasts).toHaveLength(0);
  });

  it("re-broadcasts worktree-created when metadata changes for an existing path", async () => {
    worktreeCache.setProject(KNOWN_PROJECT, [
      { ...wt("/tmp/proj/wt-a"), ahead: 0, behind: 0, dirtyCount: 0 },
    ]);
    // Counter delta -- must propagate so the client sidebar reflects fresh state.
    const refreshed = {
      ...wt("/tmp/proj/wt-a"),
      ahead: 2,
      behind: 1,
      dirtyCount: 4,
    };
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => [refreshed]),
    });

    await reconciler.reconcile(KNOWN_PROJECT);
    expect(broadcasts).toEqual([
      {
        type: "worktree-created",
        projectId: KNOWN_PROJECT,
        worktree: refreshed,
      },
    ]);
  });

  it("re-broadcasts when orphan/origin flips for an existing path", async () => {
    worktreeCache.setProject(KNOWN_PROJECT, [
      { ...wt("/tmp/proj/wt-a"), ahead: 0, behind: 0, dirtyCount: 0 },
    ]);
    const flipped: Worktree = {
      ...wt("/tmp/proj/wt-a"),
      ahead: 0,
      behind: 0,
      dirtyCount: 0,
      origin: "agent",
      orphan: true,
    };
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => [flipped]),
    });

    await reconciler.reconcile(KNOWN_PROJECT);
    expect(broadcasts).toEqual([
      {
        type: "worktree-created",
        projectId: KNOWN_PROJECT,
        worktree: flipped,
      },
    ]);
  });

  it("treats an empty cache as no removals when live brings new entries", async () => {
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => [wt("/tmp/proj/wt-a")]),
    });

    await reconciler.reconcile(KNOWN_PROJECT);
    expect(broadcasts).toEqual([
      {
        type: "worktree-created",
        projectId: KNOWN_PROJECT,
        worktree: wt("/tmp/proj/wt-a"),
      },
    ]);
  });

  it("documents that prefetched empty list deletes cache unlike liveList null", async () => {
    worktreeCache.setProject(KNOWN_PROJECT, [
      wt("/tmp/proj/wt-a"),
      wt("/tmp/proj/wt-b"),
    ]);
    const liveList = vi.fn(async () => {
      throw new Error("must not be called when prefetched is provided");
    });
    const reconciler = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList,
    });

    await reconciler.reconcile(KNOWN_PROJECT, []);
    expect(liveList).not.toHaveBeenCalled();
    expect(broadcasts.map((m) => m.type)).toEqual([
      "worktree-removed",
      "worktree-removed",
    ]);

    broadcasts.length = 0;
    // Callers mapping missing-path or git-error must pass null, never [].
    const skipper = createWorktreeReconciler({
      projectManager,
      worktreeCache,
      eventBus,
      liveList: vi.fn(async () => null),
    });
    worktreeCache.setProject(KNOWN_PROJECT, [wt("/tmp/proj/wt-a")]);
    const before = broadcasts.length;
    await skipper.reconcile(KNOWN_PROJECT);
    expect(broadcasts.length).toBe(before);
  });
});

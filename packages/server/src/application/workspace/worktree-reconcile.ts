import type { Worktree } from "@parasor/shared";
import type { ProjectManager } from "../../state/project-manager.js";
import type { WorktreeCache } from "../../state/worktree-cache.js";
import type { EventPublisher } from "../ports.js";

export interface CreateWorktreeReconcilerDeps {
  projectManager: ProjectManager;
  worktreeCache: WorktreeCache;
  eventBus: EventPublisher;
  // null = git enumeration failed (skip diff); empty array = legitimate "no worktrees" signal.
  liveList: (projectId: string) => Promise<Worktree[] | null>;
}

export interface WorktreeReconciler {
  /**
   * Broadcasts cache-vs-live deltas; cache mutation happens in the broadcast
   * wrapper. Pass `prefetched` when the caller has already enumerated worktrees
   * in the same request -- this avoids a second `git worktree list` + N-way
   * `git status` fan-out per call.
   */
  reconcile(projectId: string, prefetched?: Worktree[]): Promise<void>;
}

/**
 * Fields whose change for an already-known path should re-broadcast a
 * `worktree-created` so the client overlays fresh metadata. The reducer
 * upserts by path with `{ ...prev, ...incoming }`, so re-emitting an
 * existing entry is the canonical "update" channel.
 */
function metaDiffers(a: Worktree, b: Worktree): boolean {
  return (
    a.head !== b.head ||
    a.branch !== b.branch ||
    a.ahead !== b.ahead ||
    a.behind !== b.behind ||
    a.dirtyCount !== b.dirtyCount ||
    a.origin !== b.origin ||
    Boolean(a.orphan) !== Boolean(b.orphan)
  );
}

export function createWorktreeReconciler({
  projectManager,
  worktreeCache,
  eventBus,
  liveList,
}: CreateWorktreeReconcilerDeps): WorktreeReconciler {
  return {
    async reconcile(projectId: string, prefetched?: Worktree[]) {
      if (!projectManager.get(projectId)) return;
      const live = prefetched ?? (await liveList(projectId));
      if (live === null) return;

      const cached = worktreeCache.get()[projectId] ?? [];
      const livePaths = new Set(live.map((w) => w.path));
      const cachedByPath = new Map(cached.map((w) => [w.path, w]));

      for (const w of cached) {
        if (livePaths.has(w.path)) continue;
        eventBus.broadcast({
          type: "worktree-removed",
          projectId,
          worktreePath: w.path,
        });
      }

      for (const w of live) {
        const prev = cachedByPath.get(w.path);
        if (prev && !metaDiffers(prev, w)) continue;
        eventBus.broadcast({
          type: "worktree-created",
          projectId,
          worktree: w,
        });
      }
    },
  };
}

import type { Worktree } from "@parasor/shared";

/**
 * In-memory cache of per-project worktrees, kept in sync by the
 * runtime broadcast wrapper. Used to keep `EventBus.addClient` fully
 * synchronous so the snapshot/seq capture stays atomic with the
 * broadcast stream.
 */
export class WorktreeCache {
  private cache: Record<string, Worktree[]> = {};

  get(): Record<string, Worktree[]> {
    return this.cache;
  }

  setAll(initial: Record<string, Worktree[]>): void {
    this.cache = { ...initial };
  }

  setProject(projectId: string, worktrees: Worktree[]): void {
    this.cache = { ...this.cache, [projectId]: worktrees };
  }

  removeProject(projectId: string): void {
    if (!(projectId in this.cache)) return;
    const { [projectId]: _drop, ...rest } = this.cache;
    this.cache = rest;
  }

  /**
   * Idempotent upsert by `path`. A snapshot+broadcast race (cache primed
   * AFTER worktree-created fires) must not double-count, but a re-broadcast
   * carrying refreshed counters (ahead/behind/dirtyCount) MUST update the
   * cached entry -- otherwise a worktree-created emitted before counter
   * enrichment finishes leaves the entry stuck at 0 forever (no other
   * code path updates this cache).
   */
  appendWorktree(projectId: string, worktree: Worktree): void {
    const list = this.cache[projectId] ?? [];
    const idx = list.findIndex((w) => w.path === worktree.path);
    if (idx === -1) {
      this.cache = { ...this.cache, [projectId]: [...list, worktree] };
      return;
    }
    const next = [...list];
    next[idx] = { ...list[idx], ...worktree };
    this.cache = { ...this.cache, [projectId]: next };
  }

  removeWorktree(projectId: string, worktreePath: string): void {
    const list = this.cache[projectId];
    if (!list) return;
    const next = list.filter((w) => w.path !== worktreePath);
    if (next.length === list.length) return;
    this.cache = { ...this.cache, [projectId]: next };
  }
}

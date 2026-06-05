import {
  type PaneOrderStore,
  parsePaneOrderStore,
} from "./pane-order-store.js";

/**
 * Compute the pruned `paneOrder:<projectId>` payload for a reorder write.
 *
 * The stored shape (`{[worktreePath]: childId[]}`) accumulates entries for
 * every worktree the user has ever reordered, so this prune step is what
 * stops it from growing unbounded across a project's lifetime: any path
 * not in `validPaths` (i.e. no longer present on the server) is dropped.
 *
 * The path *currently being written* is always retained even when the
 * caller's `validPaths` snapshot doesn't include it yet -- a reorder for a
 * freshly-created worktree can race the next `projects` broadcast and
 * would otherwise be lost.
 *
 * Pure: parses, prunes, returns the new map. Writing the JSON.stringify'd
 * result back to `localStorage` (and handling quota errors) stays at the
 * caller.
 */
export function prunePaneOrderForReorder(
  rawStored: string | null,
  validPaths: Iterable<string>,
  worktreePath: string,
  childIds: string[],
): PaneOrderStore {
  const existing = parsePaneOrderStore(rawStored);
  const allowed = new Set<string>(validPaths);
  allowed.add(worktreePath);
  const next: PaneOrderStore = {};
  for (const [path, ids] of Object.entries(existing)) {
    if (allowed.has(path)) next[path] = ids;
  }
  next[worktreePath] = childIds;
  return next;
}

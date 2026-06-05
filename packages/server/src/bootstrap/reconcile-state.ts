import type { PaneNode } from "@parasor/shared";
import type { AppStateStore } from "../state/app-state.js";

/**
 * Reconcile persisted state at server boot. Only safe to call from the
 * in-process branch (remote daemon mode pivots the session domain into
 * read-only mirror BEFORE the server-side reconcile would run; the
 * daemon owns its own boot-time reconciliation in that path).
 *
 * Split into per-domain mutator calls so the typed ownership boundary
 * in `AppStateStore` stays honest. Persistence is debounced under the
 * hood, so the writes coalesce into a single state.json flush via the
 * awaited `flush()` at the end.
 */
export async function reconcileStartupState(
  store: AppStateStore,
  now = Date.now(),
): Promise<void> {
  // Sessions: mark any "running" survivors as ended (their PIDs are gone),
  // and drop sessions whose project is gone (orphan filter).
  store.mutateSessions((state) => {
    const projectIds = new Set(state.projects.map((project) => project.id));
    for (const session of state.sessions) {
      if (session.state === "running") {
        session.state = "ended";
        session.pid = null;
        session.endedAt = now;
        session.generation += 1;
      }
    }
    state.sessions = state.sessions.filter((session) =>
      projectIds.has(session.projectId),
    );
  });

  // ProjectStates: drop entries whose project is gone and prune orphan
  // panes pointing at sessions that no longer exist.
  store.mutateProjectStates((state) => {
    const projectIds = new Set(state.projects.map((project) => project.id));
    for (const key of Object.keys(state.projectStates)) {
      if (!projectIds.has(key)) {
        delete state.projectStates[key];
      }
    }

    const validSessionIds = new Set(
      state.sessions.map((session) => session.id),
    );

    for (const projectState of Object.values(state.projectStates)) {
      if (projectState.layout) {
        projectState.layout = pruneOrphanPanes(
          projectState.layout,
          validSessionIds,
        );
      }
    }
  });

  await store.flush();
}

export function pruneOrphanPanes(
  node: PaneNode,
  validIds: Set<string>,
): PaneNode | null {
  if (node.type === "terminal") {
    return validIds.has(node.sessionId) ? node : null;
  }

  if (
    node.type === "browser" ||
    node.type === "filetree" ||
    node.type === "empty" ||
    node.type === "diff"
  ) {
    return node;
  }

  if (node.type === "split") {
    const children: PaneNode[] = [];
    const sizes: number[] = [];

    for (let i = 0; i < node.children.length; i++) {
      const child = pruneOrphanPanes(node.children[i], validIds);
      if (child !== null) {
        children.push(child);
        sizes.push(node.sizes[i]);
      }
    }

    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { ...node, children, sizes };
  }

  return null;
}

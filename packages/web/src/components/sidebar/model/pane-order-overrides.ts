import {
  normalizeProjectSidebarState,
  type ProjectState,
} from "@parasor/shared";
import type { SidebarProject } from "./types.js";

/**
 * Apply the server-owned per-project pane-ordering override on top of the
 * freshly built sidebar view-model.
 * Children listed in the stored order come first (in stored order); any
 * child not in the stored order is appended after, preserving the builder's
 * order. Projects/worktrees with no stored order pass through unchanged.
 */
export function applyPaneOrderOverrides(
  projects: SidebarProject[],
  projectStates: Record<string, ProjectState>,
): SidebarProject[] {
  return projects.map((project) => {
    const stored = normalizeProjectSidebarState(
      projectStates[project.id]?.sidebar,
    ).paneOrder;
    if (Object.keys(stored).length === 0) return project;
    const worktrees = project.worktrees.map((wt) => {
      const order = stored[wt.path];
      if (!order || order.length === 0) return wt;
      const byId = new Map(wt.children.map((c) => [c.id, c]));
      const reordered = [
        ...order
          .map((id) => byId.get(id))
          .filter((c): c is (typeof wt.children)[number] => Boolean(c)),
        ...wt.children.filter((c) => !order.includes(c.id)),
      ];
      return { ...wt, children: reordered };
    });
    return { ...project, worktrees };
  });
}

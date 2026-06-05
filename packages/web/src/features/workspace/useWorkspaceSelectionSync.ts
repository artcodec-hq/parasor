import type { Project } from "@parasor/shared";
import { useEffect } from "react";

interface UseWorkspaceSelectionSyncOptions {
  activeProjectId: string | null;
  connected: boolean;
  projects: Project[];
  setActiveProjectId: (projectId: string | null) => void;
}

/**
 * Keeps the active project id aligned with the current project set:
 *  - auto-select the first project when none is active
 *  - when the active project has been deleted server-side (we already
 *    have a live snapshot via `connected`), fall back to the first
 *    remaining project
 * Pane-id correction lives in `useWorkspacePaneModel` now -- it resolves
 * stale `focusedPaneId`s to the main-worktree files pane as part of the
 * derivation, so no separate effect is needed here.
 */
export function useWorkspaceSelectionSync({
  activeProjectId,
  connected,
  projects,
  setActiveProjectId,
}: UseWorkspaceSelectionSyncOptions) {
  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProjectId(projects[0].id);
    } else if (
      connected &&
      activeProjectId &&
      !projects.some((project) => project.id === activeProjectId)
    ) {
      const next = projects[0]?.id ?? null;
      setActiveProjectId(next);
    }
  }, [activeProjectId, connected, projects, setActiveProjectId]);
}

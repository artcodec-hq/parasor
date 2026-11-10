import type { Project, Session } from "@parasor/shared";
import { useEffect } from "react";
import type { WorkspaceRoute } from "../../lib/workspace-route.js";

interface UseWorkspaceSelectionSyncOptions {
  activeProjectId: string | null;
  connected: boolean;
  projects: Project[];
  setActiveProjectId: (projectId: string | null) => void;
  missingProjectIds?: Iterable<string>;
  route?: WorkspaceRoute;
  sessions?: Session[];
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
  missingProjectIds,
  route,
  sessions = [],
}: UseWorkspaceSelectionSyncOptions) {
  useEffect(() => {
    const missing = new Set(missingProjectIds ?? []);
    const firstPresent =
      projects.find((project) => !missing.has(project.id))?.id ?? null;
    const holdingMissingSession =
      activeProjectId != null &&
      missing.has(activeProjectId) &&
      route?.kind === "session" &&
      sessions.some(
        (session) =>
          session.id === route.sessionId &&
          session.projectId === activeProjectId,
      );

    if (!activeProjectId && projects.length > 0) {
      setActiveProjectId(firstPresent);
    } else if (
      connected &&
      activeProjectId &&
      !projects.some((project) => project.id === activeProjectId)
    ) {
      setActiveProjectId(firstPresent);
    } else if (
      connected &&
      activeProjectId &&
      missing.has(activeProjectId) &&
      !holdingMissingSession
    ) {
      setActiveProjectId(firstPresent);
    }
  }, [
    activeProjectId,
    connected,
    missingProjectIds,
    projects,
    route,
    sessions,
    setActiveProjectId,
  ]);
}

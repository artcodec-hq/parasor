import type { Session } from "@parasor/shared";
import { useCallback } from "react";
import type { WorkspaceRoute } from "../../lib/workspace-route.js";

interface UseProjectDeleteActionOptions {
  deleteProject: (id: string) => Promise<void>;
  navigate: (route: WorkspaceRoute, opts?: { replace?: boolean }) => void;
  route: WorkspaceRoute;
  sessions: Session[];
  setDeleteConfirm: (id: string | null) => void;
}

export function useProjectDeleteAction({
  deleteProject,
  navigate,
  route,
  sessions,
  setDeleteConfirm,
}: UseProjectDeleteActionOptions) {
  return useCallback(
    async (id: string) => {
      const deletingCurrentRoute =
        (route.kind === "pane" && route.projectId === id) ||
        (route.kind === "worktree" && route.projectId === id) ||
        (route.kind === "session" &&
          sessions.some(
            (session) =>
              session.id === route.sessionId && session.projectId === id,
          ));
      await deleteProject(id);
      if (deletingCurrentRoute) {
        navigate({ kind: "root" }, { replace: true });
      }
      setDeleteConfirm(null);
    },
    [deleteProject, navigate, route, sessions, setDeleteConfirm],
  );
}

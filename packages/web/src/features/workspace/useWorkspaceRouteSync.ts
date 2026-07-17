import type { Project, Session } from "@parasor/shared";
import { filesPaneId, gitPaneId, terminalPaneId } from "@parasor/shared";
import { useEffect } from "react";
import { requestPaneFocus } from "../../lib/pane-focus-registry.js";
import type { WorkspaceRoute } from "../../lib/workspace-route.js";

interface UseWorkspaceRouteSyncOptions {
  activeProjectId: string | null;
  focusedPaneId: string | null;
  hydrated: boolean;
  monitorActive: boolean;
  paneIds: Pick<ReadonlySet<string>, "has">;
  navigate: (route: WorkspaceRoute, opts?: { replace?: boolean }) => void;
  projects: Project[];
  route: WorkspaceRoute;
  sessions: Session[];
  setActiveProjectId: (projectId: string) => void;
  setFocusedPaneId: (paneId: string) => void;
  setMonitorActive: (active: boolean) => void;
}

export function useWorkspaceRouteSync({
  activeProjectId,
  focusedPaneId,
  hydrated,
  monitorActive,
  paneIds,
  navigate,
  projects,
  route,
  sessions,
  setActiveProjectId,
  setFocusedPaneId,
  setMonitorActive,
}: UseWorkspaceRouteSyncOptions) {
  useEffect(() => {
    if (route.kind === "root") {
      if (monitorActive) setMonitorActive(false);
      return;
    }

    if (route.kind === "monitor") {
      if (!monitorActive) setMonitorActive(true);
      return;
    }

    if (route.kind === "session") {
      const session = sessions.find((s) => s.id === route.sessionId);
      if (!session) return;
      const paneId = terminalPaneId(session.id);
      if (monitorActive) setMonitorActive(false);
      if (activeProjectId !== session.projectId) {
        setActiveProjectId(session.projectId);
      }
      if (focusedPaneId !== paneId) {
        setFocusedPaneId(paneId);
        requestPaneFocus(paneId);
      }
      return;
    }

    if (route.kind === "pane") {
      if (monitorActive) setMonitorActive(false);
      if (
        hydrated &&
        route.projectId &&
        !projects.some((project) => project.id === route.projectId)
      ) {
        navigate({ kind: "root" }, { replace: true });
        return;
      }
      if (
        hydrated &&
        route.projectId === activeProjectId &&
        !paneIds.has(route.paneId)
      ) {
        navigate({ kind: "root" }, { replace: true });
        return;
      }
      if (route.projectId && activeProjectId !== route.projectId) {
        setActiveProjectId(route.projectId);
      }
      if (focusedPaneId !== route.paneId) {
        setFocusedPaneId(route.paneId);
        requestPaneFocus(route.paneId);
      }
      return;
    }

    if (route.kind === "worktree") {
      if (
        hydrated &&
        !projects.some((project) => project.id === route.projectId)
      ) {
        if (monitorActive) setMonitorActive(false);
        navigate({ kind: "root" }, { replace: true });
        return;
      }
      const paneId =
        route.tab === "git"
          ? gitPaneId(route.worktreePath)
          : filesPaneId(route.worktreePath);
      if (monitorActive) setMonitorActive(false);
      if (activeProjectId !== route.projectId) {
        setActiveProjectId(route.projectId);
      }
      if (focusedPaneId !== paneId) {
        setFocusedPaneId(paneId);
        requestPaneFocus(paneId);
      }
    }
  }, [
    activeProjectId,
    focusedPaneId,
    hydrated,
    monitorActive,
    navigate,
    paneIds,
    projects,
    route,
    sessions,
    setActiveProjectId,
    setFocusedPaneId,
    setMonitorActive,
  ]);
}

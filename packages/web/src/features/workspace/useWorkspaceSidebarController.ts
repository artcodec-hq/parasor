import type {
  AgentState,
  GitState,
  PortInfo,
  Project,
  ProjectSidebarState,
  ProjectState,
  RuntimeServiceInfo,
  Session,
  Worktree,
} from "@parasor/shared";
import { filesPaneId } from "@parasor/shared";
import { useCallback, useMemo } from "react";
import type { SidebarProps } from "../../components/sidebar/index.js";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { requestPaneFocus } from "../../lib/pane-focus-registry.js";
import type { WorkspaceRoute } from "../../lib/workspace-route.js";
import type { AttentionDismissals } from "./useAttentionDismissals.js";
import { useNewSessionDialog } from "./useNewSessionDialog.js";
import { useSidebarSearch } from "./useSidebarSearch.js";
import type { WorkspacePaneModel } from "./useWorkspacePaneModel.js";
import { useWorkspaceSidebarModel } from "./useWorkspaceSidebarModel.js";

interface UseWorkspaceSidebarControllerOptions {
  activeProjectId: string | null;
  agentStates: Record<string, AgentState>;
  attentionDismissed: AttentionDismissals;
  connected: boolean;
  focusedPane: WorkspacePaneModel["focusedPane"];
  gitStates: Record<string, Record<string, GitState | null>>;
  hydrated: boolean;
  isMobile: boolean;
  monitorActive: boolean;
  navigate: (route: WorkspaceRoute, opts?: { replace?: boolean }) => void;
  onNewProject: () => void;
  onOpenSettings: () => void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => void;
  onToggleSessionPin: (sessionId: string) => void;
  paneModelWorktrees: WorkspacePaneModel["worktrees"];
  ports: Record<string, PortInfo[]>;
  projectStates: Record<string, ProjectState>;
  projects: Project[];
  reviewPendingSessions: Set<string>;
  seedSidebarState: (projectId: string, sidebar: ProjectSidebarState) => void;
  services: Record<string, RuntimeServiceInfo[]>;
  sessions: Session[];
  setActiveProjectId: (projectId: string) => void;
  setErrorToast: (message: string) => void;
  setFocusedPaneId: (paneId: string) => void;
  setMonitorActive: (active: boolean) => void;
  worktreesWithCounters: Record<string, Worktree[]>;
}

export function useWorkspaceSidebarController({
  activeProjectId,
  agentStates,
  attentionDismissed,
  connected,
  focusedPane,
  gitStates,
  hydrated,
  isMobile,
  monitorActive,
  navigate,
  onNewProject,
  onOpenSettings,
  onOpenUrl,
  onToggleSessionPin,
  paneModelWorktrees,
  ports,
  projectStates,
  projects,
  reviewPendingSessions,
  seedSidebarState,
  services,
  sessions,
  setActiveProjectId,
  setErrorToast,
  setFocusedPaneId,
  setMonitorActive,
  worktreesWithCounters,
}: UseWorkspaceSidebarControllerOptions) {
  const sidebarModel = useWorkspaceSidebarModel({
    activeProjectId,
    activeWorktrees: paneModelWorktrees,
    agentStates,
    attentionDismissed,
    gitStates,
    hydrated,
    projectStates,
    projects,
    reviewPendingSessions,
    seedSidebarState,
    services,
    sessions,
    setErrorToast,
    worktreesWithCounters,
  });

  const handleMobileSidebarSearchShortcut = useCallback(
    () => navigate({ kind: "root" }),
    [navigate],
  );
  const {
    open: searchOpen,
    query: searchQuery,
    setQuery: setSearchQuery,
    toggle: handleToggleSearch,
    close: handleCloseSearch,
  } = useSidebarSearch({
    isMobile,
    onMobileOpenShortcut: handleMobileSidebarSearchShortcut,
  });

  const handleSelectMonitor = useCallback(() => {
    setMonitorActive(true);
    handleCloseSearch();
    navigate({ kind: "monitor" });
  }, [handleCloseSearch, navigate, setMonitorActive]);

  const handleSelectWorktree = useCallback(
    (projectId: string, worktreeId: string) => {
      setMonitorActive(false);
      if (projectId !== activeProjectId) setActiveProjectId(projectId);
      const path = worktreeId.startsWith("wt:")
        ? worktreeId.slice(3)
        : worktreeId;
      const paneId = filesPaneId(path);
      setFocusedPaneId(paneId);
      requestPaneFocus(paneId);
      handleCloseSearch();
      navigate({
        kind: "worktree",
        projectId,
        worktreePath: path,
        tab: "files",
      });
    },
    [
      activeProjectId,
      handleCloseSearch,
      navigate,
      setActiveProjectId,
      setFocusedPaneId,
      setMonitorActive,
    ],
  );

  const handleSelectChild = useCallback(
    (projectId: string, _worktreeId: string, childId: string) => {
      setMonitorActive(false);
      if (projectId !== activeProjectId) {
        setActiveProjectId(projectId);
      }
      setFocusedPaneId(childId);
      requestPaneFocus(childId);
      handleCloseSearch();
      if (childId.startsWith("terminal:")) {
        navigate({
          kind: "session",
          sessionId: childId.slice("terminal:".length),
        });
      } else {
        navigate({ kind: "pane", paneId: childId, projectId });
      }
    },
    [
      activeProjectId,
      handleCloseSearch,
      navigate,
      setActiveProjectId,
      setFocusedPaneId,
      setMonitorActive,
    ],
  );

  const newSessionDialog = useNewSessionDialog({ projects, gitStates });
  const handleNewSession = useCallback(
    (projectId: string, worktreeId: string) => {
      newSessionDialog.open(projectId, worktreeId);
      if (isMobile) handleCloseSearch();
    },
    [handleCloseSearch, isMobile, newSessionDialog.open],
  );

  const handleToggleChildPin = useCallback(
    (childId: string) => {
      if (!childId.startsWith("terminal:")) return;
      onToggleSessionPin(childId.slice("terminal:".length));
    },
    [onToggleSessionPin],
  );

  const projectNames = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const pinnedMonitorCount = useMemo(
    () => sessions.filter((session) => session.pinned === true).length,
    [sessions],
  );

  const props = useMemo<SidebarProps>(
    () => ({
      connected,
      fill: true,
      onCloseSearch: handleCloseSearch,
      onNewProject,
      onNewSession: handleNewSession,
      onOpenSettings,
      onOpenUrl,
      onReorderPanes: sidebarModel.reorderPanes,
      onReorderProjects: sidebarModel.reorderProjects,
      onSearchQueryChange: setSearchQuery,
      onSelectChild: handleSelectChild,
      onSelectMonitor: handleSelectMonitor,
      onSelectWorktree: handleSelectWorktree,
      onToggleChildPin: handleToggleChildPin,
      onToggleSearch: handleToggleSearch,
      onWorktreeOpenChange: sidebarModel.setWorktreeOpen,
      pendingProjectReorderCount: sidebarModel.pendingProjectReorderCount,
      pinnedMonitorCount,
      portsByProjectId: ports,
      projectNames,
      projects: sidebarModel.sidebarProjects,
      reorderResetSignal: sidebarModel.reorderResetSignal,
      searchOpen,
      searchQuery,
      selection: {
        monitor: monitorActive,
        selectedChildId:
          !monitorActive &&
          (focusedPane?.state.kind === "terminal" ||
            focusedPane?.state.kind === "browser")
            ? focusedPane.id
            : null,
        selectedWorktreeId:
          !monitorActive && focusedPane
            ? `wt:${focusedPane.worktreePath}`
            : null,
      },
      servicesByProjectId: services,
      sessions,
      worktreeOpenByProject: sidebarModel.worktreeOpenByProject,
    }),
    [
      connected,
      focusedPane,
      handleCloseSearch,
      handleNewSession,
      handleSelectChild,
      handleSelectMonitor,
      handleSelectWorktree,
      handleToggleChildPin,
      handleToggleSearch,
      monitorActive,
      onNewProject,
      onOpenSettings,
      onOpenUrl,
      pinnedMonitorCount,
      ports,
      projectNames,
      searchOpen,
      searchQuery,
      services,
      sessions,
      setSearchQuery,
      sidebarModel,
    ],
  );

  return {
    newSessionDialog,
    props,
  };
}

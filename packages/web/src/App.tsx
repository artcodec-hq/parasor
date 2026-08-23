import type { Session } from "@parasor/shared";
import { terminalPaneId } from "@parasor/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/sidebar/index.js";
import { OfflineBanner } from "./components/toasts/OfflineBanner.js";
import { ServerNoticesBanner } from "./components/toasts/ServerNoticesBanner.js";
import { useSettings } from "./features/settings/index.js";
import { AppShellSplit } from "./features/workspace/AppShellSplit.js";
import { ProjectsProvider } from "./features/workspace/projects-context.js";
import { useActiveWorktreeRefresh } from "./features/workspace/useActiveWorktreeRefresh.js";
import { useAgentSounds } from "./features/workspace/useAgentSounds.js";
import { useAttentionDismissals } from "./features/workspace/useAttentionDismissals.js";
import { useClientBrowserPanes } from "./features/workspace/useClientBrowserPanes.js";
import {
  type ClosePaneTarget,
  useClosePaneDialog,
} from "./features/workspace/useClosePaneDialog.js";
import { useErrorToast } from "./features/workspace/useErrorToast.js";
import { useFocusedWorkspaceContext } from "./features/workspace/useFocusedWorkspaceContext.js";
import { useGitGraphSelectionForFocus } from "./features/workspace/useGitGraphSelectionForFocus.js";
import { useGitWorkflow } from "./features/workspace/useGitWorkflow.js";
import { useLocalIdeCapability } from "./features/workspace/useLocalIdeCapability.js";
import { useProjectDeleteAction } from "./features/workspace/useProjectDeleteAction.js";
import { useReviewPendingSessions } from "./features/workspace/useReviewPendingSessions.js";
import { useServiceConfigActions } from "./features/workspace/useServiceConfigActions.js";
import { useWorkItemPaneActions } from "./features/workspace/useWorkItemPaneActions.js";
import { useWorkspaceCommandConfig } from "./features/workspace/useWorkspaceCommandConfig.js";
import { useWorkspaceOpenUrl } from "./features/workspace/useWorkspaceOpenUrl.js";
import { useWorkspacePaneModel } from "./features/workspace/useWorkspacePaneModel.js";
import { useWorkspacePreferences } from "./features/workspace/useWorkspacePreferences.js";
import { useWorkspaceProjectActions } from "./features/workspace/useWorkspaceProjectActions.js";
import { useWorkspaceRoute } from "./features/workspace/useWorkspaceRoute.js";
import { useWorkspaceRouteSync } from "./features/workspace/useWorkspaceRouteSync.js";
import { useWorkspaceSelectionSync } from "./features/workspace/useWorkspaceSelectionSync.js";
import { useWorkspaceSessionActions } from "./features/workspace/useWorkspaceSessionActions.js";
import { useWorkspaceShell } from "./features/workspace/useWorkspaceShell.js";
import { useWorkspaceSidebarController } from "./features/workspace/useWorkspaceSidebarController.js";
import { useWorkspaceWorktreeActions } from "./features/workspace/useWorkspaceWorktreeActions.js";
import { useWorktreeWorkflow } from "./features/workspace/useWorktreeWorkflow.js";
import { WorkspaceMonitorSurface } from "./features/workspace/WorkspaceMonitorSurface.js";
import { WorkspaceOverlays } from "./features/workspace/WorkspaceOverlays.js";
import { WorkspacePaneSurface } from "./features/workspace/WorkspacePaneSurface.js";
import { WorkspaceSurface } from "./features/workspace/WorkspaceSurface.js";
import { loadWorktreeLocalFiles as loadWorktreeLocalFilesRequest } from "./features/workspace/worktree-api.js";
import { useEventSocket } from "./hooks/useEventSocket.js";
import { useGlobalDropGuard } from "./hooks/useGlobalDropGuard.js";
import { mergeOptimisticSessions } from "./lib/session-merge.js";
import {
  scheduleClientStartupDiagnosticCapture,
  traceTerminalEvent,
} from "./lib/terminal-trace.js";

export function App() {
  const appMountedAtRef = useRef(performance.now());
  const appRouteReadyTracedRef = useRef(false);
  useGlobalDropGuard();
  const { playAttentionSound, playCompletionSound } = useSettings();
  const {
    activeProjectId,
    focusedPaneId,
    setActiveProjectId,
    setFocusedPaneId,
  } = useWorkspacePreferences();
  const { navigate, route } = useWorkspaceRoute();
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [monitorActive, setMonitorActive] = useState(false);
  const [errorToast, setErrorToast] = useErrorToast();
  const [optimisticSessions, setOptimisticSessions] = useState<Session[]>([]);

  const store = useEventSocket();
  const reportedActiveProjectId = monitorActive ? null : activeProjectId;
  useEffect(() => {
    store.setActiveProject?.(reportedActiveProjectId);
  }, [reportedActiveProjectId, store.setActiveProject]);
  // Older test/cache fixtures predate Work Items; keep hydration tolerant.
  const workItemsByProject = store.workItems ?? {};
  const sessions = useMemo(
    () => mergeOptimisticSessions(store.sessions, optimisticSessions),
    [store.sessions, optimisticSessions],
  );

  useEffect(() => {
    if (optimisticSessions.length === 0) return;
    const hydratedIds = new Set(store.sessions.map((session) => session.id));
    setOptimisticSessions((current) => {
      const next = current.filter((session) => !hydratedIds.has(session.id));
      return next.length === current.length ? current : next;
    });
  }, [optimisticSessions.length, store.sessions]);

  const activeWorktrees = useMemo(
    () => (activeProjectId ? (store.worktrees[activeProjectId] ?? []) : []),
    [activeProjectId, store.worktrees],
  );

  // `worktree-created` only carries counters from the initial git enumeration.
  // Subsequent updates arrive as `git-state` broadcasts that land in
  // `store.gitStates[projectId][worktreePath]` -- we overlay them onto the
  // structural worktree list here so the sidebar's ↑n ↓n nΔ counters stay
  // live without round-tripping through `worktree-created` re-broadcasts.
  const worktreesWithCounters = useMemo(() => {
    const result: Record<string, (typeof store.worktrees)[string]> = {};
    for (const [projectId, list] of Object.entries(store.worktrees)) {
      const states = store.gitStates[projectId] ?? {};
      result[projectId] = list.map((w) => {
        const s = states[w.path];
        if (!s) return w;
        return {
          ...w,
          ahead: s.ahead,
          behind: s.behind,
          dirtyCount: s.dirtyCount,
        };
      });
    }
    return result;
  }, [store.worktrees, store.gitStates]);

  const reviewPendingSessions = useReviewPendingSessions({
    activeProjectId,
    agentStates: store.agentStates,
    sessions,
  });

  const attentionDismissed = useAttentionDismissals({
    focusedPaneId,
    agentStates: store.agentStates,
  });

  useAgentSounds({
    activeProjectId,
    agentStates: store.agentStates,
    snapshotApplied: store.snapshotApplied,
    playAttentionSound,
    playCompletionSound,
    sessions,
  });

  const activeProject = useMemo(
    () =>
      activeProjectId
        ? (store.projects.find((p) => p.id === activeProjectId) ?? null)
        : null,
    [activeProjectId, store.projects],
  );
  const activeProjectName = activeProject?.name ?? null;
  const activeProjectPath = activeProject?.path ?? null;

  useWorkspaceSelectionSync({
    activeProjectId,
    connected: store.connected,
    projects: store.projects,
    setActiveProjectId,
    missingProjectIds: store.missingProjectIds ?? [],
    route,
    sessions,
  });

  const deleteTarget = useMemo(
    () =>
      deleteConfirm
        ? (store.projects.find((p) => p.id === deleteConfirm) ?? null)
        : null,
    [deleteConfirm, store.projects],
  );

  const projectSessions = useMemo(
    () => sessions.filter((s) => s.projectId === activeProjectId),
    [sessions, activeProjectId],
  );

  const browserPanes = useClientBrowserPanes(activeProjectId);

  const paneModel = useWorkspacePaneModel({
    projectId: activeProjectId,
    projectPath: activeProjectPath,
    worktrees: activeWorktrees,
    sessions,
    focusedPaneId,
    clientBrowserPanes: browserPanes.panesByWorktree,
    serverWorktreePanes: activeProjectId
      ? store.projectStates[activeProjectId]?.worktrees
      : undefined,
    workItems: activeProjectId
      ? (workItemsByProject[activeProjectId] ?? [])
      : [],
  });

  useEffect(() => {
    if (appRouteReadyTracedRef.current) return;
    appRouteReadyTracedRef.current = true;
    const durationMs = performance.now() - appMountedAtRef.current;
    const paneId =
      route.kind === "pane"
        ? route.paneId
        : route.kind === "session"
          ? terminalPaneId(route.sessionId)
          : paneModel.effectiveFocusedPaneId;
    traceTerminalEvent("app-route-ready", {
      routeKind: route.kind,
      paneId,
      sessionId: route.kind === "session" ? route.sessionId : undefined,
      durationMs,
      status: store.hydrated ? "hydrated" : "cached",
    });
    if (durationMs >= 5000) {
      scheduleClientStartupDiagnosticCapture("app-route-ready-slow", {
        type: "app-route-ready",
        routeKind: route.kind,
        paneId,
        sessionId: route.kind === "session" ? route.sessionId : undefined,
        durationMs,
        status: store.hydrated ? "hydrated" : "cached",
      });
    }
  }, [paneModel.effectiveFocusedPaneId, route, store.hydrated]);

  // Keep persisted focusedPaneId aligned with the model's fallback. When
  // a stored id no longer resolves (session gone, project switched), the
  // model returns the main-worktree files pane as `effectiveFocusedPaneId`;
  // write it back so reload and Sidebar selection stay in sync.
  useEffect(() => {
    if (
      paneModel.effectiveFocusedPaneId !== null &&
      paneModel.effectiveFocusedPaneId !== focusedPaneId
    ) {
      setFocusedPaneId(paneModel.effectiveFocusedPaneId);
    }
  }, [paneModel.effectiveFocusedPaneId, focusedPaneId, setFocusedPaneId]);

  useWorkspaceRouteSync({
    activeProjectId,
    focusedPaneId,
    hydrated: store.hydrated,
    monitorActive,
    paneIds: paneModel.paneById,
    navigate,
    projects: store.projects,
    route,
    setActiveProjectId,
    setFocusedPaneId,
    setMonitorActive,
    sessions,
    snapshotApplied: store.snapshotApplied,
    missingProjectIds: store.missingProjectIds ?? [],
  });

  const focusedWorkspace = useFocusedWorkspaceContext({
    activeProject,
    activeProjectId,
    focusedPane: paneModel.focusedPane,
    gitStates: store.gitStates,
    worktrees: store.worktrees,
  });

  const gitWorkflow = useGitWorkflow({
    activeProjectId,
    focusedWorktreePath: focusedWorkspace.worktreePath,
    focusedWorktreeName: focusedWorkspace.worktreeName,
    gitState: focusedWorkspace.gitState,
  });
  const worktreeWorkflow = useWorktreeWorkflow();
  const { canOpenLocalIde } = useLocalIdeCapability();
  const worktreeActions = useWorkspaceWorktreeActions({
    gitStates: store.gitStates,
    worktreeWorkflow,
    worktrees: store.worktrees,
  });

  const [gitGraphSelection, setGitGraphSelection] =
    useGitGraphSelectionForFocus(focusedWorkspace.worktreePath);

  const { createProject, deleteProject: deleteWorkspaceProject } =
    useWorkspaceProjectActions({
      activeProjectId,
      projects: store.projects,
      setActiveProjectId,
      seedProject: store.seedProject,
    });

  const workItemActions = useWorkItemPaneActions({
    itemsByProject: workItemsByProject,
    navigate,
    removeItem: store.removeWorkItem,
    seedItem: store.seedWorkItem,
    seedPanes: store.seedProjectPanes,
    setActiveProjectId,
    setFocusedPaneId,
  });

  const {
    closePane,
    closeRouteSession,
    createWorktreeSession,
    renameSession,
    restartSession,
    runPaneCommandInWorktree,
    toggleSessionPin,
  } = useWorkspaceSessionActions({
    activeProjectId,
    closeBrowserPane: browserPanes.closeBrowser,
    closeWorkItemPane: workItemActions.closePane,
    navigate,
    paneById: paneModel.paneById,
    projects: store.projects,
    sessions,
    setActiveProjectId,
    setErrorToast,
    setFocusedPaneId,
    setOptimisticSessions,
  });

  const openUrl = useWorkspaceOpenUrl({
    activeProjectId,
    clearPendingUrl: store.clearPendingUrl,
    pendingOpenUrl: store.pendingOpenUrl,
    ports: store.ports,
  });

  const { closeSettings, isMobile, openSettings, settingsOpen } =
    useWorkspaceShell({
      activeProjectId,
      projects: store.projects,
      setActiveProjectId,
    });

  const { paneCommands, updateCustomIdeCommands, updateCustomPaneCommands } =
    useWorkspaceCommandConfig({
      hydrated: store.hydrated,
      ideCommands: store.ideCommands,
      paneCommands: store.paneCommands,
      seedIdeCommands: store.seedIdeCommands,
      seedPaneCommands: store.seedPaneCommands,
      setErrorToast,
    });

  useEffect(() => {
    traceTerminalEvent("mobile-surface-route", {
      routeKind: route.kind,
      surface: isMobile
        ? route.kind === "root"
          ? "navigation"
          : "workspace"
        : "split",
      paneId: paneModel.focusedPane?.id ?? null,
    });
  }, [isMobile, paneModel.focusedPane?.id, route.kind]);

  const deleteProject = useProjectDeleteAction({
    deleteProject: deleteWorkspaceProject,
    navigate,
    route,
    sessions,
    setDeleteConfirm,
  });

  const handleConfirmClosePaneTarget = useCallback(
    async (target: ClosePaneTarget) => {
      const closingCurrentRoute =
        isMobile ||
        (route.kind === "session" &&
          target.paneId === terminalPaneId(route.sessionId)) ||
        (route.kind === "pane" && target.paneId === route.paneId);
      if (closingCurrentRoute) navigate({ kind: "root" });
      await closePane(target.paneId);
    },
    [closePane, isMobile, navigate, route],
  );
  const closePaneDialog = useClosePaneDialog({
    onConfirm: handleConfirmClosePaneTarget,
  });

  const handleNewProject = useCallback(() => {
    setNewProjectDialogOpen(true);
  }, []);

  const loadWorktreeLocalFiles = useCallback((projectId: string) => {
    return loadWorktreeLocalFilesRequest(projectId);
  }, []);

  const handleOpenSettings = useCallback(() => {
    openSettings();
  }, [openSettings]);

  const serviceConfigActions = useServiceConfigActions();

  useActiveWorktreeRefresh({
    activeProjectId,
    connected: store.connected,
    missingProjectIds: store.missingProjectIds ?? [],
  });

  const sidebar = useWorkspaceSidebarController({
    activeProjectId,
    agentStates: store.agentStates,
    attentionDismissed,
    connected: store.connected,
    focusedPane: paneModel.focusedPane,
    gitStates: store.gitStates,
    hydrated: store.hydrated,
    isMobile,
    monitorActive,
    navigate,
    onNewProject: handleNewProject,
    onNewWorkItem: workItemActions.picker.open,
    onOpenSettings: handleOpenSettings,
    onOpenUrl: openUrl,
    onToggleSessionPin: (sessionId) => void toggleSessionPin(sessionId),
    paneModelWorktrees: paneModel.worktrees,
    ports: store.ports,
    projectStates: store.projectStates,
    projects: store.projects,
    reviewPendingSessions,
    seedSidebarState: store.seedSidebarState,
    services: store.services,
    sessions,
    setActiveProjectId,
    setErrorToast,
    setFocusedPaneId,
    setMonitorActive,
    worktreesWithCounters,
    workItems: workItemsByProject,
    missingProjectIds: store.missingProjectIds ?? [],
    onCloseProject: setDeleteConfirm,
  });

  const navigationSurface = <Sidebar {...sidebar.props} />;
  const monitorSurface = (
    <WorkspaceMonitorSurface
      agentStates={store.agentStates}
      attentionDismissed={attentionDismissed}
      gitStates={store.gitStates}
      isMobile={isMobile}
      projects={store.projects}
      reviewPendingSessions={reviewPendingSessions}
      sessions={sessions}
      onOpenUrl={openUrl}
      onRestartSession={restartSession}
      onToggleDrawer={() => navigate({ kind: "root" })}
      onToggleSessionPin={toggleSessionPin}
    />
  );
  const paneSurface = (
    <WorkspacePaneSurface
      activeProjectId={activeProjectId}
      activeProjectName={activeProjectName}
      activeProjectPath={activeProjectPath}
      canOpenLocalIde={canOpenLocalIde}
      fileChangeSeq={store.fileChangeSeq}
      focusedWorkspace={focusedWorkspace}
      gitGraphSelection={gitGraphSelection}
      gitWorkflow={gitWorkflow}
      hydrated={store.hydrated}
      allowFilesGit={
        store.snapshotApplied &&
        !(
          activeProjectId != null &&
          (store.missingProjectIds ?? []).includes(activeProjectId)
        )
      }
      ideCommands={store.ideCommands}
      isMobile={isMobile}
      navigate={navigate}
      onBrowserUrlChange={browserPanes.updateBrowserUrl}
      onClosePane={closePane}
      onCopyWorktreePath={worktreeActions.copyWorktreePath}
      onDeleteProject={setDeleteConfirm}
      onGitGraphSelectionChange={setGitGraphSelection}
      onNewProject={handleNewProject}
      onOpenUrl={openUrl}
      onOpenWorktreeInFinder={worktreeActions.openWorktreeInFinder}
      onOpenWorktreeInIde={worktreeActions.openWorktreeInIde}
      onRemoveWorktree={worktreeActions.removeWorktree}
      onRenameSession={renameSession}
      onRequestClosePane={closePaneDialog.request}
      onRestartSession={restartSession}
      onToggleSessionPin={toggleSessionPin}
      paneModel={paneModel}
      projectSessions={projectSessions}
      setFocusedPaneId={setFocusedPaneId}
      workItems={
        activeProjectId ? (workItemsByProject[activeProjectId] ?? []) : []
      }
      worktrees={activeWorktrees}
      onUpdateWorkItem={(workItemId, input) =>
        activeProjectId
          ? workItemActions.update(activeProjectId, workItemId, input)
          : undefined
      }
      onDeleteWorkItem={(workItemId) =>
        activeProjectId
          ? workItemActions.delete(activeProjectId, workItemId)
          : undefined
      }
    />
  );
  const workspaceSurface = (
    <WorkspaceSurface
      closeRouteSession={closeRouteSession}
      eventSocketConnected={store.eventSocketConnected}
      hydrated={store.hydrated}
      monitorActive={monitorActive}
      monitorSurface={monitorSurface}
      navigate={navigate}
      onRestartSession={restartSession}
      paneSurface={paneSurface}
      route={route}
      sessions={sessions}
    />
  );

  return (
    <ProjectsProvider projects={store.projects}>
      <div className="flex h-full flex-col">
        <OfflineBanner
          connected={store.eventSocketConnected}
          status={store.eventSocketStatus}
        />
        <ServerNoticesBanner />
        <div className="flex flex-1 overflow-hidden">
          {isMobile ? (
            route.kind === "root" ? (
              navigationSurface
            ) : (
              workspaceSurface
            )
          ) : (
            <AppShellSplit
              navigation={navigationSurface}
              main={workspaceSurface}
            />
          )}
        </div>

        <WorkspaceOverlays
          closePaneDialog={closePaneDialog}
          createProject={createProject}
          createWorktreeSession={createWorktreeSession}
          deleteProject={deleteProject}
          deleteTarget={deleteTarget}
          errorToast={errorToast}
          gitCommitDialog={{
            commitDialog: gitWorkflow.commitDialog,
            commitBusy: gitWorkflow.commitBusy,
            commitError: gitWorkflow.commitError,
            closeCommitDialog: gitWorkflow.closeCommitDialog,
            submitCommit: gitWorkflow.submitCommit,
          }}
          hostPlatform={store.hostPlatform}
          ideCommands={store.ideCommands}
          isMobile={isMobile}
          loadWorktreeLocalFiles={loadWorktreeLocalFiles}
          newProjectDialogOpen={newProjectDialogOpen}
          newSessionDialog={sidebar.newSessionDialog}
          workItemPicker={workItemActions.picker}
          paneCommandConfigs={store.paneCommands}
          paneCommands={paneCommands}
          removeDeleteTarget={() => setDeleteConfirm(null)}
          runPaneCommandInWorktree={runPaneCommandInWorktree}
          serviceConfig={store.serviceConfig}
          serviceConfigActions={serviceConfigActions}
          settingsOpen={settingsOpen}
          updateCustomIdeCommands={updateCustomIdeCommands}
          updateCustomPaneCommands={updateCustomPaneCommands}
          worktreeDialogs={{
            renameDialog: worktreeWorkflow.renameDialog,
            renameBusy: worktreeWorkflow.renameBusy,
            renameError: worktreeWorkflow.renameError,
            closeRenameDialog: worktreeWorkflow.closeRenameDialog,
            submitRename: worktreeWorkflow.submitRename,
            removeDialog: worktreeWorkflow.removeDialog,
            removeBusy: worktreeWorkflow.removeBusy,
            removeError: worktreeWorkflow.removeError,
            closeRemoveDialog: worktreeWorkflow.closeRemoveDialog,
            submitRemove: worktreeWorkflow.submitRemove,
          }}
          onCloseNewProject={() => setNewProjectDialogOpen(false)}
          onCloseSettings={closeSettings}
          onCreatedProject={() => setMonitorActive(false)}
        />
      </div>
    </ProjectsProvider>
  );
}

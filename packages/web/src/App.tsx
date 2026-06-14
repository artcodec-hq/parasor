import type {
  IdeCommandConfig,
  PortDetectionMode,
  ProjectSidebarState,
  ProjectSidebarStatePatch,
  Session,
  SessionCommand,
  SessionLaunchPreset,
} from "@parasor/shared";
import {
  applyProjectSidebarStatePatch,
  filesPaneId,
  gitPaneId,
  normalizeProjectSidebarState,
  terminalPaneId,
} from "@parasor/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommitDialog } from "./components/overlays/CommitDialog.js";
import { MissingSessionRouteState } from "./components/overlays/MissingSessionRouteState.js";
import { OpenContainerDialog } from "./components/overlays/OpenContainerDialog.js";
import { ProjectModal } from "./components/overlays/ProjectModal.js";
import { RemoveWorktreeDialog } from "./components/overlays/RemoveWorktreeDialog.js";
import { RenameWorktreeDialog } from "./components/overlays/RenameWorktreeDialog.js";
import { SessionErrorState } from "./components/overlays/SessionErrorState.js";
import {
  applyPaneOrderOverrides,
  buildSidebarProjects,
  readClientBrowserChildPanes,
  Sidebar,
} from "./components/sidebar/index.js";
import { CopyToast } from "./components/toasts/CopyToast.js";
import { OfflineBanner } from "./components/toasts/OfflineBanner.js";
import { ServerNoticesBanner } from "./components/toasts/ServerNoticesBanner.js";
import { SyncToastSet } from "./components/toasts/SyncToastSet.js";
import { MonitorView } from "./features/monitor/MonitorView.js";
import { SettingsOverlay, useSettings } from "./features/settings/index.js";
import { fireServiceConfigUpdate } from "./features/settings/service-config-api.js";
import { AppShellSplit } from "./features/workspace/AppShellSplit.js";
import { ClosePaneDialog } from "./features/workspace/ClosePaneDialog.js";
import {
  saveIdeCommands,
  savePaneCommands,
} from "./features/workspace/command-api.js";
import { DeleteProjectDialog } from "./features/workspace/DeleteProjectDialog.js";
import { ProjectsProvider } from "./features/workspace/projects-context.js";
import {
  createSession as createSessionRequest,
  deleteSession as deleteSessionRequest,
  renameSession as renameSessionRequest,
  restartSession as restartSessionRequest,
  setSessionPin as setSessionPinRequest,
} from "./features/workspace/session-api.js";
import { saveProjectSidebarState } from "./features/workspace/sidebar-state-api.js";
import { useAgentSounds } from "./features/workspace/useAgentSounds.js";
import { useAttentionDismissals } from "./features/workspace/useAttentionDismissals.js";
import { useClientBrowserPanes } from "./features/workspace/useClientBrowserPanes.js";
import {
  type ClosePaneTarget,
  useClosePaneDialog,
} from "./features/workspace/useClosePaneDialog.js";
import { useContainerDialog } from "./features/workspace/useContainerDialog.js";
import { useErrorToast } from "./features/workspace/useErrorToast.js";
import { useGitGraphSelectionForFocus } from "./features/workspace/useGitGraphSelectionForFocus.js";
import { useGitWorkflow } from "./features/workspace/useGitWorkflow.js";
import { useLegacyPaneCommandsMigration } from "./features/workspace/useLegacyPaneCommandsMigration.js";
import { useLegacySidebarStateMigration } from "./features/workspace/useLegacySidebarStateMigration.js";
import { useLocalIdeCapability } from "./features/workspace/useLocalIdeCapability.js";
import { useProjectReorder } from "./features/workspace/useProjectReorder.js";
import { useReviewPendingSessions } from "./features/workspace/useReviewPendingSessions.js";
import { useSidebarSearch } from "./features/workspace/useSidebarSearch.js";
import { useWorkspacePaneModel } from "./features/workspace/useWorkspacePaneModel.js";
import { useWorkspacePreferences } from "./features/workspace/useWorkspacePreferences.js";
import { useWorkspaceProjectActions } from "./features/workspace/useWorkspaceProjectActions.js";
import { useWorkspaceRoute } from "./features/workspace/useWorkspaceRoute.js";
import { useWorkspaceSelectionSync } from "./features/workspace/useWorkspaceSelectionSync.js";
import { useWorkspaceShell } from "./features/workspace/useWorkspaceShell.js";
import { useWorktreeWorkflow } from "./features/workspace/useWorktreeWorkflow.js";
import { WorkspacePaneRouter } from "./features/workspace/WorkspacePaneRouter.js";
import {
  createWorktree,
  loadWorktreeLocalFiles as loadWorktreeLocalFilesRequest,
  refreshWorktrees,
} from "./features/workspace/worktree-api.js";
import { useEventSocket } from "./hooks/useEventSocket.js";
import { useGlobalDropGuard } from "./hooks/useGlobalDropGuard.js";
import type { IdeEditor } from "./lib/git-api.js";
import { openHttpUrlInNewTab } from "./lib/open-external-url.js";
import type { OpenUrlOptions } from "./lib/open-url-options.js";
import { resolveOpenUrlTarget } from "./lib/open-url-target.js";
import {
  type CustomPaneCommand,
  PANE_COMMANDS_STORAGE_KEY,
  type PaneCommand,
  paneCommandsWithBuiltins,
} from "./lib/pane-command-store.js";
import { requestPaneFocus } from "./lib/pane-focus-registry.js";
import {
  buildReachablePortLookup,
  findReachablePortForOpenUrl,
} from "./lib/reachable-port-lookup.js";
import { mergeOptimisticSessions } from "./lib/session-merge.js";
import { isAutoResumable } from "./lib/session-resume.js";
import {
  scheduleClientStartupDiagnosticCapture,
  traceTerminalEvent,
} from "./lib/terminal-trace.js";
import { summarizeLocalFileCopies } from "./lib/worktree-copy-summary.js";
import { resolveWorktreeDirName } from "./lib/worktree-dir-name.js";

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
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [monitorActive, setMonitorActive] = useState(false);
  const [errorToast, setErrorToast] = useErrorToast();
  const [optimisticSessions, setOptimisticSessions] = useState<Session[]>([]);

  const store = useEventSocket();
  const paneCommands = useMemo(
    () => paneCommandsWithBuiltins(store.paneCommands),
    [store.paneCommands],
  );
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
  });

  const deleteTarget = useMemo(
    () =>
      deleteConfirm
        ? (store.projects.find((p) => p.id === deleteConfirm) ?? null)
        : null,
    [deleteConfirm, store.projects],
  );

  const pinnedSessionCount = useMemo(
    () => sessions.filter((s) => s.pinned === true).length,
    [sessions],
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
      if (!session) {
        return;
      }
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
        store.hydrated &&
        route.projectId &&
        !store.projects.some((project) => project.id === route.projectId)
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
        store.hydrated &&
        !store.projects.some((project) => project.id === route.projectId)
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
    monitorActive,
    route,
    setActiveProjectId,
    setFocusedPaneId,
    sessions,
    store.hydrated,
    store.projects,
    navigate,
  ]);

  const focusedWorktreePath = paneModel.focusedPane?.worktreePath ?? null;
  const focusedGitState = useMemo(() => {
    if (!activeProjectId || !focusedWorktreePath) return null;
    return store.gitStates[activeProjectId]?.[focusedWorktreePath] ?? null;
  }, [activeProjectId, focusedWorktreePath, store.gitStates]);
  const focusedWorktreeRecord = useMemo(() => {
    if (!activeProjectId || !focusedWorktreePath) return null;
    return (
      store.worktrees[activeProjectId]?.find(
        (w) => w.path === focusedWorktreePath,
      ) ?? null
    );
  }, [activeProjectId, focusedWorktreePath, store.worktrees]);

  // Branch-leaning identifier consumed as a `gitWorkflow` fallback when no
  // explicit branch is available. Resolution: live gitState.branch ->
  // worktree snapshot branch -> "main" for the project root -> path basename.
  const focusedWorktreeName = useMemo(() => {
    const pane = paneModel.focusedPane;
    if (!pane || !activeProject) return null;
    const branch =
      focusedGitState?.branch ?? focusedWorktreeRecord?.branch ?? null;
    if (branch) return branch;
    return pane.worktreePath === activeProject.path
      ? "main"
      : (pane.worktreePath.replace(/\/+$/, "").split("/").pop() ??
          pane.worktreePath);
  }, [
    paneModel.focusedPane,
    activeProject,
    focusedGitState,
    focusedWorktreeRecord,
  ]);

  // `false` when the project root has been confirmed not a git repo
  // (mirrors `buildSidebarProjects` in sidebar-model). Drives the
  // pane-header label swap (`main` -> `root`), the folder glyph in
  // crumb[1], and the More menu's repo-only entries. Pre-hydration /
  // missing gitState ≡ treat as repo (same convention as the sidebar).
  const activeProjectIsRepo = useMemo(() => {
    if (!activeProject) return true;
    const rootGit = store.gitStates[activeProject.id]?.[activeProject.path];
    return rootGit?.isRepo !== false;
  }, [activeProject, store.gitStates]);

  // Worktree directory name shown as crumb[1] in SessionPaneHeader. Always
  // the path basename (or "main"/"root" for the project root) -- distinct
  // from the git branch name shown as crumb[2], so a worktree directory
  // and its current branch can disagree visibly.
  const focusedWorktreeDirName = useMemo(() => {
    const pane = paneModel.focusedPane;
    if (!pane || !activeProject) return null;
    return resolveWorktreeDirName(
      pane.worktreePath,
      activeProject.path,
      activeProjectIsRepo,
    );
  }, [paneModel.focusedPane, activeProject, activeProjectIsRepo]);

  // Live branch from gitStates only -- null until the first git poll lands,
  // suppressing crumb[2] rather than echoing the dir name.
  const focusedBranchName = focusedGitState?.branch ?? null;

  const isGitTab = paneModel.focusedPane?.state.kind === "git";
  const gitWorkflow = useGitWorkflow({
    activeProjectId,
    focusedWorktreePath,
    focusedWorktreeName,
    gitState: focusedGitState,
  });
  const worktreeWorkflow = useWorktreeWorkflow();
  const { canOpenLocalIde } = useLocalIdeCapability();

  const handleOpenWorktreeInFinder = useCallback(
    (projectId: string, worktreePath: string) => {
      worktreeWorkflow.openWorktreeInFinder({ projectId, worktreePath });
    },
    [worktreeWorkflow],
  );

  const handleOpenWorktreeInIde = useCallback(
    (projectId: string, worktreePath: string, editor: IdeEditor) => {
      worktreeWorkflow.openWorktreeInIde({ projectId, worktreePath, editor });
    },
    [worktreeWorkflow],
  );

  const handleCopyWorktreePath = useCallback(
    (worktreePath: string) => {
      worktreeWorkflow.copyWorktreePath(worktreePath);
    },
    [worktreeWorkflow],
  );

  // The third arg `fallback` is the path basename (worktree.name). The
  // canonical branch lives in gitStates and is preferred whenever non-empty;
  // detached HEAD / pre-hydration / non-git-repo all surface `branch === ""`,
  // so the basename serves as the dialog label in those cases. The server
  // resolves the operation by worktreePath, so this is a UX-only concern.
  const handleRenameWorktree = useCallback(
    (projectId: string, worktreePath: string, fallback: string) => {
      const tracked = store.gitStates[projectId]?.[worktreePath]?.branch;
      const branch = tracked && tracked.length > 0 ? tracked : fallback;
      worktreeWorkflow.openRenameDialog({
        projectId,
        worktreePath,
        currentBranch: branch,
      });
    },
    [worktreeWorkflow, store.gitStates],
  );

  const handleRemoveWorktree = useCallback(
    (projectId: string, worktreePath: string, fallback: string) => {
      const gitState = store.gitStates[projectId]?.[worktreePath];
      const branch =
        gitState?.branch && gitState.branch.length > 0
          ? gitState.branch
          : fallback;
      const dirtyCount = gitState?.dirtyCount ?? 0;
      // Orphan flag rides on the structural worktree list (server flips it
      // when `git status` rejects with ENOENT), not on `gitStates` -- those
      // polls also fail on a missing path so they degrade to "no entry".
      const wt = store.worktrees[projectId]?.find(
        (w) => w.path === worktreePath,
      );
      worktreeWorkflow.openRemoveDialog({
        projectId,
        worktreePath,
        branch,
        dirtyCount,
        ...(wt?.orphan === true && { orphan: true }),
      });
    },
    [worktreeWorkflow, store.gitStates, store.worktrees],
  );

  const [gitGraphSelection, setGitGraphSelection] =
    useGitGraphSelectionForFocus(focusedWorktreePath);

  const { createProject, deleteProject: deleteWorkspaceProject } =
    useWorkspaceProjectActions({
      activeProjectId,
      projects: store.projects,
      setActiveProjectId,
      seedProject: store.seedProject,
    });

  const createSession = useCallback(
    async (
      projectId: string,
      command?: SessionCommand,
      title?: string,
      cwd?: string,
      bootstrapInput?: string,
      launchPreset?: SessionLaunchPreset,
    ) => {
      const session = await createSessionRequest({
        projectId,
        command,
        title,
        cwd,
        bootstrapInput,
        launchPreset,
      });
      if (!session) return;
      setOptimisticSessions((current) =>
        current.some((existing) => existing.id === session.id)
          ? current
          : [...current, session],
      );
      // The new session belongs to `projectId`; if the user triggered
      // the action from a non-active project (Add child on ProjectB
      // while ProjectA is selected), switch the active project so the
      // pane model can resolve the new session id.
      if (projectId !== activeProjectId) {
        setActiveProjectId(projectId);
      }
      const paneId = `terminal:${session.id}`;
      setFocusedPaneId(paneId);
      requestPaneFocus(paneId);
      navigate({ kind: "session", sessionId: session.id });
    },
    [activeProjectId, navigate, setActiveProjectId, setFocusedPaneId],
  );

  const runPaneCommandInWorktree = useCallback(
    (projectId: string, worktreePath: string, command: PaneCommand) => {
      const initialInput = command.initialInput.trim();
      const bootstrapInput = initialInput ? `${initialInput}\r` : undefined;
      void createSession(
        projectId,
        undefined,
        command.builtin && !initialInput ? undefined : command.label,
        worktreePath,
        bootstrapInput,
        command.launchPreset,
      );
    },
    [createSession],
  );

  const createWorktreeSession = useCallback(
    async (
      projectId: string,
      input: {
        branch: string;
        base: string;
        copyLocalFiles: string[];
        rememberLocalFiles: boolean;
        parentWorktreePath: string;
        command: PaneCommand;
      },
    ) => {
      const data = await createWorktree(projectId, {
        branch: input.branch,
        base: input.base,
        copyLocalFiles: input.copyLocalFiles,
        rememberLocalFiles: input.rememberLocalFiles,
        lineage: {
          creationSource: "ui",
          parentWorktreePath: input.parentWorktreePath,
          createdByPaneCommandId: input.command.id,
          createdByPaneCommandLabel: input.command.label,
        },
      });
      const worktreePath = data.path;
      const copyMessage = summarizeLocalFileCopies(data.localFileCopies);
      if (copyMessage) setErrorToast(copyMessage);
      const initialInput = input.command.initialInput.trim();
      const bootstrapInput = initialInput ? `${initialInput}\r` : undefined;
      await createSession(
        projectId,
        undefined,
        input.command.builtin && !initialInput
          ? undefined
          : input.command.label,
        worktreePath,
        bootstrapInput,
        input.command.launchPreset,
      );
    },
    [createSession, setErrorToast],
  );

  const updateCustomPaneCommands = useCallback(
    (commands: CustomPaneCommand[]) => {
      const previous = store.paneCommands;
      store.seedPaneCommands(commands);
      void savePaneCommands(commands)
        .then((body) => {
          if (Array.isArray(body.commands)) {
            store.seedPaneCommands(body.commands);
          }
          try {
            window.localStorage.removeItem(PANE_COMMANDS_STORAGE_KEY);
          } catch {
            // localStorage unavailable; server state is already authoritative.
          }
        })
        .catch(() => {
          store.seedPaneCommands(previous);
          setErrorToast("Failed to save terminal commands");
        });
    },
    [store, setErrorToast],
  );

  const updateCustomIdeCommands = useCallback(
    (commands: IdeCommandConfig[]) => {
      const previous = store.ideCommands;
      store.seedIdeCommands(commands);
      void saveIdeCommands(commands)
        .then((body) => {
          if (Array.isArray(body.commands)) {
            store.seedIdeCommands(body.commands);
          }
        })
        .catch(() => {
          store.seedIdeCommands(previous);
          setErrorToast("Failed to save IDE commands");
        });
    },
    [store, setErrorToast],
  );

  useLegacyPaneCommandsMigration({
    hydrated: store.hydrated,
    paneCommandsCount: store.paneCommands.length,
    onMigrate: updateCustomPaneCommands,
  });

  const restartSession = useCallback(async (sessionId: string) => {
    await restartSessionRequest(sessionId);
  }, []);

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      await renameSessionRequest(sessionId, title);
    },
    [],
  );

  const toggleSessionPin = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const next = session.pinned !== true;
      await setSessionPinRequest(sessionId, next);
    },
    [sessions],
  );

  const closePane = useCallback(
    async (paneId: string) => {
      const pane = paneModel.paneById.get(paneId);
      if (!pane) return;
      if (pane.state.kind === "terminal") {
        await deleteSessionRequest(pane.state.sessionId);
        return;
      }
      if (pane.state.kind === "browser") {
        browserPanes.closeBrowser(paneId);
        return;
      }
      // Singletons (files/git) cannot be closed.
    },
    [browserPanes, paneModel.paneById],
  );

  const closeRouteSession = useCallback(
    (session: Session) => {
      const project = store.projects.find((p) => p.id === session.projectId);
      if (project) {
        if (activeProjectId !== session.projectId) {
          setActiveProjectId(session.projectId);
        }
        setFocusedPaneId(filesPaneId(project.path));
      }
      navigate({ kind: "root" });
      void deleteSessionRequest(session.id);
    },
    [
      activeProjectId,
      navigate,
      setActiveProjectId,
      setFocusedPaneId,
      store.projects,
    ],
  );

  // Maps detected dev-server ports to the port the viewer device can reach via
  // the page host: the TCP forwarder's OS-assigned listen port when one fronts
  // it, or the dev server's own port when it already binds all interfaces. A
  // port with neither is absent, so the loopback URL is left as-is. Terminal
  // link clicks and port toasts pass their source project id so mobile workspace
  // state can't accidentally hide the relevant port table. Pending-IPC opens do
  // not have a source project, so they fall back to active/all-project lookup.
  const reachablePorts = useMemo(
    () => buildReachablePortLookup(store.ports),
    [store.ports],
  );

  const findReachablePort = useCallback(
    (devPort: number, projectId?: string): number | undefined => {
      return findReachablePortForOpenUrl(reachablePorts, devPort, {
        activeProjectId,
        projectId,
      });
    },
    [activeProjectId, reachablePorts],
  );

  // Open a URL in the *device's own* browser (a new tab/window), not an
  // embedded pane: on a phone the parasor UI is single-pane, so a side-by-side
  // preview pane buys nothing. Only absolute `http(s)` URLs are honored (a
  // detected dev server, a terminal link, a `parasor open` argument); anything
  // else -- non-`http(s)` schemes, relative/unparseable input -- is ignored so
  // this never becomes an arbitrary-scheme launcher. A `localhost`/`127.0.0.1`
  // dev-server URL is first rewritten to the address the viewer device can
  // reach -- the page host plus the per-port TCP forwarder's listen port when
  // one fronts it (see `resolveReachableBrowserUrl`); other hosts open verbatim.
  const openUrl = useCallback(
    (url: string, options?: OpenUrlOptions) => {
      const target = resolveOpenUrlTarget(url, options, findReachablePort);
      if (target === null) return;
      openHttpUrlInNewTab(target);
    },
    [findReachablePort],
  );

  // Pending IPC `open` URL (`parasor open <url>` -> `browser-url-changed`
  // routed via `__route_open__` -> store.pendingOpenUrl). Hand it to the same
  // `openUrl` path, then clear it so it doesn't re-fire.
  useEffect(() => {
    if (!store.pendingOpenUrl) return;
    openUrl(store.pendingOpenUrl);
    store.clearPendingUrl();
  }, [store.pendingOpenUrl, store.clearPendingUrl, openUrl]);

  const { closeSettings, isMobile, openSettings, settingsOpen } =
    useWorkspaceShell({
      activeProjectId,
      projects: store.projects,
      setActiveProjectId,
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

  const deleteProject = useCallback(
    async (id: string) => {
      const deletingCurrentRoute =
        (route.kind === "pane" && route.projectId === id) ||
        (route.kind === "worktree" && route.projectId === id) ||
        (route.kind === "session" &&
          sessions.some(
            (session) =>
              session.id === route.sessionId && session.projectId === id,
          ));
      await deleteWorkspaceProject(id);
      if (deletingCurrentRoute) {
        navigate({ kind: "root" }, { replace: true });
      }
      setDeleteConfirm(null);
    },
    [deleteWorkspaceProject, navigate, route, sessions],
  );

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
    setModalOpen(true);
  }, []);

  const {
    reorderResetSignal,
    pendingProjectReorderCount,
    reorder: handleReorderProjects,
  } = useProjectReorder({ onError: setErrorToast });

  const patchProjectSidebarState = useCallback(
    (
      projectId: string,
      patch: ProjectSidebarStatePatch,
      errorMessage: string,
    ) => {
      const previous = normalizeProjectSidebarState(
        store.projectStates[projectId]?.sidebar,
      );
      const next = applyProjectSidebarStatePatch(previous, patch);
      store.seedSidebarState(projectId, next);
      const request = saveProjectSidebarState(projectId, patch);
      void request.catch(() => {
        store.seedSidebarState(projectId, previous);
        setErrorToast(errorMessage);
      });
      return request;
    },
    [store, setErrorToast],
  );

  const handleReorderPanes = useCallback(
    (projectId: string, worktreePath: string, childIds: string[]) => {
      const current = normalizeProjectSidebarState(
        store.projectStates[projectId]?.sidebar,
      );
      const validPaths =
        sidebarProjectsRef.current
          .find((p) => p.id === projectId)
          ?.worktrees.map((w) => w.path) ?? [];
      const allowed = new Set(validPaths);
      allowed.add(worktreePath);
      const paneOrder: NonNullable<ProjectSidebarStatePatch["paneOrder"]> = {};
      for (const path of Object.keys(current.paneOrder)) {
        if (!allowed.has(path)) paneOrder[path] = null;
      }
      paneOrder[worktreePath] = childIds;
      patchProjectSidebarState(
        projectId,
        { paneOrder },
        "Failed to save pane order",
      );
    },
    [patchProjectSidebarState, store.projectStates],
  );

  const handleWorktreeOpenChange = useCallback(
    (projectId: string, worktreePath: string, open: boolean) => {
      patchProjectSidebarState(
        projectId,
        { worktreeOpen: { [worktreePath]: open } },
        "Failed to save sidebar open state",
      );
    },
    [patchProjectSidebarState],
  );

  const loadWorktreeLocalFiles = useCallback((projectId: string) => {
    return loadWorktreeLocalFilesRequest(projectId);
  }, []);

  const handleOpenSettings = useCallback(() => {
    openSettings();
  }, [openSettings]);

  const handlePreventIdleSleepChange = useCallback((enabled: boolean) => {
    fireServiceConfigUpdate({ preventIdleSleep: enabled });
  }, []);

  const handlePortDetectionChange = useCallback((mode: PortDetectionMode) => {
    fireServiceConfigUpdate({ portDetection: mode });
  }, []);

  const handleDropSizeMaxBytesChange = useCallback((bytes: number) => {
    fireServiceConfigUpdate({ dropSizeMaxBytes: bytes });
  }, []);

  const projectNames = useMemo(
    () => Object.fromEntries(store.projects.map((p) => [p.id, p.name])),
    [store.projects],
  );

  /*
   * Fast-discovery for worktrees created out-of-band (e.g. an agent runs
   * `git worktree add` from a sub-shell). The 10s safety-net poll on the
   * server side eventually catches up, but orphan agent display calls for the
   * sidebar to surface the new entry as soon as the user activates the
   * project. The GET endpoint runs `git worktree list --porcelain` and
   * fans out the resulting deltas via `reconcileWorktrees` -- we only need
   * to trigger it; the response itself is consumed by the WS broadcast.
   */
  useEffect(() => {
    if (!store.connected || !activeProjectId) return;
    const ac = new AbortController();
    void refreshWorktrees(activeProjectId, ac.signal).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn("Worktree refresh failed:", error);
    });
    return () => ac.abort();
  }, [activeProjectId, store.connected]);

  const handleMobileSidebarSearchShortcut = useCallback(
    () => navigate({ kind: "root" }),
    [navigate],
  );
  const {
    open: sidebarSearchOpen,
    query: sidebarSearchQuery,
    setQuery: setSidebarSearchQuery,
    toggle: handleToggleSidebarSearch,
    close: handleCloseSidebarSearch,
  } = useSidebarSearch({
    isMobile,
    onMobileOpenShortcut: handleMobileSidebarSearchShortcut,
  });

  const sidebarProjects = useMemo(() => {
    return applyPaneOrderOverrides(
      buildSidebarProjects({
        projects: store.projects,
        activeProjectId,
        activeWorktrees: paneModel.worktrees,
        sessions,
        agentStates: store.agentStates,
        reviewPendingSessions,
        worktreesByProject: worktreesWithCounters,
        gitStates: store.gitStates,
        attentionDismissed,
        inactiveChildPanesByProject: readClientBrowserChildPanes(
          store.projects,
        ),
      }),
      store.projectStates,
    );
  }, [
    store.projects,
    store.projectStates,
    activeProjectId,
    paneModel.worktrees,
    sessions,
    store.agentStates,
    reviewPendingSessions,
    worktreesWithCounters,
    store.gitStates,
    attentionDismissed,
  ]);

  // handleReorderPanes needs the project's current worktree paths to
  // prune storage entries for worktrees that no longer exist on the
  // server. Read via ref so the callback identity stays stable across
  // sidebar re-renders.
  const sidebarProjectsRef = useRef(sidebarProjects);
  sidebarProjectsRef.current = sidebarProjects;

  useLegacySidebarStateMigration({
    hydrated: store.hydrated,
    projects: sidebarProjects,
    projectStates: store.projectStates,
    onMigrate: (projectId, patch) =>
      patchProjectSidebarState(
        projectId,
        patch,
        "Failed to migrate sidebar state",
      ),
  });

  const handleSelectMonitor = useCallback(() => {
    setMonitorActive(true);
    handleCloseSidebarSearch();
    navigate({ kind: "monitor" });
  }, [handleCloseSidebarSearch, navigate]);

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
      handleCloseSidebarSearch();
      navigate({
        kind: "worktree",
        projectId,
        worktreePath: path,
        tab: "files",
      });
    },
    [
      activeProjectId,
      handleCloseSidebarSearch,
      navigate,
      setActiveProjectId,
      setFocusedPaneId,
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
      handleCloseSidebarSearch();
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
      handleCloseSidebarSearch,
      navigate,
      setActiveProjectId,
      setFocusedPaneId,
    ],
  );

  const containerDialog = useContainerDialog({
    projects: store.projects,
    gitStates: store.gitStates,
  });
  const handleOpenContainer = useCallback(
    (projectId: string, worktreeId: string) => {
      containerDialog.open(projectId, worktreeId);
      if (isMobile) {
        handleCloseSidebarSearch();
      }
    },
    [containerDialog.open, handleCloseSidebarSearch, isMobile],
  );

  const handleToggleSidebarChildPin = useCallback(
    (childId: string) => {
      if (!childId.startsWith("terminal:")) return;
      void toggleSessionPin(childId.slice("terminal:".length));
    },
    [toggleSessionPin],
  );

  const worktreeOpenByProject = useMemo(() => {
    const out: Record<string, ProjectSidebarState["worktreeOpen"]> = {};
    for (const project of store.projects) {
      out[project.id] = normalizeProjectSidebarState(
        store.projectStates[project.id]?.sidebar,
      ).worktreeOpen;
    }
    return out;
  }, [store.projects, store.projectStates]);

  const sidebarProps = useMemo(
    () => ({
      projects: sidebarProjects,
      selection: {
        monitor: monitorActive,
        selectedWorktreeId:
          !monitorActive && paneModel.focusedPane
            ? `wt:${paneModel.focusedPane.worktreePath}`
            : null,
        selectedChildId:
          !monitorActive &&
          paneModel.focusedPane &&
          (paneModel.focusedPane.state.kind === "terminal" ||
            paneModel.focusedPane.state.kind === "browser")
            ? paneModel.focusedPane.id
            : null,
      },
      connected: store.connected,
      portsByProjectId: store.ports,
      projectNames,
      onOpenUrl: openUrl,
      pinnedMonitorCount: pinnedSessionCount,
      onSelectMonitor: handleSelectMonitor,
      onSelectWorktree: handleSelectWorktree,
      onSelectChild: handleSelectChild,
      onOpenContainer: handleOpenContainer,
      onToggleChildPin: handleToggleSidebarChildPin,
      worktreeOpenByProject,
      onWorktreeOpenChange: handleWorktreeOpenChange,
      onNewProject: handleNewProject,
      onOpenSettings: handleOpenSettings,
      searchOpen: sidebarSearchOpen,
      searchQuery: sidebarSearchQuery,
      onToggleSearch: handleToggleSidebarSearch,
      onCloseSearch: handleCloseSidebarSearch,
      onSearchQueryChange: setSidebarSearchQuery,
      onReorderProjects: handleReorderProjects,
      onReorderPanes: handleReorderPanes,
      reorderResetSignal,
      pendingProjectReorderCount,
    }),
    [
      sidebarProjects,
      monitorActive,
      paneModel.focusedPane,
      store.connected,
      store.ports,
      projectNames,
      openUrl,
      pinnedSessionCount,
      handleSelectMonitor,
      handleSelectWorktree,
      handleSelectChild,
      handleOpenContainer,
      handleToggleSidebarChildPin,
      worktreeOpenByProject,
      handleWorktreeOpenChange,
      handleNewProject,
      handleOpenSettings,
      sidebarSearchOpen,
      sidebarSearchQuery,
      handleToggleSidebarSearch,
      handleCloseSidebarSearch,
      setSidebarSearchQuery,
      handleReorderProjects,
      handleReorderPanes,
      reorderResetSignal,
      pendingProjectReorderCount,
    ],
  );

  // Capture into a local so TypeScript narrows it inside the dialog
  // callbacks (the inline arrow handlers below). Property access on the
  // hook object would lose narrowing through the closure boundary.
  const containerDialogTarget = containerDialog.target;
  const containerDialogContext = containerDialog.context;

  const navigationSurface = <Sidebar {...sidebarProps} fill />;
  const routeSession =
    route.kind === "session"
      ? (sessions.find((session) => session.id === route.sessionId) ?? null)
      : null;
  const missingRouteSessionId =
    route.kind === "session" && !routeSession ? route.sessionId : null;
  const unavailableRouteSession =
    routeSession?.state === "ended" &&
    !isAutoResumable(routeSession.command, routeSession.endReason)
      ? routeSession
      : null;

  const workspaceSurface = missingRouteSessionId ? (
    <MissingSessionRouteState
      sessionId={missingRouteSessionId}
      hydrated={store.hydrated}
      connected={store.eventSocketConnected}
      onClose={() => navigate({ kind: "root" })}
    />
  ) : unavailableRouteSession ? (
    <SessionErrorState
      sessionTitle={
        unavailableRouteSession.title.trim() || unavailableRouteSession.id
      }
      command={unavailableRouteSession.command}
      endReason={unavailableRouteSession.endReason}
      onRestart={() => void restartSession(unavailableRouteSession.id)}
      onClose={() => closeRouteSession(unavailableRouteSession)}
    />
  ) : monitorActive ? (
    <MonitorView
      projects={store.projects}
      sessions={sessions}
      agentStates={store.agentStates}
      reviewPendingSessions={reviewPendingSessions}
      gitStates={store.gitStates}
      attentionDismissed={attentionDismissed}
      isMobile={isMobile}
      onToggleDrawer={() => navigate({ kind: "root" })}
      onRestartSession={restartSession}
      onOpenUrl={openUrl}
      onTogglePin={toggleSessionPin}
    />
  ) : (
    <WorkspacePaneRouter
      activeProjectId={activeProjectId}
      activeProjectName={activeProjectName}
      activeProjectPath={activeProjectPath}
      activeProjectIsRepo={activeProjectIsRepo}
      allPanes={paneModel.allPanes}
      focusedPane={paneModel.focusedPane}
      focusedWorktreeDirName={focusedWorktreeDirName}
      fileChangeSeq={store.fileChangeSeq}
      gitState={focusedGitState}
      hydrated={store.hydrated}
      isMobile={isMobile}
      gitMenuActions={
        isGitTab
          ? {
              onPull: () => gitWorkflow.pull(),
              onPush: () => gitWorkflow.push(),
            }
          : undefined
      }
      gitGraphSelection={gitGraphSelection}
      onGitGraphSelectionChange={setGitGraphSelection}
      gitBranchName={focusedBranchName}
      commitBusy={gitWorkflow.commitBusy}
      commitError={gitWorkflow.commitError}
      onClearCommitError={gitWorkflow.clearCommitError}
      onSubmitInlineCommit={gitWorkflow.submitInlineCommit}
      sessions={projectSessions}
      onToggleDrawer={() => navigate({ kind: "root" })}
      onClosePane={closePane}
      onRequestClosePane={closePaneDialog.request}
      onNewProject={handleNewProject}
      onOpenUrl={openUrl}
      onBrowserUrlChange={browserPanes.updateBrowserUrl}
      onRestartSession={restartSession}
      onRenameSession={renameSession}
      onSelectWorktreeTab={(worktreePath, tab) => {
        setFocusedPaneId(
          tab === "git" ? gitPaneId(worktreePath) : filesPaneId(worktreePath),
        );
        if (activeProjectId) {
          navigate({
            kind: "worktree",
            projectId: activeProjectId,
            worktreePath,
            tab,
          });
        }
      }}
      onToggleSessionPin={toggleSessionPin}
      onOpenWorktreeInFinder={handleOpenWorktreeInFinder}
      onOpenWorktreeInIde={handleOpenWorktreeInIde}
      ideCommands={store.ideCommands}
      canOpenLocalIde={canOpenLocalIde}
      onCopyWorktreePath={handleCopyWorktreePath}
      onRenameWorktree={handleRenameWorktree}
      onRemoveWorktree={handleRemoveWorktree}
      onDeleteProject={(projectId) => setDeleteConfirm(projectId)}
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

        <ProjectModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onCreate={(path, name) => {
            setMonitorActive(false);
            return createProject(path, name);
          }}
          isMobile={isMobile}
        />

        <SettingsOverlay
          open={settingsOpen}
          onClose={closeSettings}
          server={{
            serviceConfig: store.serviceConfig,
            hostPlatform: store.hostPlatform,
            onPreventIdleSleepChange: handlePreventIdleSleepChange,
            onPortDetectionChange: handlePortDetectionChange,
            onDropSizeMaxBytesChange: handleDropSizeMaxBytesChange,
            ideCommands: store.ideCommands,
            onIdeCommandsChange: updateCustomIdeCommands,
          }}
        />

        {errorToast && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-window border border-warning/60 bg-bg-secondary px-3 py-2 text-sm text-text-primary shadow-lg"
          >
            {errorToast}
          </div>
        )}

        {deleteTarget && (
          <DeleteProjectDialog
            projectName={deleteTarget.name}
            onCancel={() => setDeleteConfirm(null)}
            onConfirm={() => void deleteProject(deleteTarget.id)}
          />
        )}

        {closePaneDialog.target && (
          <ClosePaneDialog
            paneTitle={closePaneDialog.target.title}
            paneKind={closePaneDialog.target.paneKind}
            onCancel={closePaneDialog.cancel}
            onConfirm={() => void closePaneDialog.confirm()}
          />
        )}

        {containerDialogTarget && containerDialogContext && (
          <OpenContainerDialog
            open
            project={containerDialogContext.project}
            worktree={containerDialogContext.worktree}
            commands={paneCommands}
            commandConfigs={store.paneCommands}
            isMobile={isMobile}
            loadLocalFiles={loadWorktreeLocalFiles}
            onClose={containerDialog.close}
            onCommandsChange={updateCustomPaneCommands}
            onCreateWorktreeSession={(input) =>
              createWorktreeSession(containerDialogTarget.projectId, input)
            }
            onRunCommand={(path, command) =>
              runPaneCommandInWorktree(
                containerDialogTarget.projectId,
                path,
                command,
              )
            }
          />
        )}

        {worktreeWorkflow.renameDialog && (
          <RenameWorktreeDialog
            open
            currentBranch={worktreeWorkflow.renameDialog.currentBranch}
            busy={worktreeWorkflow.renameBusy}
            error={worktreeWorkflow.renameError}
            onClose={worktreeWorkflow.closeRenameDialog}
            onSubmit={worktreeWorkflow.submitRename}
          />
        )}

        {worktreeWorkflow.removeDialog && (
          <RemoveWorktreeDialog
            open
            branch={worktreeWorkflow.removeDialog.branch}
            worktreePath={worktreeWorkflow.removeDialog.worktreePath}
            dirtyCount={worktreeWorkflow.removeDialog.dirtyCount}
            orphan={worktreeWorkflow.removeDialog.orphan === true}
            busy={worktreeWorkflow.removeBusy}
            error={worktreeWorkflow.removeError}
            onClose={worktreeWorkflow.closeRemoveDialog}
            onSubmit={worktreeWorkflow.submitRemove}
          />
        )}

        <CommitDialog
          open={gitWorkflow.commitDialog !== null}
          busy={gitWorkflow.commitBusy}
          error={gitWorkflow.commitError}
          branchName={gitWorkflow.commitDialog?.branchName ?? null}
          files={gitWorkflow.commitDialog?.files ?? []}
          isMobile={isMobile}
          onClose={gitWorkflow.closeCommitDialog}
          onCommit={gitWorkflow.submitCommit}
        />

        <SyncToastSet />
        <CopyToast />
      </div>
    </ProjectsProvider>
  );
}

import type {
  PaneEntry,
  Project,
  Session,
  SessionCommand,
} from "@parasor/shared";
import {
  filesPaneId,
  type SessionLaunchPreset,
  terminalPaneId,
} from "@parasor/shared";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { PaneCommand } from "../../lib/pane-command-store.js";
import { requestPaneFocus } from "../../lib/pane-focus-registry.js";
import type { WorkspaceRoute } from "../../lib/workspace-route.js";
import { summarizeLocalFileCopies } from "../../lib/worktree-copy-summary.js";
import {
  createSession as createSessionRequest,
  deleteSession as deleteSessionRequest,
  renameSession as renameSessionRequest,
  restartSession as restartSessionRequest,
  setSessionPin as setSessionPinRequest,
} from "./session-api.js";
import { createWorktree } from "./worktree-api.js";

interface CreateWorktreeSessionInput {
  branch: string;
  base: string;
  copyLocalFiles: string[];
  rememberLocalFiles: boolean;
  parentWorktreePath: string;
  command: PaneCommand;
}

interface UseWorkspaceSessionActionsOptions {
  activeProjectId: string | null;
  closeBrowserPane: (paneId: string) => void;
  navigate: (route: WorkspaceRoute, opts?: { replace?: boolean }) => void;
  paneById: Map<string, PaneEntry>;
  projects: Project[];
  sessions: Session[];
  setActiveProjectId: (projectId: string) => void;
  setErrorToast: (message: string) => void;
  setFocusedPaneId: (paneId: string) => void;
  setOptimisticSessions: Dispatch<SetStateAction<Session[]>>;
}

export function useWorkspaceSessionActions({
  activeProjectId,
  closeBrowserPane,
  navigate,
  paneById,
  projects,
  sessions,
  setActiveProjectId,
  setErrorToast,
  setFocusedPaneId,
  setOptimisticSessions,
}: UseWorkspaceSessionActionsOptions) {
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
      if (projectId !== activeProjectId) {
        setActiveProjectId(projectId);
      }
      const paneId = terminalPaneId(session.id);
      setFocusedPaneId(paneId);
      requestPaneFocus(paneId);
      navigate({ kind: "session", sessionId: session.id });
    },
    [
      activeProjectId,
      navigate,
      setActiveProjectId,
      setFocusedPaneId,
      setOptimisticSessions,
    ],
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
    async (projectId: string, input: CreateWorktreeSessionInput) => {
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
      const pane = paneById.get(paneId);
      if (!pane) return;
      if (pane.state.kind === "terminal") {
        await deleteSessionRequest(pane.state.sessionId);
        return;
      }
      if (pane.state.kind === "browser") {
        closeBrowserPane(paneId);
      }
    },
    [closeBrowserPane, paneById],
  );

  const closeRouteSession = useCallback(
    (session: Session) => {
      const project = projects.find((p) => p.id === session.projectId);
      if (project) {
        if (activeProjectId !== session.projectId) {
          setActiveProjectId(session.projectId);
        }
        setFocusedPaneId(filesPaneId(project.path));
      }
      navigate({ kind: "root" });
      void deleteSessionRequest(session.id);
    },
    [activeProjectId, navigate, projects, setActiveProjectId, setFocusedPaneId],
  );

  return {
    closePane,
    closeRouteSession,
    createWorktreeSession,
    renameSession,
    restartSession,
    runPaneCommandInWorktree,
    toggleSessionPin,
  };
}

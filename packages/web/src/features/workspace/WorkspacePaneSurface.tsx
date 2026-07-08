import type { IdeCommandConfig, Session } from "@parasor/shared";
import { filesPaneId, gitPaneId } from "@parasor/shared";
import type { IdeEditor } from "../../lib/git-api.js";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import type { WorkspaceRoute } from "../../lib/workspace-route.js";
import type { GitGraphSelection } from "../panes/git-graph/GitGraphPane.js";
import type { FocusedWorkspaceContext } from "./useFocusedWorkspaceContext.js";
import type { useGitWorkflow } from "./useGitWorkflow.js";
import type { WorkspacePaneModel } from "./useWorkspacePaneModel.js";
import { WorkspacePaneRouter } from "./WorkspacePaneRouter.js";

interface WorkspacePaneSurfaceProps {
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectPath: string | null;
  canOpenLocalIde: boolean;
  fileChangeSeq: number;
  focusedWorkspace: FocusedWorkspaceContext;
  gitGraphSelection: GitGraphSelection | null;
  gitWorkflow: ReturnType<typeof useGitWorkflow>;
  hydrated: boolean;
  ideCommands: IdeCommandConfig[];
  isMobile: boolean;
  navigate: (route: WorkspaceRoute, opts?: { replace?: boolean }) => void;
  onBrowserUrlChange?: (paneId: string, url: string) => void;
  onClosePane: (paneId: string) => Promise<void> | void;
  onCopyWorktreePath?: (worktreePath: string) => void;
  onDeleteProject: (projectId: string) => void;
  onGitGraphSelectionChange: (next: GitGraphSelection | null) => void;
  onNewProject: () => void;
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onOpenWorktreeInFinder?: (projectId: string, worktreePath: string) => void;
  onOpenWorktreeInIde?: (
    projectId: string,
    worktreePath: string,
    editor: IdeEditor,
  ) => void;
  onRemoveWorktree?: (
    projectId: string,
    worktreePath: string,
    branch: string,
  ) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
  onRequestClosePane: (
    paneId: string,
    paneKind: "terminal" | "browser",
    title: string,
  ) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onToggleSessionPin: (sessionId: string) => Promise<void> | void;
  paneModel: WorkspacePaneModel;
  projectSessions: Session[];
  setFocusedPaneId: (paneId: string) => void;
}

export function WorkspacePaneSurface({
  activeProjectId,
  activeProjectName,
  activeProjectPath,
  canOpenLocalIde,
  fileChangeSeq,
  focusedWorkspace,
  gitGraphSelection,
  gitWorkflow,
  hydrated,
  ideCommands,
  isMobile,
  navigate,
  onBrowserUrlChange,
  onClosePane,
  onCopyWorktreePath,
  onDeleteProject,
  onGitGraphSelectionChange,
  onNewProject,
  onOpenUrl,
  onOpenWorktreeInFinder,
  onOpenWorktreeInIde,
  onRemoveWorktree,
  onRenameSession,
  onRequestClosePane,
  onRestartSession,
  onToggleSessionPin,
  paneModel,
  projectSessions,
  setFocusedPaneId,
}: WorkspacePaneSurfaceProps) {
  return (
    <WorkspacePaneRouter
      activeProjectId={activeProjectId}
      activeProjectName={activeProjectName}
      activeProjectPath={activeProjectPath}
      activeProjectIsRepo={focusedWorkspace.activeProjectIsRepo}
      allPanes={paneModel.allPanes}
      focusedPane={paneModel.focusedPane}
      focusedWorktreeDirName={focusedWorkspace.worktreeDirName}
      fileChangeSeq={fileChangeSeq}
      gitState={focusedWorkspace.gitState}
      hydrated={hydrated}
      isMobile={isMobile}
      gitMenuActions={
        focusedWorkspace.isGitTab
          ? {
              onPull: () => gitWorkflow.pull(),
              onPush: () => gitWorkflow.push(),
            }
          : undefined
      }
      gitGraphSelection={gitGraphSelection}
      onGitGraphSelectionChange={onGitGraphSelectionChange}
      gitBranchName={focusedWorkspace.branchName}
      commitBusy={gitWorkflow.commitBusy}
      commitError={gitWorkflow.commitError}
      onClearCommitError={gitWorkflow.clearCommitError}
      onSubmitInlineCommit={gitWorkflow.submitInlineCommit}
      sessions={projectSessions}
      onToggleDrawer={() => navigate({ kind: "root" })}
      onClosePane={onClosePane}
      onRequestClosePane={onRequestClosePane}
      onNewProject={onNewProject}
      onOpenUrl={onOpenUrl}
      onBrowserUrlChange={onBrowserUrlChange}
      onRestartSession={onRestartSession}
      onRenameSession={onRenameSession}
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
      onToggleSessionPin={onToggleSessionPin}
      onOpenWorktreeInFinder={onOpenWorktreeInFinder}
      onOpenWorktreeInIde={onOpenWorktreeInIde}
      ideCommands={ideCommands}
      canOpenLocalIde={canOpenLocalIde}
      onCopyWorktreePath={onCopyWorktreePath}
      onRemoveWorktree={onRemoveWorktree}
      onDeleteProject={onDeleteProject}
    />
  );
}

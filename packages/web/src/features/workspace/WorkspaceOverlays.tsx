import type {
  IdeCommandConfig,
  PaneCommandConfig,
  Project,
  ServiceConfig,
} from "@parasor/shared";
import { CommitDialog } from "../../components/overlays/CommitDialog.js";
import { NewProjectDialog } from "../../components/overlays/NewProjectDialog.js";
import {
  NewSessionDialog,
  type NewSessionDialogProps,
} from "../../components/overlays/NewSessionDialog.js";
import { RemoveWorktreeDialog } from "../../components/overlays/RemoveWorktreeDialog.js";
import { RenameWorktreeDialog } from "../../components/overlays/RenameWorktreeDialog.js";
import { WorkItemPickerDialog } from "../../components/overlays/WorkItemPickerDialog.js";
import { CopyToast } from "../../components/toasts/CopyToast.js";
import { SyncToastSet } from "../../components/toasts/SyncToastSet.js";
import { SettingsOverlay } from "../settings/index.js";
import { ClosePaneDialog } from "./ClosePaneDialog.js";
import { DeleteProjectDialog } from "./DeleteProjectDialog.js";
import type { ClosePaneDialogControl } from "./useClosePaneDialog.js";
import type { CommitDialogState } from "./useGitWorkflow.js";
import type { NewSessionDialogControl } from "./useNewSessionDialog.js";
import type { useWorkItemPaneActions } from "./useWorkItemPaneActions.js";
import type {
  RemoveDialogState,
  RenameDialogState,
} from "./useWorktreeWorkflow.js";

interface GitCommitDialogControl {
  commitDialog: CommitDialogState | null;
  commitBusy: boolean;
  commitError: string | null;
  closeCommitDialog: () => void;
  submitCommit: (input: { message: string; paths: string[] }) => Promise<void>;
}

interface WorktreeDialogControl {
  renameDialog: RenameDialogState | null;
  renameBusy: boolean;
  renameError: string | null;
  closeRenameDialog: () => void;
  submitRename: (newBranch: string) => Promise<void>;
  removeDialog: RemoveDialogState | null;
  removeBusy: boolean;
  removeError: string | null;
  closeRemoveDialog: () => void;
  submitRemove: (input: { force: boolean }) => Promise<void>;
}

interface WorkspaceOverlaysProps {
  closePaneDialog: ClosePaneDialogControl;
  createProject: (path: string, name?: string) => void;
  createWorktreeSession: (
    projectId: string,
    input: Parameters<
      NonNullable<NewSessionDialogProps["onCreateWorktreeSession"]>
    >[0],
  ) => Promise<void> | void;
  deleteProject: (projectId: string) => Promise<void> | void;
  deleteTarget: Project | null;
  errorToast: string | null;
  gitCommitDialog: GitCommitDialogControl;
  hostPlatform: NodeJS.Platform | null;
  ideCommands: IdeCommandConfig[];
  isMobile: boolean;
  loadWorktreeLocalFiles: NonNullable<NewSessionDialogProps["loadLocalFiles"]>;
  newProjectDialogOpen: boolean;
  newSessionDialog: NewSessionDialogControl;
  workItemPicker: ReturnType<typeof useWorkItemPaneActions>["picker"];
  paneCommandConfigs: PaneCommandConfig[];
  paneCommands: NewSessionDialogProps["commands"];
  removeDeleteTarget: () => void;
  runPaneCommandInWorktree: (
    projectId: string,
    worktreePath: string,
    command: Parameters<NewSessionDialogProps["onRunCommand"]>[1],
  ) => void;
  serviceConfig: ServiceConfig;
  serviceConfigActions: {
    setDropSizeMaxBytes: (bytes: number) => void;
    setPortDetection: (mode: ServiceConfig["portDetection"]) => void;
    setPreventIdleSleep: (enabled: boolean) => void;
  };
  settingsOpen: boolean;
  updateCustomIdeCommands: (commands: IdeCommandConfig[]) => void;
  updateCustomPaneCommands: NewSessionDialogProps["onCommandsChange"];
  worktreeDialogs: WorktreeDialogControl;
  onCloseNewProject: () => void;
  onCloseSettings: () => void;
  onCreatedProject: () => void;
}

export function WorkspaceOverlays({
  closePaneDialog,
  createProject,
  createWorktreeSession,
  deleteProject,
  deleteTarget,
  errorToast,
  gitCommitDialog,
  hostPlatform,
  ideCommands,
  isMobile,
  loadWorktreeLocalFiles,
  newProjectDialogOpen,
  newSessionDialog,
  workItemPicker,
  paneCommandConfigs,
  paneCommands,
  removeDeleteTarget,
  runPaneCommandInWorktree,
  serviceConfig,
  serviceConfigActions,
  settingsOpen,
  updateCustomIdeCommands,
  updateCustomPaneCommands,
  worktreeDialogs,
  onCloseNewProject,
  onCloseSettings,
  onCreatedProject,
}: WorkspaceOverlaysProps) {
  const newSessionDialogTarget = newSessionDialog.target;
  const newSessionDialogContext = newSessionDialog.context;

  return (
    <>
      <NewProjectDialog
        open={newProjectDialogOpen}
        onClose={onCloseNewProject}
        onCreate={(path, name) => {
          onCreatedProject();
          return createProject(path, name);
        }}
        isMobile={isMobile}
      />

      <SettingsOverlay
        open={settingsOpen}
        onClose={onCloseSettings}
        server={{
          serviceConfig,
          hostPlatform,
          onPreventIdleSleepChange: serviceConfigActions.setPreventIdleSleep,
          onPortDetectionChange: serviceConfigActions.setPortDetection,
          onDropSizeMaxBytesChange: serviceConfigActions.setDropSizeMaxBytes,
          ideCommands,
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
          onCancel={removeDeleteTarget}
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

      {newSessionDialogTarget && newSessionDialogContext && (
        <NewSessionDialog
          open
          project={newSessionDialogContext.project}
          worktree={newSessionDialogContext.worktree}
          commands={paneCommands}
          commandConfigs={paneCommandConfigs}
          isMobile={isMobile}
          loadLocalFiles={loadWorktreeLocalFiles}
          onClose={newSessionDialog.close}
          onCommandsChange={updateCustomPaneCommands}
          onCreateWorktreeSession={(input) =>
            createWorktreeSession(newSessionDialogTarget.projectId, input)
          }
          onRunCommand={(path, command) =>
            runPaneCommandInWorktree(
              newSessionDialogTarget.projectId,
              path,
              command,
            )
          }
        />
      )}

      {workItemPicker.target && (
        <WorkItemPickerDialog
          items={workItemPicker.items}
          busy={workItemPicker.busy}
          error={workItemPicker.error}
          onClose={workItemPicker.close}
          onCreate={workItemPicker.create}
          onOpen={workItemPicker.select}
        />
      )}

      {worktreeDialogs.renameDialog && (
        <RenameWorktreeDialog
          open
          currentBranch={worktreeDialogs.renameDialog.currentBranch}
          busy={worktreeDialogs.renameBusy}
          error={worktreeDialogs.renameError}
          onClose={worktreeDialogs.closeRenameDialog}
          onSubmit={worktreeDialogs.submitRename}
        />
      )}

      {worktreeDialogs.removeDialog && (
        <RemoveWorktreeDialog
          open
          branch={worktreeDialogs.removeDialog.branch}
          worktreePath={worktreeDialogs.removeDialog.worktreePath}
          dirtyCount={worktreeDialogs.removeDialog.dirtyCount}
          orphan={worktreeDialogs.removeDialog.orphan === true}
          busy={worktreeDialogs.removeBusy}
          error={worktreeDialogs.removeError}
          onClose={worktreeDialogs.closeRemoveDialog}
          onSubmit={worktreeDialogs.submitRemove}
        />
      )}

      <CommitDialog
        open={gitCommitDialog.commitDialog !== null}
        busy={gitCommitDialog.commitBusy}
        error={gitCommitDialog.commitError}
        branchName={gitCommitDialog.commitDialog?.branchName ?? null}
        files={gitCommitDialog.commitDialog?.files ?? []}
        isMobile={isMobile}
        onClose={gitCommitDialog.closeCommitDialog}
        onCommit={gitCommitDialog.submitCommit}
      />

      <SyncToastSet />
      <CopyToast />
    </>
  );
}

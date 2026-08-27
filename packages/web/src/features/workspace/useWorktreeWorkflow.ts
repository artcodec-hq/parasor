import { useCallback, useState } from "react";
import { showCopyToast } from "../../lib/copy-toast.js";
import {
  GitOperationError,
  type IdeEditor,
  openWorktreeInIde,
  openWorktreeInOs,
  removeWorktree,
  renameWorktree,
} from "../../lib/git-api.js";
import { dismissSyncToast, showSyncToast } from "../../lib/sync-toast.js";
import { writeTerminalInternalClipboard } from "../../lib/terminal-internal-clipboard.js";

export interface RenameDialogState {
  projectId: string;
  worktreePath: string;
  currentBranch: string;
}

export interface RemoveDialogState {
  projectId: string;
  worktreePath: string;
  branch: string;
  dirtyCount: number;
  /**
   * `true` when the worktree path is missing on disk. Causes the dialog to
   * skip the "uncommitted files lost" confirmation (nothing to lose) and
   * relabel the action as a prune.
   */
  orphan?: boolean;
}

interface UseWorktreeWorkflowResult {
  renameDialog: RenameDialogState | null;
  renameBusy: boolean;
  renameError: string | null;
  openRenameDialog: (state: RenameDialogState) => void;
  closeRenameDialog: () => void;
  submitRename: (newBranch: string) => Promise<void>;

  removeDialog: RemoveDialogState | null;
  removeBusy: boolean;
  removeError: string | null;
  openRemoveDialog: (state: RemoveDialogState) => void;
  closeRemoveDialog: () => void;
  submitRemove: (input: { force: boolean }) => Promise<void>;

  copyWorktreePath: (path: string) => void;
  openWorktreeInFinder: (input: {
    projectId: string;
    worktreePath: string;
  }) => void;
  openWorktreeInIde: (input: {
    projectId: string;
    worktreePath: string;
    editor: IdeEditor;
  }) => void;
}

export function useWorktreeWorkflow(): UseWorktreeWorkflowResult {
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(
    null,
  );
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [removeDialog, setRemoveDialog] = useState<RemoveDialogState | null>(
    null,
  );
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const openRenameDialog = useCallback((state: RenameDialogState) => {
    setRenameError(null);
    setRenameDialog(state);
  }, []);

  const closeRenameDialog = useCallback(() => {
    if (renameBusy) return;
    setRenameDialog(null);
    setRenameError(null);
  }, [renameBusy]);

  const submitRename = useCallback(
    async (newBranch: string) => {
      const dialog = renameDialog;
      if (!dialog) return;
      setRenameBusy(true);
      setRenameError(null);
      try {
        await renameWorktree({
          projectId: dialog.projectId,
          worktreePath: dialog.worktreePath,
          newBranch,
        });
        showSyncToast({
          tone: "ok",
          title: "Branch renamed",
          sub: `${dialog.currentBranch} -> ${newBranch}`,
          mono: true,
          durationMs: 3000,
        });
        setRenameDialog(null);
      } catch (error) {
        const message =
          error instanceof GitOperationError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Rename failed";
        setRenameError(message);
      } finally {
        setRenameBusy(false);
      }
    },
    [renameDialog],
  );

  const openRemoveDialog = useCallback((state: RemoveDialogState) => {
    setRemoveError(null);
    setRemoveDialog(state);
  }, []);

  const closeRemoveDialog = useCallback(() => {
    if (removeBusy) return;
    setRemoveDialog(null);
    setRemoveError(null);
  }, [removeBusy]);

  const submitRemove = useCallback(
    async ({ force }: { force: boolean }) => {
      const dialog = removeDialog;
      if (!dialog) return;
      setRemoveBusy(true);
      setRemoveError(null);
      try {
        await removeWorktree({
          projectId: dialog.projectId,
          worktreePath: dialog.worktreePath,
          ...(force === true && { force: true }),
        });
        showSyncToast({
          tone: "ok",
          title: dialog.orphan ? "Stale worktree pruned" : "Worktree removed",
          sub: dialog.branch,
          mono: true,
          durationMs: 3000,
        });
        setRemoveDialog(null);
      } catch (error) {
        const message =
          error instanceof GitOperationError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Remove failed";
        setRemoveError(message);
      } finally {
        setRemoveBusy(false);
      }
    },
    [removeDialog],
  );

  const copyWorktreePath = useCallback((path: string) => {
    void copyToClipboard(path)
      .then((ok) => {
        showCopyToast(ok ? "Copied path" : "Copy failed");
      })
      .catch(() => {
        showCopyToast("Copy failed");
      });
  }, []);

  const openWorktreeInFinder = useCallback(
    ({
      projectId,
      worktreePath,
    }: {
      projectId: string;
      worktreePath: string;
    }) => {
      const id = `open-os:${worktreePath}`;
      showSyncToast({
        id,
        tone: "working",
        title: "Opening in file manager",
        sub: worktreePath,
        mono: true,
      });
      void openWorktreeInOs({ projectId, worktreePath })
        .then(() => {
          dismissSyncToast(id);
        })
        .catch((error) => {
          const message =
            error instanceof GitOperationError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Open failed";
          showSyncToast({
            id,
            tone: "err",
            title: "Could not open in file manager",
            sub: message,
            actions: [
              { label: "Dismiss", onSelect: () => dismissSyncToast(id) },
            ],
          });
        });
    },
    [],
  );

  const launchWorktreeIde = useCallback(
    ({
      projectId,
      worktreePath,
      editor,
    }: {
      projectId: string;
      worktreePath: string;
      editor: IdeEditor;
    }) => {
      const label = editor === "cursor" ? "Cursor" : "VS Code";
      const id = `open-ide:${editor}:${worktreePath}`;
      showSyncToast({
        id,
        tone: "working",
        title: `Opening in ${label}`,
        sub: worktreePath,
        mono: true,
      });
      void openWorktreeInIde({ projectId, worktreePath, editor })
        .then(() => {
          dismissSyncToast(id);
        })
        .catch((error) => {
          const message =
            error instanceof GitOperationError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Open failed";
          showSyncToast({
            id,
            tone: "err",
            title: `Could not open in ${label}`,
            sub: message,
            actions: [
              { label: "Dismiss", onSelect: () => dismissSyncToast(id) },
            ],
          });
        });
    },
    [],
  );

  return {
    renameDialog,
    renameBusy,
    renameError,
    openRenameDialog,
    closeRenameDialog,
    submitRename,

    removeDialog,
    removeBusy,
    removeError,
    openRemoveDialog,
    closeRemoveDialog,
    submitRemove,

    copyWorktreePath,
    openWorktreeInFinder,
    openWorktreeInIde: launchWorktreeIde,
  };
}

async function copyToClipboard(value: string): Promise<boolean> {
  const internalWritten = writeTerminalInternalClipboard(value);
  const nativeWritten = await copyToNativeClipboard(value);
  return internalWritten || nativeWritten;
}

async function copyToNativeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the textarea path.
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

import type { GitState } from "@parasor/shared";
import { useCallback, useRef, useState } from "react";
import {
  commitChanges,
  fetchRemote,
  GitOperationError,
  pullBranch,
  pushBranch,
} from "../../lib/git-api.js";
import { dismissSyncToast, showSyncToast } from "../../lib/sync-toast.js";

export interface CommitDialogState {
  projectId: string;
  worktreePath: string;
  branchName: string | null;
  files: ReadonlyArray<{ path: string; status: string }>;
}

interface UseGitWorkflowInput {
  activeProjectId: string | null;
  focusedWorktreePath: string | null;
  focusedWorktreeName: string | null;
  gitState: GitState | null;
}

interface UseGitWorkflowResult {
  commitDialog: CommitDialogState | null;
  commitBusy: boolean;
  commitError: string | null;
  closeCommitDialog: () => void;
  submitCommit: (input: { message: string; paths: string[] }) => Promise<void>;
  /**
   * Inline equivalent of {@link submitCommit} for the in-pane
   * UncommittedPane. Skips the dialog lifecycle (no dialog open/close), so
   * the same workflow can drive both surfaces.
   */
  submitInlineCommit: (input: {
    message: string;
    paths: string[];
  }) => Promise<void>;
  /** Resets `commitError` set by the inline path. */
  clearCommitError: () => void;
  fetch: () => void;
  pull: (options?: { rebase?: boolean }) => void;
  push: (options?: { setUpstream?: boolean }) => void;
}

export function useGitWorkflow({
  activeProjectId,
  focusedWorktreePath,
  focusedWorktreeName,
  gitState,
}: UseGitWorkflowInput): UseGitWorkflowResult {
  const [commitDialog, setCommitDialog] = useState<CommitDialogState | null>(
    null,
  );
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const ahead = gitState?.ahead ?? 0;
  const behind = gitState?.behind ?? 0;
  const branchName = gitState?.branch ?? focusedWorktreeName ?? null;

  const pullRef = useRef<((options?: { rebase?: boolean }) => void) | null>(
    null,
  );

  const closeCommitDialog = useCallback(() => {
    if (commitBusy) return;
    setCommitDialog(null);
    setCommitError(null);
  }, [commitBusy]);

  const runCommit = useCallback(async function runCommit(
    projectId: string,
    worktreePath: string,
    branchLabel: string | null,
    input: { message: string; paths: string[] },
  ): Promise<boolean> {
    setCommitBusy(true);
    setCommitError(null);
    try {
      await commitChanges({
        projectId,
        worktreePath,
        message: input.message,
        paths: input.paths,
      });
      showSyncToast({
        tone: "ok",
        title: "Commit created",
        sub: `${branchLabel ?? "branch"} · ${input.paths.length} file${input.paths.length === 1 ? "" : "s"}`,
        mono: true,
        durationMs: 4000,
      });
      return true;
    } catch (error) {
      const msg =
        error instanceof GitOperationError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Commit failed";
      setCommitError(msg);
      return false;
    } finally {
      setCommitBusy(false);
    }
  }, []);

  const submitCommit = useCallback(
    async (input: { message: string; paths: string[] }) => {
      if (!commitDialog) return;
      const ok = await runCommit(
        commitDialog.projectId,
        commitDialog.worktreePath,
        commitDialog.branchName,
        input,
      );
      if (ok) setCommitDialog(null);
    },
    [commitDialog, runCommit],
  );

  const submitInlineCommit = useCallback(
    async (input: { message: string; paths: string[] }) => {
      if (!activeProjectId || !focusedWorktreePath) return;
      await runCommit(activeProjectId, focusedWorktreePath, branchName, input);
    },
    [activeProjectId, focusedWorktreePath, branchName, runCommit],
  );

  const clearCommitError = useCallback(() => {
    setCommitError(null);
  }, []);

  const push = useCallback(
    (options?: { setUpstream?: boolean }) => {
      if (!activeProjectId || !focusedWorktreePath) return;
      const branchLabel = branchName ?? "branch";
      const id = `git-push:${focusedWorktreePath}`;
      showSyncToast({
        id,
        tone: "working",
        title: `Pushing ${branchLabel}`,
        sub:
          ahead > 0
            ? `origin · ${ahead} commit${ahead === 1 ? "" : "s"}`
            : "origin",
        mono: true,
      });
      void pushBranch({
        projectId: activeProjectId,
        worktreePath: focusedWorktreePath,
        ...(options?.setUpstream === true && { setUpstream: true }),
      })
        .then(() => {
          showSyncToast({
            id,
            tone: "ok",
            title: "Push complete",
            sub: `${branchLabel} · pushed to origin`,
            mono: true,
            durationMs: 4000,
          });
        })
        .catch((error) => {
          const message =
            error instanceof GitOperationError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Push failed";
          const isNonFastForward = /non-fast-forward|rejected/i.test(message);
          showSyncToast({
            id,
            tone: "err",
            title: isNonFastForward
              ? "Push rejected -- non-fast-forward"
              : "Push failed",
            sub: message,
            actions: isNonFastForward
              ? [
                  {
                    label: "Pull --rebase",
                    kind: "primary",
                    onSelect: () => {
                      dismissSyncToast(id);
                      pullRef.current?.({ rebase: true });
                    },
                  },
                  {
                    label: "Dismiss",
                    onSelect: () => dismissSyncToast(id),
                  },
                ]
              : [
                  {
                    label: "Dismiss",
                    onSelect: () => dismissSyncToast(id),
                  },
                ],
          });
        });
    },
    [activeProjectId, focusedWorktreePath, branchName, ahead],
  );

  const pull = useCallback(
    (options?: { rebase?: boolean }) => {
      if (!activeProjectId || !focusedWorktreePath) return;
      const branchLabel = branchName ?? "branch";
      const id = `git-pull:${focusedWorktreePath}`;
      showSyncToast({
        id,
        tone: "working",
        title: `Pulling ${branchLabel}`,
        sub:
          behind > 0
            ? `origin · ${behind} commit${behind === 1 ? "" : "s"}`
            : "origin",
        mono: true,
      });
      void pullBranch({
        projectId: activeProjectId,
        worktreePath: focusedWorktreePath,
        ...(options?.rebase === true && { rebase: true }),
      })
        .then(() => {
          showSyncToast({
            id,
            tone: "ok",
            title: "Up to date",
            sub: `${branchLabel} · pulled from origin`,
            mono: true,
            durationMs: 4000,
          });
        })
        .catch((error) => {
          const message =
            error instanceof GitOperationError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Pull failed";
          showSyncToast({
            id,
            tone: "err",
            title: "Pull failed",
            sub: message,
            actions: [
              {
                label: "Dismiss",
                onSelect: () => dismissSyncToast(id),
              },
            ],
          });
        });
    },
    [activeProjectId, focusedWorktreePath, branchName, behind],
  );
  pullRef.current = pull;

  const fetch = useCallback(() => {
    if (!activeProjectId || !focusedWorktreePath) return;
    const id = `git-fetch:${focusedWorktreePath}`;
    showSyncToast({
      id,
      tone: "working",
      title: "Fetching origin",
      sub: branchName ?? undefined,
      mono: true,
    });
    void fetchRemote({
      projectId: activeProjectId,
      worktreePath: focusedWorktreePath,
    })
      .then(() => {
        showSyncToast({
          id,
          tone: "ok",
          title: "Fetched origin",
          mono: true,
          durationMs: 3000,
        });
      })
      .catch((error) => {
        const message =
          error instanceof GitOperationError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Fetch failed";
        showSyncToast({
          id,
          tone: "err",
          title: "Fetch failed",
          sub: message,
          actions: [
            {
              label: "Dismiss",
              onSelect: () => dismissSyncToast(id),
            },
          ],
        });
      });
  }, [activeProjectId, focusedWorktreePath, branchName]);

  return {
    commitDialog,
    commitBusy,
    commitError,
    closeCommitDialog,
    submitCommit,
    submitInlineCommit,
    clearCommitError,
    fetch,
    pull,
    push,
  };
}

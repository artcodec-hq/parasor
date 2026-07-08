import type { GitState, Worktree } from "@parasor/shared";
import { useCallback } from "react";
import type { IdeEditor } from "../../lib/git-api.js";
import type { useWorktreeWorkflow } from "./useWorktreeWorkflow.js";

interface UseWorkspaceWorktreeActionsOptions {
  gitStates: Record<string, Record<string, GitState | null>>;
  worktreeWorkflow: ReturnType<typeof useWorktreeWorkflow>;
  worktrees: Record<string, Worktree[]>;
}

export function useWorkspaceWorktreeActions({
  gitStates,
  worktreeWorkflow,
  worktrees,
}: UseWorkspaceWorktreeActionsOptions) {
  const openWorktreeInFinder = useCallback(
    (projectId: string, worktreePath: string) => {
      worktreeWorkflow.openWorktreeInFinder({ projectId, worktreePath });
    },
    [worktreeWorkflow],
  );

  const openWorktreeInIde = useCallback(
    (projectId: string, worktreePath: string, editor: IdeEditor) => {
      worktreeWorkflow.openWorktreeInIde({ projectId, worktreePath, editor });
    },
    [worktreeWorkflow],
  );

  const copyWorktreePath = useCallback(
    (worktreePath: string) => {
      worktreeWorkflow.copyWorktreePath(worktreePath);
    },
    [worktreeWorkflow],
  );

  const removeWorktree = useCallback(
    (projectId: string, worktreePath: string, fallback: string) => {
      const gitState = gitStates[projectId]?.[worktreePath];
      const branch =
        gitState?.branch && gitState.branch.length > 0
          ? gitState.branch
          : fallback;
      const dirtyCount = gitState?.dirtyCount ?? 0;
      const wt = worktrees[projectId]?.find((w) => w.path === worktreePath);
      worktreeWorkflow.openRemoveDialog({
        projectId,
        worktreePath,
        branch,
        dirtyCount,
        ...(wt?.orphan === true && { orphan: true }),
      });
    },
    [gitStates, worktreeWorkflow, worktrees],
  );

  return {
    copyWorktreePath,
    openWorktreeInFinder,
    openWorktreeInIde,
    removeWorktree,
  };
}

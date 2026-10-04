import type { GitState, PaneEntry, Project, Worktree } from "@parasor/shared";
import { useMemo } from "react";
import { resolveWorktreeDirName } from "../../lib/worktree-dir-name.js";

interface UseFocusedWorkspaceContextOptions {
  activeProject: Project | null;
  activeProjectId: string | null;
  focusedPane: PaneEntry | null;
  gitStates: Record<string, Record<string, GitState | null>>;
  worktrees: Record<string, Worktree[]>;
}

export interface FocusedWorkspaceContext {
  activeProjectIsRepo: boolean;
  branchName: string | null;
  gitState: GitState | null;
  isGitTab: boolean;
  worktreeDirName: string | null;
  worktreeName: string | null;
  worktreePath: string | null;
}

export function useFocusedWorkspaceContext({
  activeProject,
  activeProjectId,
  focusedPane,
  gitStates,
  worktrees,
}: UseFocusedWorkspaceContextOptions): FocusedWorkspaceContext {
  return useMemo(() => {
    const worktreePath = focusedPane?.worktreePath ?? null;
    const gitState =
      activeProjectId && worktreePath
        ? (gitStates[activeProjectId]?.[worktreePath] ?? null)
        : null;
    const worktreeRecord =
      activeProjectId && worktreePath
        ? (worktrees[activeProjectId]?.find((w) => w.path === worktreePath) ??
          null)
        : null;
    const activeProjectIsRepo = activeProject
      ? gitStates[activeProject.id]?.[activeProject.path]?.isRepo !== false
      : true;

    let worktreeName: string | null = null;
    let worktreeDirName: string | null = null;
    if (focusedPane && activeProject) {
      const branch = gitState?.branch ?? worktreeRecord?.branch ?? null;
      const fallbackName =
        focusedPane.worktreePath === activeProject.path
          ? "main"
          : (focusedPane.worktreePath.replace(/\/+$/, "").split("/").pop() ??
            focusedPane.worktreePath);
      worktreeName = branch && branch.length > 0 ? branch : fallbackName;
      worktreeDirName = resolveWorktreeDirName(
        focusedPane.worktreePath,
        activeProject.path,
        activeProjectIsRepo,
      );
    }

    return {
      activeProjectIsRepo,
      branchName: gitState?.branch ?? null,
      gitState,
      isGitTab: focusedPane?.state.kind === "git",
      worktreeDirName,
      worktreeName,
      worktreePath,
    };
  }, [activeProject, activeProjectId, focusedPane, gitStates, worktrees]);
}

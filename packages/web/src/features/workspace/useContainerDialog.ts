import type { GitState, Project } from "@parasor/shared";
import { useCallback, useMemo, useState } from "react";
import { resolveWorktreeDirName } from "../../lib/worktree-dir-name.js";

export interface ContainerDialogTarget {
  projectId: string;
  worktreeId: string;
  worktreePath: string;
}

export interface ContainerDialogContext {
  project: { id: string; name: string; path: string };
  worktree: { id: string; name: string; path: string };
}

export interface ContainerDialogControl {
  /** Raw target -- non-null while the dialog should be visible. */
  target: ContainerDialogTarget | null;
  /** Resolved project + worktree dir-name context, or `null` when the
   * target's project cannot be found (treat as "do not render"). */
  context: ContainerDialogContext | null;
  /** Open the dialog for the given worktree. `worktreeId` may carry a
   * `wt:` prefix from sidebar IDs -- the prefix is stripped before
   * setting `worktreePath`, matching the inline implementation. */
  open: (projectId: string, worktreeId: string) => void;
  /** Dismiss the dialog. */
  close: () => void;
}

interface UseContainerDialogInput {
  projects: readonly Project[];
  gitStates: Record<string, Record<string, GitState | null>>;
}

/**
 * "Open container" dialog state plus the project/worktree derivation that
 * feeds {@link OpenContainerDialog}. Pure aside from the {@link useState}
 * hook -- the project lookup and `isRepo` resolution are reactive on the
 * passed {@link UseContainerDialogInput.projects} / `gitStates`.
 *
 * The mobile sidebar-search close side-effect (visible at the original
 * call site) is intentionally NOT folded in here -- the caller drives it
 * after a successful {@link open} because it touches the sibling
 * `useSidebarSearch` hook.
 */
export function useContainerDialog({
  projects,
  gitStates,
}: UseContainerDialogInput): ContainerDialogControl {
  const [target, setTarget] = useState<ContainerDialogTarget | null>(null);

  const open = useCallback((projectId: string, worktreeId: string) => {
    const path = worktreeId.startsWith("wt:")
      ? worktreeId.slice(3)
      : worktreeId;
    setTarget({ projectId, worktreeId, worktreePath: path });
  }, []);

  const close = useCallback(() => {
    setTarget(null);
  }, []);

  const context = useMemo<ContainerDialogContext | null>(() => {
    if (!target) return null;
    const project = projects.find((p) => p.id === target.projectId);
    if (!project) return null;
    const dialogProjectIsRepo =
      gitStates[project.id]?.[project.path]?.isRepo !== false;
    const wtName = resolveWorktreeDirName(
      target.worktreePath,
      project.path,
      dialogProjectIsRepo,
    );
    return {
      project: { id: project.id, name: project.name, path: project.path },
      worktree: {
        id: target.worktreeId,
        name: wtName,
        path: target.worktreePath,
      },
    };
  }, [target, projects, gitStates]);

  return { target, context, open, close };
}

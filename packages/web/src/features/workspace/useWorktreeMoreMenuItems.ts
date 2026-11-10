import type { IdeCommandConfig, PaneEntry } from "@parasor/shared";
import { useMemo } from "react";
import type { PaMenuItem } from "../../components/primitives/PaMenu.js";
import type { IdeEditor } from "../../lib/git-api.js";

interface UseWorktreeMoreMenuItemsOptions {
  activeProjectId: string | null;
  activeProjectIsRepo: boolean;
  activeProjectPath: string | null;
  canOpenLocalIde: boolean;
  focusedPane: PaneEntry | null;
  focusedWorktreeDirName: string | null;
  ideCommands: IdeCommandConfig[];
  onCopyWorktreePath?: (worktreePath: string) => void;
  onDeleteProject?: (projectId: string) => void;
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
}

export function useWorktreeMoreMenuItems({
  activeProjectId,
  activeProjectIsRepo,
  activeProjectPath,
  canOpenLocalIde,
  focusedPane,
  focusedWorktreeDirName,
  ideCommands,
  onCopyWorktreePath,
  onDeleteProject,
  onOpenWorktreeInFinder,
  onOpenWorktreeInIde,
  onRemoveWorktree,
}: UseWorktreeMoreMenuItemsOptions): PaMenuItem[] {
  return useMemo<PaMenuItem[]>(() => {
    if (!focusedPane || !activeProjectId) return [];
    const worktreePath = focusedPane.worktreePath;
    const isProjectRootPane =
      !!activeProjectPath && worktreePath === activeProjectPath;
    const items: PaMenuItem[] = [];
    if (onCopyWorktreePath) {
      items.push({
        id: "copy-path",
        label: "Copy path",
        onSelect: () => onCopyWorktreePath(worktreePath),
      });
    }
    if (onOpenWorktreeInFinder) {
      items.push({
        id: "open-finder",
        label: "Open in Finder",
        separatorBefore: items.length > 0,
        onSelect: () => onOpenWorktreeInFinder(activeProjectId, worktreePath),
      });
    }
    if (onOpenWorktreeInIde) {
      const disabled = !canOpenLocalIde;
      const title = disabled
        ? "Available when parasor is opened from localhost on the server machine"
        : undefined;
      const separatorBefore = items.length > 0 && !onOpenWorktreeInFinder;
      items.push(
        {
          id: "open-cursor",
          label: "Open in Cursor",
          disabled,
          title,
          separatorBefore,
          onSelect: () =>
            onOpenWorktreeInIde(activeProjectId, worktreePath, "cursor"),
        },
        {
          id: "open-vscode",
          label: "Open in VS Code",
          disabled,
          title,
          onSelect: () =>
            onOpenWorktreeInIde(activeProjectId, worktreePath, "vscode"),
        },
      );
      for (const command of ideCommands) {
        items.push({
          id: `open-custom-ide:${command.id}`,
          label: `Open in ${command.label}`,
          disabled,
          title,
          onSelect: () =>
            onOpenWorktreeInIde(activeProjectId, worktreePath, command.id),
        });
      }
    }
    if (!isProjectRootPane && activeProjectIsRepo && onRemoveWorktree) {
      items.push({
        id: "remove",
        label: "Remove worktree…",
        separatorBefore: items.length > 0,
        tone: "danger",
        onSelect: () =>
          onRemoveWorktree(
            activeProjectId,
            worktreePath,
            focusedWorktreeDirName ?? "main",
          ),
      });
    }
    if (isProjectRootPane && onDeleteProject) {
      items.push({
        id: "close-project",
        label: "Close project…",
        separatorBefore: items.length > 0,
        onSelect: () => onDeleteProject(activeProjectId),
      });
    }
    return items;
  }, [
    activeProjectId,
    activeProjectIsRepo,
    activeProjectPath,
    canOpenLocalIde,
    focusedPane,
    focusedWorktreeDirName,
    ideCommands,
    onCopyWorktreePath,
    onDeleteProject,
    onOpenWorktreeInFinder,
    onOpenWorktreeInIde,
    onRemoveWorktree,
  ]);
}

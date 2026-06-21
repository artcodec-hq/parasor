import type { HTMLAttributes } from "react";
import type {
  SidebarProject,
  SidebarSelection,
  SidebarWorktree,
} from "../model/types.js";
import { WorktreeRow } from "./WorktreeRow.js";

interface ProjectGroupProps {
  project: SidebarProject;
  selection: SidebarSelection;
  onSelectWorktree?: (projectId: string, worktreeId: string) => void;
  onSelectChild?: (
    projectId: string,
    worktreeId: string,
    childId: string,
  ) => void;
  onOpenContainer?: (projectId: string, worktreeId: string) => void;
  onToggleChildPin?: (childId: string) => void;
  worktreeOpen?: Record<string, boolean>;
  onWorktreeOpenChange?: (
    projectId: string,
    worktreePath: string,
    open: boolean,
  ) => void;
  /**
   * When set, terminal/browser children inside each worktree become
   * draggable. Receives the worktree path and the new child id ordering.
   */
  onReorderPanes?: (
    projectId: string,
    worktreePath: string,
    childIds: string[],
  ) => void;
  /**
   * dnd-kit listeners (and optional aria-label) spread onto the project
   * header bar so the header doubles as the drag handle. Keeping the
   * handle scoped to the header -- not the entire ProjectGroup -- prevents
   * worktree/pane interactions inside from leaking up as project drags.
   */
  dragHandleProps?: HTMLAttributes<HTMLDivElement>;
  /**
   * When true, the group ignores its local collapse state and stays
   * expanded. Used by sidebar filter mode so matched worktrees/children
   * are always visible regardless of the user's prior collapse choice.
   */
  forceOpen?: boolean;
}

export function ProjectGroup({
  project,
  selection,
  onSelectWorktree,
  onSelectChild,
  onOpenContainer,
  onToggleChildPin,
  worktreeOpen,
  onWorktreeOpenChange,
  onReorderPanes,
  dragHandleProps,
  forceOpen = false,
}: ProjectGroupProps) {
  const worktrees: SidebarWorktree[] =
    project.worktrees.length > 0
      ? project.worktrees
      : [
          {
            id: `wt:${project.path}`,
            name: project.isRepo === false ? "root" : "main",
            path: project.path,
            active: true,
            dirty: 0,
            ahead: 0,
            behind: 0,
            children: [],
            hasWorkingChild: false,
            hasAlertChild: false,
          },
        ];

  return (
    <>
      {worktrees.map((wt, index) => {
        const root = wt.path === project.path;
        return (
          <WorktreeRow
            key={wt.id}
            project={project}
            worktree={wt}
            selection={selection}
            displayName={root ? project.name : wt.name}
            forceOpen={forceOpen}
            isProjectRoot={root}
            showTopBorder={index === 0}
            dragHandleProps={root && index === 0 ? dragHandleProps : undefined}
            onSelectWorktree={onSelectWorktree}
            onSelectChild={onSelectChild}
            onOpenContainer={onOpenContainer}
            onToggleChildPin={onToggleChildPin}
            worktreeOpen={worktreeOpen}
            onWorktreeOpenChange={onWorktreeOpenChange}
            onReorderPanes={onReorderPanes}
          />
        );
      })}
    </>
  );
}

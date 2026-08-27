import type { HTMLAttributes } from "react";
import type {
  SidebarProject,
  SidebarSelection,
  SidebarWorktree,
} from "../model/types.js";
import { useProjectDisclosure } from "./project-disclosure.js";
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
  onNewSession?: (projectId: string, worktreeId: string) => void;
  onPruneStaleWorktree?: (
    projectId: string,
    worktreePath: string,
    branch: string,
  ) => void;
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
  onCloseProject?: (projectId: string) => void;
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
  onNewSession,
  onPruneStaleWorktree,
  onToggleChildPin,
  worktreeOpen,
  onWorktreeOpenChange,
  onReorderPanes,
  onCloseProject,
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
  const projectWorktree =
    worktrees.find((worktree) => worktree.path === project.path) ??
    worktrees[0];
  const { open: projectOpen, toggle: toggleProjectOpen } = useProjectDisclosure(
    project.path,
    forceOpen,
    worktreeOpen,
    (path, open) => onWorktreeOpenChange?.(project.id, path, open),
  );
  const visibleWorktrees = projectOpen ? worktrees : [projectWorktree];

  return (
    <>
      {visibleWorktrees.map((wt, index) => {
        const root = wt.id === projectWorktree.id;
        return (
          <WorktreeRow
            key={wt.id}
            project={project}
            worktree={wt}
            selection={selection}
            displayName={root ? project.name : wt.name}
            isProjectRoot={root}
            showTopBorder={index === 0}
            dragHandleProps={root && index === 0 ? dragHandleProps : undefined}
            onSelectWorktree={onSelectWorktree}
            onSelectChild={onSelectChild}
            onNewSession={onNewSession}
            onPruneStaleWorktree={onPruneStaleWorktree}
            onToggleChildPin={onToggleChildPin}
            disclosure={
              root
                ? { open: projectOpen, onToggle: toggleProjectOpen }
                : undefined
            }
            showChildren={projectOpen}
            onReorderPanes={onReorderPanes}
            onCloseProject={onCloseProject}
          />
        );
      })}
    </>
  );
}

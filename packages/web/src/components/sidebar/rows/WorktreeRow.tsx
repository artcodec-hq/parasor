import type { HTMLAttributes } from "react";
import { PaGlyph } from "../../primitives/index.js";
import type {
  SidebarProject,
  SidebarSelection,
  SidebarWorktree,
} from "../model/types.js";
import {
  SidebarRow,
  SidebarRowActionButton,
  SidebarRowIcon,
  SidebarRowLabel,
} from "../primitives/index.js";
import { WorktreeChildren } from "./WorktreeChildren.js";
import { WorktreeRowActions } from "./WorktreeRowActions.js";
import { useWorktreeDisclosure } from "./worktree-disclosure.js";

interface WorktreeRowProps {
  project: SidebarProject;
  worktree: SidebarWorktree;
  selection: SidebarSelection;
  displayName?: string;
  forceOpen?: boolean;
  isProjectRoot?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLDivElement>;
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
  onReorderPanes?: (
    projectId: string,
    worktreePath: string,
    childIds: string[],
  ) => void;
}

export function WorktreeRow({
  project,
  worktree,
  selection,
  displayName,
  forceOpen = false,
  isProjectRoot = false,
  dragHandleProps,
  onSelectWorktree,
  onSelectChild,
  onOpenContainer,
  onToggleChildPin,
  worktreeOpen,
  onWorktreeOpenChange,
  onReorderPanes,
}: WorktreeRowProps) {
  const { open: isOpen, toggle: toggleOpen } = useWorktreeDisclosure(
    worktree.path,
    forceOpen,
    worktreeOpen,
    (path, open) => onWorktreeOpenChange?.(project.id, path, open),
  );
  const worktreeFocused =
    selection.selectedWorktreeId === worktree.id &&
    selection.selectedChildId === null;
  // When the project root isn't a git repo, git-flavored glyphs
  // (worktreeActive/Inactive) misrepresent the row. Render a plain
  // folder so the sidebar matches the `root` label.
  const nonRepo = project.isRepo === false;
  const label = displayName ?? worktree.name;
  const dirtyTitle =
    worktree.dirty > 0
      ? `${worktree.dirty} uncommitted change${worktree.dirty === 1 ? "" : "s"}`
      : undefined;
  const dirtyDotClass =
    worktree.dirty > 0 ? "bg-[var(--theme-git-modified)]" : "";
  const lineageTitle = worktree.lineage
    ? formatLineageTitle(worktree.lineage)
    : null;

  return (
    <div className="border-t border-border">
      <SidebarRow
        selected={worktreeFocused}
        rootProps={dragHandleProps}
        className="group select-none"
      >
        <SidebarRowActionButton
          onClick={toggleOpen}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.stopPropagation();
            }
          }}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${label}`}
        >
          <span
            aria-hidden
            className={`transition-transform duration-[120ms] ${
              isOpen ? "rotate-90" : "rotate-0"
            }`}
          >
            <PaGlyph.disclosure />
          </span>
        </SidebarRowActionButton>
        {!isProjectRoot && (
          <SidebarRowIcon
            tone={worktreeFocused ? "accent" : "secondary"}
            className="relative"
          >
            {nonRepo ? (
              <PaGlyph.folder />
            ) : worktree.active ? (
              <PaGlyph.worktreeActive />
            ) : (
              <PaGlyph.worktreeInactive />
            )}
          </SidebarRowIcon>
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          aria-label={dirtyTitle ? `${label}, ${dirtyTitle}` : undefined}
          onClick={() => onSelectWorktree?.(project.id, worktree.id)}
        >
          <SidebarRowLabel
            title={dirtyTitle}
            selected={worktreeFocused}
            weight={worktreeFocused ? "semibold" : "medium"}
            className={
              isProjectRoot ? "text-text-primary" : "text-text-secondary"
            }
          >
            {label}
          </SidebarRowLabel>
          {isProjectRoot && project.readOnly && (
            <span title="read-only" className="shrink-0 text-text-secondary">
              <PaGlyph.readOnlyProject />
            </span>
          )}
          {worktree.origin === "agent" && (
            <span
              role="img"
              aria-label="Agent worktree"
              title="Created by an agent (Agent Team isolated checkout)"
              className="shrink-0 rounded-tag border border-accent/40 bg-accent/10 px-1 text-[10px] font-medium leading-tight text-accent"
            >
              agent
            </span>
          )}
          {lineageTitle && (
            <span
              role="img"
              aria-label="Linked worktree"
              title={lineageTitle}
              className="shrink-0 rounded-tag border border-text-secondary/30 bg-bg-primary px-1 text-[10px] font-medium leading-tight text-text-secondary"
            >
              linked
            </span>
          )}
          {worktree.orphan && (
            <span
              role="img"
              aria-label="Orphan worktree"
              title="Path is missing on disk -- use force remove to prune"
              className="shrink-0 rounded-tag border border-danger/40 bg-danger/10 px-1 text-[10px] font-medium leading-tight text-danger"
            >
              orphan
            </span>
          )}
        </button>
        {dirtyDotClass && (
          <span
            aria-hidden
            title={dirtyTitle}
            className={`h-1.5 w-1.5 shrink-0 rounded-tag ${dirtyDotClass}`}
          />
        )}
        <WorktreeRowActions
          label={label}
          onOpenContainer={
            onOpenContainer
              ? () => onOpenContainer(project.id, worktree.id)
              : undefined
          }
        />
      </SidebarRow>

      {isOpen && (
        <WorktreeChildren
          project={project}
          worktree={worktree}
          selection={selection}
          onSelectChild={onSelectChild}
          onToggleChildPin={onToggleChildPin}
          onReorderPanes={onReorderPanes}
        />
      )}
    </div>
  );
}

function formatLineageTitle(
  lineage: NonNullable<SidebarWorktree["lineage"]>,
): string {
  const parts = ["Created from workspace context"];
  if (lineage.parentWorktreePath) {
    parts.push(`parent: ${lastPathSegment(lineage.parentWorktreePath)}`);
  }
  if (lineage.createdByPaneCommandLabel) {
    parts.push(`command: ${lineage.createdByPaneCommandLabel}`);
  }
  return parts.join(" | ");
}

function lastPathSegment(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").pop() || path;
}

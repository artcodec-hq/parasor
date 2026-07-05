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
import {
  formatSidebarMetricsTitle,
  SidebarMetricsView,
  type SidebarRowMetrics,
} from "./SidebarMetrics.js";
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
  showTopBorder?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLDivElement>;
  onSelectWorktree?: (projectId: string, worktreeId: string) => void;
  onSelectChild?: (
    projectId: string,
    worktreeId: string,
    childId: string,
  ) => void;
  onNewSession?: (projectId: string, worktreeId: string) => void;
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
  showTopBorder = false,
  dragHandleProps,
  onSelectWorktree,
  onSelectChild,
  onNewSession,
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
  // When the project root isn't a git repo, a git glyph misrepresents
  // the row. Render a plain folder so the sidebar matches the `root` label.
  const nonRepo = project.isRepo === false;
  const label = displayName ?? worktree.name;
  const orphan = worktree.orphan === true;
  const rowMetrics = metricsForWorktree(worktree);
  const metricsTitle = formatSidebarMetricsTitle(rowMetrics);
  const rowTitle = metricsTitle || undefined;
  const dirtyStatus = hasDirtyStatus(rowMetrics);
  const labelClassName = orphan
    ? "text-text-secondary line-through decoration-danger"
    : dirtyStatus
      ? "text-warning/80"
      : "text-text-secondary";

  return (
    <div className={showTopBorder ? "border-t border-border" : undefined}>
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
            {nonRepo ? <PaGlyph.folder /> : <PaGlyph.git />}
          </SidebarRowIcon>
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          aria-label={rowTitle ? `${label}, ${rowTitle}` : undefined}
          onClick={() => onSelectWorktree?.(project.id, worktree.id)}
        >
          <SidebarRowLabel
            title={rowTitle}
            selected={worktreeFocused}
            weight={worktreeFocused ? "semibold" : "medium"}
            className={labelClassName}
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
          {worktree.provenance === "imported" && (
            <span
              role="img"
              aria-label="Imported worktree"
              title="Created outside Parasor"
              className="shrink-0 rounded-tag border border-text-secondary/30 bg-bg-primary px-1 text-[10px] font-medium leading-tight text-text-secondary"
            >
              imported
            </span>
          )}
          {worktree.orphan && (
            <span
              role="img"
              aria-label="Missing worktree"
              title="Path is missing on disk - prune the stale worktree entry"
              className="shrink-0 rounded-tag border border-danger/40 bg-danger/10 px-1 text-[10px] font-medium leading-tight text-danger"
            >
              missing
            </span>
          )}
        </button>
        <SidebarMetricsView metrics={rowMetrics} />
        <WorktreeRowActions
          label={label}
          onNewSession={
            onNewSession
              ? () => onNewSession(project.id, worktree.id)
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

function metricsForWorktree(worktree: SidebarWorktree): SidebarRowMetrics {
  return {
    dirtyAdded: worktree.dirtyAdded,
    dirtyDeleted: worktree.dirtyDeleted,
    dirtyCount: worktree.dirty,
    serviceCount: worktree.serviceCount,
  };
}

function hasDirtyStatus(metrics: SidebarRowMetrics): boolean {
  return hasDirtyLineMetrics(metrics) || (metrics.dirtyCount ?? 0) > 0;
}

function hasDirtyLineMetrics(metrics: SidebarRowMetrics): boolean {
  return (metrics.dirtyAdded ?? 0) > 0 || (metrics.dirtyDeleted ?? 0) > 0;
}

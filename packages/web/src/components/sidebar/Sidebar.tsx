import type { PortInfo, RuntimeServiceInfo, Session } from "@parasor/shared";
import { useDeferredValue, useMemo } from "react";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { SIDEBAR_WIDTH_MIN } from "../../lib/sidebar-width.js";
import { PaGlyph } from "../primitives/index.js";
import type { SidebarProject, SidebarSelection } from "./model/types.js";
import { SIDEBAR_ROW_INSET_CLASS } from "./primitives/index.js";
import { MonitorRow, ProjectGroup } from "./rows/index.js";
import { SidebarFooter } from "./SidebarFooter.js";
import { SidebarSearchRow } from "./SidebarSearchRow.js";
import { SortableProjects } from "./SortableProjectGroup.js";
import { filterSidebarProjects } from "./sidebar-filter.js";
import { useSidebarResize } from "./useSidebarResize.js";

export interface SidebarProps {
  projects: SidebarProject[];
  selection: SidebarSelection;
  connected: boolean;
  portsByProjectId?: Record<string, PortInfo[]>;
  servicesByProjectId?: Record<string, RuntimeServiceInfo[]>;
  projectNames?: Record<string, string>;
  sessions?: Session[];
  onOpenUrl?: (url: string, options?: OpenUrlOptions) => void;
  width?: number;
  fill?: boolean;
  resizable?: boolean;
  onWidthChange?: (width: number) => void;
  onSelectMonitor?: () => void;
  onSelectWorktree?: (projectId: string, worktreeId: string) => void;
  onSelectChild?: (
    projectId: string,
    worktreeId: string,
    childId: string,
  ) => void;
  onNewSession?: (projectId: string, worktreeId: string) => void;
  onToggleChildPin?: (childId: string) => void;
  worktreeOpenByProject?: Record<string, Record<string, boolean>>;
  onWorktreeOpenChange?: (
    projectId: string,
    worktreePath: string,
    open: boolean,
  ) => void;
  onNewProject?: () => void;
  onOpenSettings?: () => void;
  /** Count of pinned terminals (sidebar Monitor placeholder row). */
  pinnedMonitorCount?: number;
  /**
   * Inline filter shown above the footer. When `searchOpen` is true the
   * search input row renders and the project list filters by
   * `searchQuery`. Filter matches against project name -> worktree name ->
   * child label/hint, keeping ancestors of any match visible.
   */
  searchOpen?: boolean;
  searchQuery?: string;
  onToggleSearch?: () => void;
  onCloseSearch?: () => void;
  onSearchQueryChange?: (next: string) => void;
  /** DnD reorder hook for projects. When omitted, reorder is disabled. */
  onReorderProjects?: (ids: string[]) => void;
  /**
   * Bumped when a project reorder request fails on the server. Forces
   * SortableProjects to revert its optimistic order to the latest
   * server-broadcast sequence.
   */
  reorderResetSignal?: number;
  /**
   * Number of project reorder PUTs in flight. While > 0, the optimistic
   * local order suppresses same-set broadcasts to prevent flicker from
   * earlier broadcasts overriding a newer pending drag.
   */
  pendingProjectReorderCount?: number;
  /** DnD reorder hook for terminals/browsers within a worktree. */
  onReorderPanes?: (
    projectId: string,
    worktreePath: string,
    childIds: string[],
  ) => void;
  onCloseProject?: (projectId: string) => void;
}

/**
 * Single-column workspace sidebar. Worktree is the primary row; terminals
 * and browsers appear as children. Files/Git are views inside the worktree
 * stage, not sidebar rows.
 */
export function Sidebar({
  projects,
  selection,
  connected,
  portsByProjectId,
  servicesByProjectId,
  projectNames,
  sessions,
  onOpenUrl,
  width = 288,
  fill = false,
  resizable = false,
  onWidthChange,
  onSelectMonitor,
  onSelectWorktree,
  onSelectChild,
  onNewSession,
  onToggleChildPin,
  worktreeOpenByProject,
  onWorktreeOpenChange,
  onNewProject,
  onOpenSettings,
  searchOpen = false,
  searchQuery = "",
  onToggleSearch,
  onCloseSearch,
  onSearchQueryChange,
  pinnedMonitorCount = 0,
  onReorderProjects,
  onReorderPanes,
  reorderResetSignal,
  pendingProjectReorderCount,
  onCloseProject,
}: SidebarProps) {
  // Defer the filter computation so fast typing (and IME composition
  // bursts) don't block input echo on large project trees. The visible
  // input value still updates immediately via `searchQuery`.
  const deferredQuery = useDeferredValue(searchQuery);
  const trimmedQuery = deferredQuery.trim();
  const filtering = searchOpen && trimmedQuery.length > 0;

  const filteredProjects = useMemo(
    () =>
      filtering ? filterSidebarProjects(projects, trimmedQuery) : projects,
    [filtering, projects, trimmedQuery],
  );
  const {
    asideRef,
    effectiveMaxWidth,
    effectiveWidth,
    resizeHandleProps,
    showResizeHandle,
  } = useSidebarResize({ onWidthChange, resizable, width });

  return (
    <aside
      ref={asideRef}
      aria-label="Workspace navigation"
      className={`relative flex h-full min-h-0 shrink-0 flex-col bg-bg-secondary text-text-primary ${
        fill ? "w-full" : "border-r border-border"
      }`}
      style={fill ? undefined : { width: effectiveWidth }}
    >
      <div className="cm-scroll min-h-0 flex-1 overflow-y-auto pb-2.5">
        <MonitorRow
          selected={selection.monitor}
          pinnedCount={pinnedMonitorCount}
          onClick={onSelectMonitor}
        />
        {filtering ? (
          filteredProjects.length === 0 ? (
            <div
              className={`${SIDEBAR_ROW_INSET_CLASS[0]} py-6 text-center text-xs text-text-secondary`}
            >
              No matches for{" "}
              <span className="text-text-primary">"{trimmedQuery}"</span>
            </div>
          ) : (
            <div>
              {filteredProjects.map((project) => (
                <ProjectGroup
                  key={project.id}
                  project={project}
                  selection={selection}
                  forceOpen
                  onSelectWorktree={onSelectWorktree}
                  onSelectChild={onSelectChild}
                  onNewSession={onNewSession}
                  onToggleChildPin={onToggleChildPin}
                  worktreeOpen={worktreeOpenByProject?.[project.id]}
                  onWorktreeOpenChange={onWorktreeOpenChange}
                  onCloseProject={onCloseProject}
                />
              ))}
            </div>
          )
        ) : (
          <SortableProjects
            projects={filteredProjects}
            selection={selection}
            resetSignal={reorderResetSignal}
            pendingReorderCount={pendingProjectReorderCount}
            onReorderProjects={onReorderProjects ?? (() => {})}
            onSelectWorktree={onSelectWorktree}
            onSelectChild={onSelectChild}
            onNewSession={onNewSession}
            onToggleChildPin={onToggleChildPin}
            worktreeOpenByProject={worktreeOpenByProject}
            onWorktreeOpenChange={onWorktreeOpenChange}
            onReorderPanes={onReorderPanes}
            onCloseProject={onCloseProject}
          />
        )}
        {onNewProject && (
          <div className={`${SIDEBAR_ROW_INSET_CLASS[0]} mt-2`}>
            <button
              type="button"
              onClick={onNewProject}
              className="flex h-bar w-full items-center justify-center gap-2 rounded-control border border-dashed border-border text-sm text-text-secondary hover:border-accent/60 hover:text-text-primary"
            >
              <PaGlyph.add />
              <span>New Project</span>
            </button>
          </div>
        )}
      </div>

      {searchOpen && (
        <SidebarSearchRow
          query={searchQuery}
          onClose={onCloseSearch}
          onQueryChange={onSearchQueryChange}
        />
      )}

      <SidebarFooter
        connected={connected}
        portsByProjectId={portsByProjectId}
        servicesByProjectId={servicesByProjectId}
        projectNames={projectNames}
        sessions={sessions}
        onOpenUrl={onOpenUrl}
        onOpenSettings={onOpenSettings}
        onNewProject={onNewProject}
        searchOpen={searchOpen}
        onToggleSearch={onToggleSearch}
      />
      {showResizeHandle && (
        <hr
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuemax={effectiveMaxWidth}
          aria-valuenow={effectiveWidth}
          tabIndex={0}
          {...resizeHandleProps}
          className="cm-sidebar-resizer absolute top-0 right-0 bottom-0 z-[3] w-px cursor-col-resize touch-none bg-border before:absolute before:inset-y-0 before:-inset-x-3 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      )}
    </aside>
  );
}

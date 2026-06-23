import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SidebarProject, SidebarSelection } from "./model/types.js";
import { ProjectGroup } from "./rows/index.js";

/**
 * Sortable wrapper around the project list.
 *
 * - Desktop: drag handle visible on hover (8px activation distance)
 * - Mobile: long-press 250ms then drag (TouchSensor `delay`)
 *
 * The visible order is local-state optimistic; on drop we call
 * `onReorderProjects` with the new id sequence and let the server broadcast
 * `project-updated` settle the source-of-truth (App reducer reapplies
 * `sortProjects`, which honors `Project.order`).
 */
interface SortableProjectsProps {
  projects: SidebarProject[];
  selection: SidebarSelection;
  /** Bumped by parent on PUT failure to force-revert the optimistic order. */
  resetSignal?: number;
  /**
   * Number of reorder PUTs the parent currently has in flight. While
   * > 0 we treat the local optimistic order as the source of truth and
   * skip same-set reconcile (a stale broadcast from an earlier drag
   * would otherwise flicker the user's newer drag back to a prior
   * order). Set-membership changes (project added/removed) still
   * reconcile unconditionally.
   */
  pendingReorderCount?: number;
  onReorderProjects: (ids: string[]) => void;
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
  onReorderPanes?: (
    projectId: string,
    worktreePath: string,
    childIds: string[],
  ) => void;
}

export function SortableProjects({
  projects,
  selection,
  resetSignal,
  pendingReorderCount = 0,
  onReorderProjects,
  onSelectWorktree,
  onSelectChild,
  onNewSession,
  onToggleChildPin,
  worktreeOpenByProject,
  onWorktreeOpenChange,
  onReorderPanes,
}: SortableProjectsProps) {
  const incomingIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const [orderedIds, setOrderedIds] = useState<string[]>(incomingIds);

  // pendingReorderCount is read via ref so the reconcile effect runs only
  // on a genuine broadcast (incomingIds change) or explicit reset -- never
  // on the 1 -> 0 counter decrement. Without this guard, the late HTTP
  // response that drops the counter to 0 would re-trigger this effect with
  // the stale incomingIds captured during the in-flight window and adopt
  // them, producing the flicker A1 was meant to suppress.
  const pendingReorderCountRef = useRef(pendingReorderCount);
  pendingReorderCountRef.current = pendingReorderCount;

  useEffect(() => {
    void resetSignal;
    setOrderedIds((prev) => {
      const incomingSet = new Set(incomingIds);
      const prevSet = new Set(prev);
      const sameSet =
        incomingSet.size === prevSet.size &&
        [...incomingSet].every((id) => prevSet.has(id));
      if (!sameSet) return incomingIds;
      if (pendingReorderCountRef.current > 0) return prev;
      if (prev.join("\n") !== incomingIds.join("\n")) {
        return incomingIds;
      }
      return prev;
    });
  }, [incomingIds, resetSignal]);

  const byId = new Map(projects.map((p) => [p.id, p]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((p): p is SidebarProject => Boolean(p));

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = orderedIds.indexOf(String(active.id));
    const toIdx = orderedIds.indexOf(String(over.id));
    if (fromIdx === -1 || toIdx === -1) return;
    const next = arrayMove(orderedIds, fromIdx, toIdx);
    setOrderedIds(next);
    onReorderProjects(next);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={orderedIds}
        strategy={verticalListSortingStrategy}
      >
        {ordered.map((project) => (
          <SortableProjectItem
            key={project.id}
            project={project}
            selection={selection}
            onSelectWorktree={onSelectWorktree}
            onSelectChild={onSelectChild}
            onNewSession={onNewSession}
            onToggleChildPin={onToggleChildPin}
            worktreeOpenByProject={worktreeOpenByProject}
            onWorktreeOpenChange={onWorktreeOpenChange}
            onReorderPanes={onReorderPanes}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

interface SortableProjectItemProps {
  project: SidebarProject;
  selection: SidebarSelection;
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
  onReorderPanes?: (
    projectId: string,
    worktreePath: string,
    childIds: string[],
  ) => void;
}

function SortableProjectItem({
  project,
  selection,
  onSelectWorktree,
  onSelectChild,
  onNewSession,
  onToggleChildPin,
  worktreeOpenByProject,
  onWorktreeOpenChange,
  onReorderPanes,
}: SortableProjectItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ProjectGroup
        project={project}
        selection={selection}
        onSelectWorktree={onSelectWorktree}
        onSelectChild={onSelectChild}
        onNewSession={onNewSession}
        onToggleChildPin={onToggleChildPin}
        worktreeOpen={worktreeOpenByProject?.[project.id]}
        onWorktreeOpenChange={onWorktreeOpenChange}
        onReorderPanes={onReorderPanes}
        dragHandleProps={{
          ...attributes,
          ...listeners,
          "aria-label": `Reorder ${project.name}`,
          style: { WebkitTouchCallout: "none" },
        }}
      />
    </div>
  );
}

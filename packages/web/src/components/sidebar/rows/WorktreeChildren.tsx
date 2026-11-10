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
import { type SyntheticEvent, useEffect, useMemo, useState } from "react";
import type {
  SidebarChild,
  SidebarProject,
  SidebarSelection,
  SidebarWorktree,
} from "../model/types.js";
import { ChildRow } from "./ChildRow.js";

interface WorktreeChildrenProps {
  project: SidebarProject;
  worktree: SidebarWorktree;
  selection: SidebarSelection;
  onSelectChild?: (
    projectId: string,
    worktreeId: string,
    childId: string,
  ) => void;
  onToggleChildPin?: (childId: string) => void;
  onReorderPanes?: (
    projectId: string,
    worktreePath: string,
    childIds: string[],
  ) => void;
}

export function WorktreeChildren({
  project,
  worktree,
  selection,
  onSelectChild,
  onToggleChildPin,
  onReorderPanes,
}: WorktreeChildrenProps) {
  if (worktree.children.length === 0) return null;

  const childrenUnavailable =
    worktree.orphan === true || project.missing === true;

  if (onReorderPanes && !childrenUnavailable) {
    return (
      <SortableChildren
        project={project}
        worktree={worktree}
        selection={selection}
        onSelectChild={onSelectChild}
        onToggleChildPin={onToggleChildPin}
        onReorderPanes={onReorderPanes}
      />
    );
  }

  return (
    <div>
      {worktree.children.map((child) => (
        <ChildRow
          key={child.id}
          child={child}
          unavailable={childrenUnavailable}
          selected={
            selection.selectedWorktreeId === worktree.id &&
            selection.selectedChildId === child.id
          }
          onTogglePin={
            !childrenUnavailable &&
            child.kind === "terminal" &&
            onToggleChildPin
              ? () => onToggleChildPin(child.id)
              : undefined
          }
          onClick={() => onSelectChild?.(project.id, worktree.id, child.id)}
        />
      ))}
    </div>
  );
}

interface SortableChildrenProps {
  project: SidebarProject;
  worktree: SidebarWorktree;
  selection: SidebarSelection;
  onSelectChild?: (
    projectId: string,
    worktreeId: string,
    childId: string,
  ) => void;
  onToggleChildPin?: (childId: string) => void;
  onReorderPanes: (
    projectId: string,
    worktreePath: string,
    childIds: string[],
  ) => void;
}

function SortableChildren({
  project,
  worktree,
  selection,
  onSelectChild,
  onToggleChildPin,
  onReorderPanes,
}: SortableChildrenProps) {
  const incomingIds = useMemo(
    () => worktree.children.map((c) => c.id),
    [worktree.children],
  );
  const [orderedIds, setOrderedIds] = useState<string[]>(incomingIds);

  useEffect(() => {
    setOrderedIds((prev) => {
      const incomingSet = new Set(incomingIds);
      const prevSet = new Set(prev);
      const sameSet =
        incomingSet.size === prevSet.size &&
        [...incomingSet].every((id) => prevSet.has(id));
      if (!sameSet) return incomingIds;
      return prev;
    });
  }, [incomingIds]);

  const byId = new Map(worktree.children.map((c) => [c.id, c]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is SidebarChild => Boolean(c));

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
    onReorderPanes(project.id, worktree.path, next);
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
        <div>
          {ordered.map((child) => (
            <SortableChildRow
              key={child.id}
              child={child}
              selected={
                selection.selectedWorktreeId === worktree.id &&
                selection.selectedChildId === child.id
              }
              onTogglePin={
                child.kind === "terminal" && onToggleChildPin
                  ? () => onToggleChildPin(child.id)
                  : undefined
              }
              onClick={() => onSelectChild?.(project.id, worktree.id, child.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface SortableChildRowProps {
  child: SidebarChild;
  selected: boolean;
  onClick?: () => void;
  onTogglePin?: () => void;
}

function SortableChildRow({
  child,
  selected,
  onClick,
  onTogglePin,
}: SortableChildRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: child.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 5 : undefined,
    WebkitTouchCallout: "none" as const,
  };

  const isolatedListeners = stopBubbling(listeners);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...isolatedListeners}
      className="select-none"
    >
      <ChildRow
        child={child}
        selected={selected}
        onTogglePin={onTogglePin}
        onClick={onClick}
      />
    </div>
  );
}

// Pointer/touch activations on a nested pane must not arm the outer project
// sortable. Keyboard activations still propagate so dnd-kit can receive
// ArrowDown/Escape on window during keyboard dragging.
const POINTER_ISOLATION_EVENTS = new Set([
  "onPointerDown",
  "onMouseDown",
  "onTouchStart",
]);

function stopBubbling<T extends Record<string, unknown> | undefined>(
  listeners: T,
): T {
  if (!listeners) return listeners;
  const wrapped: Record<string, unknown> = {};
  for (const [key, handler] of Object.entries(listeners)) {
    if (POINTER_ISOLATION_EVENTS.has(key)) {
      wrapped[key] = (event: SyntheticEvent) => {
        (handler as (e: SyntheticEvent) => unknown)(event);
        event.stopPropagation();
      };
    } else {
      wrapped[key] = handler;
    }
  }
  return wrapped as T;
}

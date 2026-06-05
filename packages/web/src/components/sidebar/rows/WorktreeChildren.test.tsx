import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SidebarChild,
  SidebarProject,
  SidebarSelection,
  SidebarWorktree,
} from "../model/types.js";
import { WorktreeChildren } from "./WorktreeChildren.js";

vi.mock("@dnd-kit/core", () => ({
  closestCenter: vi.fn(),
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd: (event: {
      active: { id: string };
      over: { id: string } | null;
    }) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onDragEnd({
            active: { id: "terminal:s1" },
            over: { id: "browser:b1" },
          })
        }
      >
        Simulate child reorder
      </button>
      {children}
    </div>
  ),
  KeyboardSensor: vi.fn(),
  MouseSensor: vi.fn(),
  TouchSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: <T,>(items: T[], from: number, to: number): T[] => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    if (item !== undefined) next.splice(to, 0, item);
    return next;
  },
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    isDragging: false,
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function child(id: string, label: string, kind: SidebarChild["kind"]) {
  return {
    id,
    kind,
    label,
    status: "idle",
    pinned: false,
  } satisfies SidebarChild;
}

const selection: SidebarSelection = {
  monitor: false,
  selectedChildId: null,
  selectedWorktreeId: null,
};

const project: SidebarProject = {
  id: "project-1",
  name: "Project",
  path: "/repo",
  pinned: false,
  readOnly: false,
  worktrees: [],
};

const worktree: SidebarWorktree = {
  id: "wt:/repo",
  name: "main",
  path: "/repo",
  active: true,
  dirty: 0,
  ahead: 0,
  behind: 0,
  children: [
    child("terminal:s1", "terminal", "terminal"),
    child("browser:b1", "browser", "browser"),
  ],
  hasWorkingChild: false,
  hasAlertChild: false,
};

function rowLabels(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent ?? "")
    .filter((text) => text === "terminal" || text === "browser");
}

describe("WorktreeChildren pane reorder", () => {
  it("emits the persisted child order and updates the visible order", () => {
    const onReorderPanes = vi.fn();
    render(
      <WorktreeChildren
        project={project}
        worktree={worktree}
        selection={selection}
        onReorderPanes={onReorderPanes}
      />,
    );

    expect(rowLabels()).toEqual(["terminal", "browser"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Simulate child reorder" }),
    );

    expect(onReorderPanes).toHaveBeenCalledWith("project-1", "/repo", [
      "browser:b1",
      "terminal:s1",
    ]);
    expect(rowLabels()).toEqual(["browser", "terminal"]);
  });
});

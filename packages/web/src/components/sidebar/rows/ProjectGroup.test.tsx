import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarProject, SidebarSelection } from "../model/types.js";
import { ProjectGroup } from "./ProjectGroup.js";

afterEach(() => {
  cleanup();
});

const selection: SidebarSelection = {
  monitor: false,
  selectedWorktreeId: null,
  selectedChildId: null,
};

function makeProject(): SidebarProject {
  return {
    id: "p1",
    name: "demo",
    path: "/tmp/demo",
    pinned: false,
    readOnly: false,
    isRepo: true,
    worktrees: [
      {
        id: "root",
        name: "main",
        path: "/tmp/demo",
        active: true,
        dirty: 0,
        ahead: 0,
        behind: 0,
        children: [
          {
            id: "terminal:root",
            kind: "terminal",
            label: "root codex",
            status: "idle",
            pinned: false,
          },
        ],
        hasWorkingChild: false,
        hasAlertChild: false,
      },
      {
        id: "feature",
        name: "feature",
        path: "/tmp/demo-feature",
        active: true,
        dirty: 0,
        ahead: 0,
        behind: 0,
        children: [
          {
            id: "terminal:feature",
            kind: "terminal",
            label: "feature codex",
            status: "idle",
            pinned: false,
          },
        ],
        hasWorkingChild: false,
        hasAlertChild: false,
      },
    ],
  };
}

describe("ProjectGroup separators", () => {
  it("keeps the project top border but omits borders between worktree rows", () => {
    const project = makeProject();

    const { container } = render(
      <ProjectGroup project={project} selection={selection} />,
    );

    expect(container.children[0]?.className).toContain("border-t");
    expect(container.children[0]?.className).toContain("border-border");
    expect(container.children[1]?.className).not.toContain("border-t");
    expect(container.children[1]?.className).not.toContain("border-border");
  });
});

describe("ProjectGroup disclosure state", () => {
  it("shows one project disclosure while keeping every worktree open", () => {
    const project = makeProject();

    render(<ProjectGroup project={project} selection={selection} />);

    expect(screen.getByRole("button", { name: "Collapse demo" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Collapse feature" }),
    ).toBeNull();
    expect(screen.getByText("root codex")).toBeTruthy();
    expect(screen.getByText("feature codex")).toBeTruthy();
  });

  it("collapses the whole project using the project root path", () => {
    const project = makeProject();
    const onWorktreeOpenChange = vi.fn();
    const { rerender } = render(
      <ProjectGroup
        project={project}
        selection={selection}
        onWorktreeOpenChange={onWorktreeOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse demo" }));
    expect(onWorktreeOpenChange).toHaveBeenCalledWith(
      project.id,
      project.path,
      false,
    );

    rerender(
      <ProjectGroup
        project={project}
        selection={selection}
        worktreeOpen={{ [project.path]: false }}
        onWorktreeOpenChange={onWorktreeOpenChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Expand demo" })).toBeTruthy();
    expect(screen.queryByText("feature")).toBeNull();
    expect(screen.queryByText("root codex")).toBeNull();
    expect(screen.queryByText("feature codex")).toBeNull();
  });

  it("forceOpen reveals filtered results without changing stored state", () => {
    const project = makeProject();
    const onWorktreeOpenChange = vi.fn();

    render(
      <ProjectGroup
        project={project}
        selection={selection}
        worktreeOpen={{ [project.path]: false }}
        onWorktreeOpenChange={onWorktreeOpenChange}
        forceOpen
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse demo" })).toBeTruthy();
    expect(screen.getByText("feature codex")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse demo" }));
    expect(onWorktreeOpenChange).not.toHaveBeenCalled();
  });
});

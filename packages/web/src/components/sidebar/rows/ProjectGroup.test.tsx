import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

describe("ProjectGroup separators", () => {
  it("keeps the project top border but omits borders between worktree rows", () => {
    const project: SidebarProject = {
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
          children: [],
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
          children: [],
          hasWorkingChild: false,
          hasAlertChild: false,
        },
      ],
    };

    const { container } = render(
      <ProjectGroup project={project} selection={selection} />,
    );

    expect(container.children[0]?.className).toContain("border-t");
    expect(container.children[0]?.className).toContain("border-border");
    expect(container.children[1]?.className).not.toContain("border-t");
    expect(container.children[1]?.className).not.toContain("border-border");
  });
});

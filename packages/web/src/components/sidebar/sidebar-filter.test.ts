import { describe, expect, it } from "vitest";
import type { SidebarProject } from "./model/types.js";
import { filterSidebarProjects } from "./sidebar-filter.js";

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
      children: [
        {
          id: "terminal:root",
          kind: "terminal",
          label: "root shell",
          status: "idle",
          pinned: false,
        },
      ],
      hasWorkingChild: false,
      hasAlertChild: false,
    },
    {
      id: "feature",
      name: "feature/sidebar",
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

describe("filterSidebarProjects", () => {
  it("keeps the project root ahead of a matching linked worktree", () => {
    const [filtered] = filterSidebarProjects([project], "feature/sidebar");

    expect(filtered.worktrees.map((worktree) => worktree.id)).toEqual([
      "root",
      "feature",
    ]);
    expect(filtered.worktrees[0].children).toEqual([]);
  });
});

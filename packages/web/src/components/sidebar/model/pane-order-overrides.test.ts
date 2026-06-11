import type { ProjectState } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { applyPaneOrderOverrides } from "./pane-order-overrides.js";
import type { SidebarChild, SidebarProject, SidebarWorktree } from "./types.js";

function child(id: string): SidebarChild {
  return { id, kind: "terminal", label: id, status: "idle", pinned: false };
}

function worktree(path: string, children: SidebarChild[]): SidebarWorktree {
  return {
    id: `wt${path}`,
    name: path,
    path,
    active: false,
    dirty: 0,
    ahead: 0,
    behind: 0,
    children,
    hasWorkingChild: false,
    hasAlertChild: false,
  };
}

function project(id: string, worktrees: SidebarWorktree[]): SidebarProject {
  return {
    id,
    name: id,
    path: `/${id}`,
    pinned: false,
    readOnly: false,
    worktrees,
  };
}

function childIds(p: SidebarProject, wtIndex = 0): string[] {
  return p.worktrees[wtIndex].children.map((c) => c.id);
}

function projectStates(
  paneOrder: Record<string, string[]>,
): Record<string, ProjectState> {
  return {
    p1: {
      projectId: "p1",
      layout: null,
      worktrees: [],
      openFiles: [],
      lastFocusedPaneId: null,
      focusedPaneId: null,
      sidebar: { paneOrder, worktreeOpen: {} },
      lastAccessedAt: 1,
    },
  };
}

describe("applyPaneOrderOverrides", () => {
  it("returns children in builder order when nothing is stored", () => {
    const projects = [
      project("p1", [worktree("/w", [child("a"), child("b")])]),
    ];
    expect(childIds(applyPaneOrderOverrides(projects, {})[0])).toEqual([
      "a",
      "b",
    ]);
  });

  it("reorders children to match the stored order", () => {
    const projects = [
      project("p1", [worktree("/w", [child("a"), child("b")])]),
    ];
    expect(
      childIds(
        applyPaneOrderOverrides(
          projects,
          projectStates({ "/w": ["b", "a"] }),
        )[0],
      ),
    ).toEqual(["b", "a"]);
  });

  it("appends children missing from the stored order, after the ordered ones", () => {
    const projects = [
      project("p1", [worktree("/w", [child("a"), child("b"), child("c")])]),
    ];
    expect(
      childIds(
        applyPaneOrderOverrides(projects, projectStates({ "/w": ["c"] }))[0],
      ),
    ).toEqual(["c", "a", "b"]);
  });

  it("ignores stored ids that no longer exist among the children", () => {
    const projects = [
      project("p1", [worktree("/w", [child("a"), child("b")])]),
    ];
    expect(
      childIds(
        applyPaneOrderOverrides(
          projects,
          projectStates({ "/w": ["ghost", "b"] }),
        )[0],
      ),
    ).toEqual(["b", "a"]);
  });

  it("leaves worktrees without a stored entry untouched", () => {
    const projects = [
      project("p1", [
        worktree("/w1", [child("a"), child("b")]),
        worktree("/w2", [child("x"), child("y")]),
      ]),
    ];
    const result = applyPaneOrderOverrides(
      projects,
      projectStates({ "/w1": ["b", "a"] }),
    )[0];
    expect(childIds(result, 0)).toEqual(["b", "a"]);
    expect(childIds(result, 1)).toEqual(["x", "y"]);
  });

  it("returns the same project reference when its store is empty", () => {
    const projects = [project("p1", [worktree("/w", [child("a")])])];
    expect(applyPaneOrderOverrides(projects, {})[0]).toBe(projects[0]);
  });
});

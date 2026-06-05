import { beforeEach, describe, expect, it } from "vitest";
import { applyPaneOrderOverrides } from "./pane-order-overrides.js";
import type { SidebarChild, SidebarProject, SidebarWorktree } from "./types.js";

// This jsdom config does not provide localStorage; install a Map-backed mock.
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, String(v));
    },
  };
}

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

describe("applyPaneOrderOverrides", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: makeStorage(),
    });
  });

  it("returns children in builder order when nothing is stored", () => {
    const projects = [
      project("p1", [worktree("/w", [child("a"), child("b")])]),
    ];
    expect(childIds(applyPaneOrderOverrides(projects)[0])).toEqual(["a", "b"]);
  });

  it("reorders children to match the stored order", () => {
    window.localStorage.setItem(
      "paneOrder:p1",
      JSON.stringify({ "/w": ["b", "a"] }),
    );
    const projects = [
      project("p1", [worktree("/w", [child("a"), child("b")])]),
    ];
    expect(childIds(applyPaneOrderOverrides(projects)[0])).toEqual(["b", "a"]);
  });

  it("appends children missing from the stored order, after the ordered ones", () => {
    window.localStorage.setItem(
      "paneOrder:p1",
      JSON.stringify({ "/w": ["c"] }),
    );
    const projects = [
      project("p1", [worktree("/w", [child("a"), child("b"), child("c")])]),
    ];
    expect(childIds(applyPaneOrderOverrides(projects)[0])).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("ignores stored ids that no longer exist among the children", () => {
    window.localStorage.setItem(
      "paneOrder:p1",
      JSON.stringify({ "/w": ["ghost", "b"] }),
    );
    const projects = [
      project("p1", [worktree("/w", [child("a"), child("b")])]),
    ];
    expect(childIds(applyPaneOrderOverrides(projects)[0])).toEqual(["b", "a"]);
  });

  it("leaves worktrees without a stored entry untouched", () => {
    window.localStorage.setItem(
      "paneOrder:p1",
      JSON.stringify({ "/w1": ["b", "a"] }),
    );
    const projects = [
      project("p1", [
        worktree("/w1", [child("a"), child("b")]),
        worktree("/w2", [child("x"), child("y")]),
      ]),
    ];
    const result = applyPaneOrderOverrides(projects)[0];
    expect(childIds(result, 0)).toEqual(["b", "a"]);
    expect(childIds(result, 1)).toEqual(["x", "y"]);
  });

  it("returns the same project reference when its store is empty", () => {
    const projects = [project("p1", [worktree("/w", [child("a")])])];
    expect(applyPaneOrderOverrides(projects)[0]).toBe(projects[0]);
  });
});

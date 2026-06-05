import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  SidebarProject,
  SidebarSelection,
  SidebarWorktree,
} from "../model/types.js";
import { WorktreeRow } from "./WorktreeRow.js";

function installStorage(): Storage {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  return storage;
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const project: SidebarProject = {
  id: "p1",
  name: "demo",
  path: "/tmp/demo",
  pinned: false,
  readOnly: false,
  isRepo: true,
  worktrees: [],
};

function makeWorktree(dirty: number): SidebarWorktree {
  return {
    id: "w1",
    name: "main",
    path: "/tmp/demo",
    active: true,
    dirty,
    ahead: 0,
    behind: 0,
    children: [],
    hasWorkingChild: false,
    hasAlertChild: false,
  };
}

function makeWorktreeWithChild(): SidebarWorktree {
  return {
    ...makeWorktree(0),
    children: [
      {
        id: "terminal:s1",
        kind: "terminal",
        label: "codex",
        status: "idle",
        pinned: false,
      },
    ],
  };
}

const selection: SidebarSelection = {
  monitor: false,
  selectedWorktreeId: null,
  selectedChildId: null,
};

describe("WorktreeRow dirty indicator (dirty indicator behavior)", () => {
  it("uses a standalone Git modified dot and keeps the normal label color when dirty > 0", () => {
    const { container } = render(
      <WorktreeRow
        project={project}
        worktree={makeWorktree(3)}
        selection={selection}
      />,
    );
    const row = screen.getByRole("button", {
      name: "main, 3 uncommitted changes",
    });
    const label = screen.getByText("main");
    expect(row).not.toBeNull();
    expect(label.getAttribute("title")).toBe("3 uncommitted changes");
    expect(label.className).toContain("text-text-secondary");
    const dot = container.querySelector(
      ".bg-\\[var\\(--theme-git-modified\\)\\]",
    );
    expect(dot).not.toBeNull();
    expect(dot?.className).not.toContain("absolute");
    expect(dot?.className).toContain("shrink-0");
    expect(screen.queryByLabelText("Modified")).toBeNull();
  });

  it("does not use the worktree status dot for child agent activity", () => {
    const { container } = render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(0), hasWorkingChild: true }}
        selection={selection}
      />,
    );
    expect(container.querySelector(".bg-warning")).toBeNull();
    expect(
      container.querySelector(".bg-\\[var\\(--theme-git-modified\\)\\]"),
    ).toBeNull();
  });

  it("uses singular 'change' in title when dirty === 1", () => {
    render(
      <WorktreeRow
        project={project}
        worktree={makeWorktree(1)}
        selection={selection}
      />,
    );
    expect(screen.getByText("main").getAttribute("title")).toBe(
      "1 uncommitted change",
    );
    expect(
      screen.getByRole("button", { name: "main, 1 uncommitted change" }),
    ).not.toBeNull();
  });

  it("uses the normal worktree label color when dirty === 0", () => {
    render(
      <WorktreeRow
        project={project}
        worktree={makeWorktree(0)}
        selection={selection}
      />,
    );
    const label = screen.getByText("main");
    expect(label.getAttribute("title")).toBeNull();
    expect(label.className).toContain("text-text-secondary");
    expect(screen.queryByLabelText("Modified")).toBeNull();
  });
});

describe("WorktreeRow agent / orphan pills (orphan agent display)", () => {
  it("renders an 'agent' pill when origin is agent", () => {
    const { getByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(0), origin: "agent" }}
        selection={selection}
      />,
    );
    expect(getByLabelText("Agent worktree").textContent).toBe("agent");
  });

  it("renders an 'orphan' pill when orphan flag is set", () => {
    const { getByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(0), orphan: true }}
        selection={selection}
      />,
    );
    expect(getByLabelText("Orphan worktree").textContent).toBe("orphan");
  });

  it("omits both pills when neither flag is set", () => {
    const { queryByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={makeWorktree(0)}
        selection={selection}
      />,
    );
    expect(queryByLabelText("Agent worktree")).toBeNull();
    expect(queryByLabelText("Orphan worktree")).toBeNull();
  });
});

describe("WorktreeRow disclosure persistence (disclosure persistence)", () => {
  it("restores a collapsed worktree row from localStorage", () => {
    const worktree = makeWorktreeWithChild();
    localStorage.setItem(
      "parasor:sidebar:worktree-open:p1",
      JSON.stringify({ [worktree.path]: false }),
    );

    render(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
      />,
    );

    expect(screen.getByRole("button", { name: "Expand main" })).toBeTruthy();
    expect(screen.queryByText("codex")).toBeNull();
  });

  it("persists user disclosure toggles per project and worktree path", () => {
    const worktree = makeWorktreeWithChild();
    const { unmount } = render(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse main" }));

    expect(
      JSON.parse(
        localStorage.getItem("parasor:sidebar:worktree-open:p1") ?? "{}",
      ),
    ).toEqual({
      [worktree.path]: false,
    });
    expect(screen.queryByText("codex")).toBeNull();

    unmount();
    render(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
      />,
    );

    expect(screen.getByRole("button", { name: "Expand main" })).toBeTruthy();
    expect(screen.queryByText("codex")).toBeNull();
  });

  it("forceOpen shows filtered results without overwriting stored disclosure state", () => {
    const worktree = makeWorktreeWithChild();
    localStorage.setItem(
      "parasor:sidebar:worktree-open:p1",
      JSON.stringify({ [worktree.path]: false }),
    );

    const { rerender } = render(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
        forceOpen
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse main" })).toBeTruthy();
    expect(screen.getByText("codex")).toBeTruthy();
    expect(
      JSON.parse(
        localStorage.getItem("parasor:sidebar:worktree-open:p1") ?? "{}",
      ),
    ).toEqual({ [worktree.path]: false });

    rerender(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
      />,
    );

    expect(screen.getByRole("button", { name: "Expand main" })).toBeTruthy();
    expect(screen.queryByText("codex")).toBeNull();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SidebarProject,
  SidebarSelection,
  SidebarWorktree,
} from "../model/types.js";
import { WorktreeRow } from "./WorktreeRow.js";

afterEach(() => {
  cleanup();
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
  it("uses compact added/deleted dirty metrics and keeps the normal label color", () => {
    const { container } = render(
      <WorktreeRow
        project={project}
        worktree={{
          ...makeWorktree(3),
          ahead: 2,
          behind: 1,
          dirtyAdded: 2,
          dirtyDeleted: 1,
          serviceCount: 4,
        }}
        selection={selection}
      />,
    );
    const row = screen.getByRole("button", {
      name: "main, 2 added lines, 1 deleted line, 4 live ports",
    });
    const label = screen.getByText("main");
    expect(row).not.toBeNull();
    expect(label.getAttribute("title")).toBe(
      "2 added lines, 1 deleted line, 4 live ports",
    );
    expect(label.className).toContain("text-text-secondary");
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(
      container.querySelector(".bg-\\[var\\(--theme-git-modified\\)\\]"),
    ).toBeNull();
  });

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

  it("uses secondary text for the project root label", () => {
    render(
      <WorktreeRow
        project={project}
        worktree={makeWorktree(0)}
        selection={selection}
        displayName="demo"
        isProjectRoot
      />,
    );
    const label = screen.getByText("demo");
    expect(label.className).toContain("text-text-secondary");
    expect(label.className).not.toContain("text-text-primary");
  });
});

describe("WorktreeRow agent / missing-path pills", () => {
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

  it("renders a 'missing' pill when orphan flag is set", () => {
    const { getByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(0), orphan: true }}
        selection={selection}
      />,
    );
    expect(getByLabelText("Missing worktree").textContent).toBe("missing");
  });

  it("strikes through the worktree label when orphan flag is set", () => {
    render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(0), orphan: true }}
        selection={selection}
      />,
    );

    expect(screen.getByText("main").className).toContain("line-through");
  });

  it("renders a linked pill when lineage metadata is present", () => {
    const { getByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={{
          ...makeWorktree(0),
          lineage: {
            instanceId: "wt-inst",
            creationSource: "ui",
            createdAt: 100,
            parentWorktreePath: "/repo/main",
            createdByPaneCommandLabel: "Dev",
            lineageCapture: {
              source: "create-worktree-request",
              confidence: "explicit",
            },
          },
        }}
        selection={selection}
      />,
    );
    const pill = getByLabelText("Linked worktree");
    expect(pill.textContent).toBe("linked");
    expect(pill.getAttribute("title")).toContain("parent: main");
    expect(pill.getAttribute("title")).toContain("command: Dev");
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
    expect(queryByLabelText("Linked worktree")).toBeNull();
    expect(queryByLabelText("Missing worktree")).toBeNull();
  });
});

describe("WorktreeRow disclosure state", () => {
  it("renders a collapsed worktree row from controlled state", () => {
    const worktree = makeWorktreeWithChild();

    render(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
        worktreeOpen={{ [worktree.path]: false }}
      />,
    );

    expect(screen.getByRole("button", { name: "Expand main" })).toBeTruthy();
    expect(screen.queryByText("codex")).toBeNull();
  });

  it("reports user disclosure toggles per project and worktree path", () => {
    const worktree = makeWorktreeWithChild();
    const onWorktreeOpenChange = vi.fn();
    const { rerender } = render(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
        onWorktreeOpenChange={onWorktreeOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse main" }));
    expect(onWorktreeOpenChange).toHaveBeenCalledWith(
      project.id,
      worktree.path,
      false,
    );

    rerender(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
        worktreeOpen={{ [worktree.path]: false }}
        onWorktreeOpenChange={onWorktreeOpenChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Expand main" })).toBeTruthy();
    expect(screen.queryByText("codex")).toBeNull();
  });

  it("forceOpen shows filtered results without overwriting stored disclosure state", () => {
    const worktree = makeWorktreeWithChild();
    const onWorktreeOpenChange = vi.fn();

    const { rerender } = render(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
        worktreeOpen={{ [worktree.path]: false }}
        onWorktreeOpenChange={onWorktreeOpenChange}
        forceOpen
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse main" })).toBeTruthy();
    expect(screen.getByText("codex")).toBeTruthy();
    expect(onWorktreeOpenChange).not.toHaveBeenCalled();

    rerender(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
        worktreeOpen={{ [worktree.path]: false }}
        onWorktreeOpenChange={onWorktreeOpenChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Expand main" })).toBeTruthy();
    expect(screen.queryByText("codex")).toBeNull();
  });
});

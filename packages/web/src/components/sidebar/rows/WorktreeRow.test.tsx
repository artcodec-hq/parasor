import { cleanup, render, screen } from "@testing-library/react";
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
  it("uses compact added/deleted dirty metrics and modified label color", () => {
    render(
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
    expect(label.className).toContain("text-warning");
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
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

  it("falls back to muted modified title color when only dirtyCount is available", () => {
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
    expect(screen.queryByText("~1")).toBeNull();
    expect(screen.getByText("main").className).toContain("text-warning");
    expect(screen.queryByLabelText("Modified worktree")).toBeNull();
  });

  it("shows tracked line stats instead of the dirty count when available", () => {
    const { container } = render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(3), dirtyAdded: 12, dirtyDeleted: 4 }}
        selection={selection}
      />,
    );
    expect(screen.getByText("+12")).not.toBeNull();
    expect(screen.getByText("-4")).not.toBeNull();
    expect(screen.getByText("main").getAttribute("title")).toBe(
      "12 added lines, 4 deleted lines",
    );
    expect(
      screen.getByRole("button", {
        name: "main, 12 added lines, 4 deleted lines",
      }),
    ).not.toBeNull();
    expect(
      container.querySelector(".bg-\\[var\\(--theme-git-modified\\)\\]"),
    ).toBeNull();
    expect(screen.getByText("main").className).toContain("text-warning");
    expect(screen.queryByText("~3")).toBeNull();
  });

  it("falls back to dirty title color when dirty has no tracked line stats", () => {
    render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(2), dirtyAdded: 0, dirtyDeleted: 0 }}
        selection={selection}
      />,
    );
    expect(screen.queryByText("+0")).toBeNull();
    expect(screen.queryByText("-0")).toBeNull();
    expect(screen.queryByText("~2")).toBeNull();
    expect(screen.getByText("main").className).toContain("text-warning");
    expect(screen.queryByLabelText("Modified worktree")).toBeNull();
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

  it("does not render a top border separator on the worktree wrapper", () => {
    const { container } = render(
      <WorktreeRow
        project={project}
        worktree={makeWorktree(0)}
        selection={selection}
      />,
    );

    expect(container.firstElementChild?.className).not.toContain("border-t");
    expect(container.firstElementChild?.className).not.toContain(
      "border-border",
    );
  });
});

describe("WorktreeRow external / missing-path icons", () => {
  it("renders a linked status icon when origin is agent", () => {
    const { getByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(0), origin: "agent" }}
        selection={selection}
      />,
    );
    const icon = getByLabelText("Linked worktree");
    expect(icon.textContent).toBe("");
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(icon.className).not.toContain("border");
    expect(icon.className).not.toContain("bg-");
    expect(icon.getAttribute("title")).toBe("External worktree: agent-created");
  });

  it("renders a missing status icon when orphan flag is set", () => {
    const { getByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(0), orphan: true }}
        selection={selection}
      />,
    );
    const icon = getByLabelText("Missing worktree");
    expect(icon.textContent).toBe("");
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(icon.className).not.toContain("border");
    expect(icon.className).not.toContain("bg-");
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

  it("does not render a provenance pill for Parasor-created lineage metadata", () => {
    const { queryByLabelText } = render(
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
    expect(queryByLabelText("Linked worktree")).toBeNull();
  });

  it("renders a linked status icon when provenance is imported", () => {
    const { getByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={{ ...makeWorktree(0), provenance: "imported" }}
        selection={selection}
      />,
    );
    const icon = getByLabelText("Linked worktree");
    expect(icon.textContent).toBe("");
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(icon.getAttribute("title")).toBe("External worktree: imported");
  });

  it("renders one linked status icon when both external flags are set", () => {
    const { getAllByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={{
          ...makeWorktree(0),
          origin: "agent",
          provenance: "imported",
        }}
        selection={selection}
      />,
    );
    const icons = getAllByLabelText("Linked worktree");
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute("title")).toBe(
      "External worktree: agent-created, imported",
    );
  });

  it("places status icons after the title and before right-side metrics/actions", () => {
    render(
      <WorktreeRow
        project={project}
        worktree={{
          ...makeWorktree(2),
          dirtyAdded: 12,
          dirtyDeleted: 4,
          origin: "agent",
        }}
        selection={selection}
        onNewSession={vi.fn()}
      />,
    );
    const label = screen.getByText("main");
    const added = screen.getByText("+12");
    const linked = screen.getByLabelText("Linked worktree");
    const action = screen.getByRole("button", { name: "New session in main" });

    expect(
      label.compareDocumentPosition(linked) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      linked.compareDocumentPosition(added) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      added.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("omits both pills when neither flag is set", () => {
    const { queryByLabelText } = render(
      <WorktreeRow
        project={project}
        worktree={makeWorktree(0)}
        selection={selection}
      />,
    );
    expect(queryByLabelText("Linked worktree")).toBeNull();
    expect(queryByLabelText("Missing worktree")).toBeNull();
  });
});

describe("WorktreeRow disclosure state", () => {
  it("renders worktree children without a disclosure control", () => {
    const worktree = makeWorktreeWithChild();

    render(
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
      />,
    );

    expect(screen.getByText("codex")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collapse main" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand main" })).toBeNull();
  });
});

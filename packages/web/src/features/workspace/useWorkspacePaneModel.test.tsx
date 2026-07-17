import type { Session, WorkItem, Worktree } from "@parasor/shared";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  useWorkspacePaneModel,
  type WorkspacePaneModel,
} from "./useWorkspacePaneModel.js";

function session(overrides: Partial<Session>): Session {
  return {
    id: "s1",
    projectId: "p1",
    pid: 1234,
    state: "running",
    generation: 0,
    title: "",
    command: { type: "shell" },
    cwd: "/repo",
    shell: "/bin/zsh",
    createdAt: 0,
    ...overrides,
  };
}

function worktree(path: string): Worktree {
  return {
    path,
    head: "abc",
    branch: "main",
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
  };
}

function renderModel(
  props: Parameters<typeof useWorkspacePaneModel>[0],
): WorkspacePaneModel {
  let model: WorkspacePaneModel | null = null;
  function Probe() {
    model = useWorkspacePaneModel(props);
    return null;
  }
  render(<Probe />);
  if (!model) throw new Error("model did not render");
  return model;
}

describe("useWorkspacePaneModel", () => {
  it("projects valid persisted work item panes before terminal panes", () => {
    const item: WorkItem = {
      id: "item-1",
      projectId: "p1",
      title: "Ship pane",
      status: "todo",
      acceptanceCriteria: [],
      attachments: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const model = renderModel({
      projectId: "p1",
      projectPath: "/repo",
      worktrees: [worktree("/repo")],
      sessions: [session({ id: "term" })],
      focusedPaneId: "work-item:pane",
      workItems: [item],
      serverWorktreePanes: [
        {
          path: "/repo",
          panes: [
            {
              id: "work-item:pane",
              kind: "work-item",
              worktreePath: "/repo",
              state: { kind: "work-item", workItemId: item.id },
            },
          ],
        },
      ],
    });

    expect(model.worktrees[0].panes.map((pane) => pane.kind)).toEqual([
      "files",
      "work-item",
      "terminal",
      "git",
    ]);
    expect(model.focusedPane?.id).toBe("work-item:pane");
  });

  it("drops persisted panes whose work item was deleted", () => {
    const model = renderModel({
      projectId: "p1",
      projectPath: "/repo",
      worktrees: [worktree("/repo")],
      sessions: [],
      focusedPaneId: "work-item:stale",
      workItems: [],
      serverWorktreePanes: [
        {
          path: "/repo",
          panes: [
            {
              id: "work-item:stale",
              kind: "work-item",
              worktreePath: "/repo",
              state: { kind: "work-item", workItemId: "missing" },
            },
          ],
        },
      ],
    });
    expect(model.paneById.has("work-item:stale")).toBe(false);
    expect(model.effectiveFocusedPaneId).toBe("files:/repo");
  });
  it("preserves incoming worktree snapshot order after the project root", () => {
    const model = renderModel({
      projectId: "p1",
      projectPath: "/repo",
      worktrees: [
        worktree("/repo.worktrees/z"),
        worktree("/repo"),
        worktree("/repo.worktrees/a"),
      ],
      sessions: [],
      focusedPaneId: null,
    });

    expect(model.worktrees.map((wt) => wt.path)).toEqual([
      "/repo",
      "/repo.worktrees/z",
      "/repo.worktrees/a",
    ]);
  });

  it("keeps stale session cwd paths as orphan rows when a worktree snapshot exists", () => {
    const model = renderModel({
      projectId: "p1",
      projectPath: "/repo",
      worktrees: [worktree("/repo")],
      sessions: [
        session({ id: "root", cwd: "/repo" }),
        session({ id: "external", cwd: "/repo.worktrees/feature/newmenu" }),
      ],
      focusedPaneId: null,
    });

    expect(model.worktrees.map((wt) => wt.path)).toEqual([
      "/repo",
      "/repo.worktrees/feature/newmenu",
    ]);
    const orphan = model.worktrees.find(
      (wt) => wt.path === "/repo.worktrees/feature/newmenu",
    );
    expect(orphan).toMatchObject({ orphan: true });
    expect(orphan?.panes.some((pane) => pane.id === "terminal:external")).toBe(
      true,
    );
  });

  it("limits orphan rows to the remaining terminal panes", () => {
    const model = renderModel({
      projectId: "p1",
      projectPath: "/repo",
      worktrees: [worktree("/repo")],
      sessions: [
        session({ id: "external", cwd: "/repo.worktrees/feature/deleted" }),
      ],
      focusedPaneId: null,
      clientBrowserPanes: {
        "/repo.worktrees/feature/deleted": [
          { id: "browser:stale", url: "http://localhost:5173" },
        ],
      },
    });

    const orphan = model.worktrees.find(
      (wt) => wt.path === "/repo.worktrees/feature/deleted",
    );
    expect(orphan).toMatchObject({ orphan: true });
    expect(orphan?.panes.map((pane) => pane.id)).toEqual(["terminal:external"]);
  });

  it("keeps sessions outside the project root while no worktree snapshot exists", () => {
    const model = renderModel({
      projectId: "p1",
      projectPath: "/repo",
      worktrees: [],
      sessions: [
        session({ id: "root", cwd: "/repo" }),
        session({ id: "external", cwd: "/repo.worktrees/feature/newmenu" }),
      ],
      focusedPaneId: null,
    });

    expect(model.worktrees.map((wt) => wt.path)).toEqual([
      "/repo",
      "/repo.worktrees/feature/newmenu",
    ]);
    expect(
      model.worktrees
        .find((wt) => wt.path === "/repo.worktrees/feature/newmenu")
        ?.panes.some((pane) => pane.id === "terminal:external"),
    ).toBe(true);
  });

  it("keeps project subdirectory sessions under the project root", () => {
    const model = renderModel({
      projectId: "p1",
      projectPath: "/repo",
      worktrees: [worktree("/repo")],
      sessions: [session({ id: "subdir", cwd: "/repo/packages/web" })],
      focusedPaneId: null,
    });

    expect(model.worktrees.map((wt) => wt.path)).toEqual(["/repo"]);
    expect(
      model.worktrees[0]?.panes.some((pane) => pane.id === "terminal:subdir"),
    ).toBe(true);
  });
});

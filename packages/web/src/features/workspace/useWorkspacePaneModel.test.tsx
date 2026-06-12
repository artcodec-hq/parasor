import type { Session, Worktree } from "@parasor/shared";
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

  it("keeps sessions outside the known worktree list in their own active worktree row", () => {
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

import {
  type AppState,
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  filesPaneId,
  gitPaneId,
  type ProjectState,
  type WsEventMessage,
} from "@parasor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppStateStore } from "../../state/app-state.js";
import type { ProjectManager } from "../../state/project-manager.js";
import type { EventBus } from "../../ws/events.js";
import { WorkspaceNotFoundError } from "./errors.js";
import { createPaneCommands } from "./pane-commands.js";

function makeAppState(projectId: string): AppState {
  const ps: ProjectState = {
    projectId,
    layout: null,
    worktrees: [],
    openFiles: [],
    lastFocusedPaneId: null,
    focusedPaneId: null,
    lastAccessedAt: 1,
  };
  return {
    version: 1,
    projects: [],
    projectStates: { [projectId]: ps },
    sessions: [],
    sessionRecords: [],
    paneCommands: [],
    ideCommands: [],
    serviceConfig: {
      preventIdleSleep: false,
      portDetection: "all-interfaces",
      dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
      dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
    },
  };
}

describe("createPaneCommands", () => {
  let state: AppState;
  let appStateStore: AppStateStore;
  let projectManager: ProjectManager;
  let eventBus: EventBus;
  let broadcasts: WsEventMessage[];

  beforeEach(() => {
    state = makeAppState("proj-1");
    appStateStore = {
      get: vi.fn(() => state),
      mutateProjectStates: vi.fn((fn: (s: AppState) => void) => fn(state)),
    } as unknown as AppStateStore;
    projectManager = {
      get: vi.fn((id: string) =>
        id === "proj-1"
          ? {
              id,
              path: "/tmp/proj",
              name: "Proj",
              createdAt: 1,
              lastAccessedAt: 1,
            }
          : undefined,
      ),
    } as unknown as ProjectManager;
    broadcasts = [];
    eventBus = {
      broadcast: vi.fn((msg: WsEventMessage) => {
        broadcasts.push(msg);
      }),
    } as unknown as EventBus;
  });

  function deps() {
    return { appStateStore, eventBus, projectManager };
  }

  it("setWorktrees ensures files+git singletons per worktree", () => {
    const cmds = createPaneCommands(deps());
    cmds.setWorktrees("proj-1", ["/tmp/proj", "/tmp/proj/wt-a"]);

    const ps = state.projectStates["proj-1"];
    expect(ps.worktrees).toHaveLength(2);
    expect(ps.worktrees[0].panes.map((p) => p.kind)).toEqual(["files", "git"]);
    expect(ps.worktrees[1].panes.map((p) => p.kind)).toEqual(["files", "git"]);
    expect(ps.worktrees[0].panes[0].id).toBe(filesPaneId("/tmp/proj"));
    expect(ps.worktrees[1].panes[1].id).toBe(gitPaneId("/tmp/proj/wt-a"));
    expect(broadcasts.at(-1)).toMatchObject({ type: "panes-updated" });
  });

  it("setWorktrees preserves terminal/browser panes when path remains", () => {
    const cmds = createPaneCommands(deps());
    cmds.setWorktrees("proj-1", ["/tmp/proj"]);
    const term = cmds.addTerminalPane("proj-1", "/tmp/proj", "sess-1");
    cmds.setWorktrees("proj-1", ["/tmp/proj", "/tmp/proj/wt-a"]);

    const ps = state.projectStates["proj-1"];
    const main = ps.worktrees.find((w) => w.path === "/tmp/proj");
    expect(main?.panes.some((p) => p.id === term.id)).toBe(true);
  });

  it("setWorktrees drops panes for removed worktrees and clears focus", () => {
    const cmds = createPaneCommands(deps());
    cmds.setWorktrees("proj-1", ["/tmp/proj", "/tmp/proj/wt-a"]);
    const term = cmds.addTerminalPane("proj-1", "/tmp/proj/wt-a", "sess-1");
    cmds.focusPane("proj-1", term.id);

    cmds.setWorktrees("proj-1", ["/tmp/proj"]); // wt-a removed

    const ps = state.projectStates["proj-1"];
    expect(ps.worktrees).toHaveLength(1);
    expect(ps.focusedPaneId).toBeNull();
  });

  it("addTerminalPane inserts after existing terminals, before git", () => {
    const cmds = createPaneCommands(deps());
    cmds.setWorktrees("proj-1", ["/tmp/proj"]);
    const t1 = cmds.addTerminalPane("proj-1", "/tmp/proj", "s1");
    const t2 = cmds.addTerminalPane("proj-1", "/tmp/proj", "s2");

    const wt = state.projectStates["proj-1"].worktrees[0];
    const kinds = wt.panes.map((p) => p.kind);
    expect(kinds).toEqual(["files", "terminal", "terminal", "git"]);
    expect(wt.panes[1].id).toBe(t1.id);
    expect(wt.panes[2].id).toBe(t2.id);
  });

  it("addBrowserPane inserts before git", () => {
    const cmds = createPaneCommands(deps());
    cmds.setWorktrees("proj-1", ["/tmp/proj"]);
    cmds.addTerminalPane("proj-1", "/tmp/proj", "s1");
    cmds.addBrowserPane("proj-1", "/tmp/proj", "http://localhost:3000");

    const wt = state.projectStates["proj-1"].worktrees[0];
    expect(wt.panes.map((p) => p.kind)).toEqual([
      "files",
      "terminal",
      "browser",
      "git",
    ]);
  });

  it("closePane removes terminal and refocuses; singletons are protected", () => {
    const cmds = createPaneCommands(deps());
    cmds.setWorktrees("proj-1", ["/tmp/proj"]);
    const term = cmds.addTerminalPane("proj-1", "/tmp/proj", "s1");
    cmds.focusPane("proj-1", term.id);

    cmds.closePane("proj-1", term.id);
    const ps = state.projectStates["proj-1"];
    expect(ps.worktrees[0].panes.some((p) => p.id === term.id)).toBe(false);
    expect(ps.focusedPaneId).toBe(filesPaneId("/tmp/proj"));

    // Singleton close is no-op.
    cmds.closePane("proj-1", filesPaneId("/tmp/proj"));
    expect(
      ps.worktrees[0].panes.some((p) => p.id === filesPaneId("/tmp/proj")),
    ).toBe(true);
  });

  it("focusPane only accepts existing pane ids", () => {
    const cmds = createPaneCommands(deps());
    cmds.setWorktrees("proj-1", ["/tmp/proj"]);
    cmds.focusPane("proj-1", filesPaneId("/tmp/proj"));
    cmds.focusPane("proj-1", "bogus-id"); // rejected silently

    expect(state.projectStates["proj-1"].focusedPaneId).toBe(
      filesPaneId("/tmp/proj"),
    );
  });

  it("updateFilesPaneState patches selectedFilePath", () => {
    const cmds = createPaneCommands(deps());
    cmds.setWorktrees("proj-1", ["/tmp/proj"]);
    const id = filesPaneId("/tmp/proj");
    cmds.updateFilesPaneState("proj-1", id, {
      selectedFilePath: "src/index.ts",
    });
    const pane = state.projectStates["proj-1"].worktrees[0].panes.find(
      (p) => p.id === id,
    );
    expect(pane?.state).toMatchObject({
      kind: "files",
      selectedFilePath: "src/index.ts",
    });
  });

  it("updateBrowserPaneState updates URL", () => {
    const cmds = createPaneCommands(deps());
    cmds.setWorktrees("proj-1", ["/tmp/proj"]);
    const browser = cmds.addBrowserPane(
      "proj-1",
      "/tmp/proj",
      "http://localhost:3000",
    );
    cmds.updateBrowserPaneState(
      "proj-1",
      browser.id,
      "http://localhost:3000/admin",
    );
    const pane = state.projectStates["proj-1"].worktrees[0].panes.find(
      (p) => p.id === browser.id,
    );
    expect(pane?.state).toMatchObject({
      kind: "browser",
      url: "http://localhost:3000/admin",
    });
  });

  it("throws WorkspaceNotFoundError for missing project", () => {
    const cmds = createPaneCommands(deps());
    expect(() => cmds.setWorktrees("missing", [])).toThrow(
      WorkspaceNotFoundError,
    );
  });
});

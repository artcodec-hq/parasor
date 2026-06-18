import type { AppState, Session } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { buildMobileSessionSnapshots } from "./mobile-session-snapshots.js";

const session: Session = {
  id: "s1",
  projectId: "p1",
  pid: 123,
  state: "running",
  generation: 1,
  title: "Claude",
  command: { type: "shell" },
  cwd: "/repo",
  shell: "/bin/zsh",
  createdAt: 1,
};

const state: AppState = {
  version: 1,
  projects: [
    {
      id: "p1",
      name: "repo",
      path: "/repo",
      createdAt: 1,
      lastAccessedAt: 1,
    },
  ],
  projectStates: {
    p1: {
      projectId: "p1",
      layout: null,
      worktrees: [
        {
          path: "/repo",
          panes: [
            {
              id: "files:/repo",
              kind: "files",
              worktreePath: "/repo",
              state: { kind: "files", selectedFilePath: null },
            },
            {
              id: "terminal:pane",
              kind: "terminal",
              worktreePath: "/repo",
              state: { kind: "terminal", sessionId: "s1" },
            },
            {
              id: "terminal:missing",
              kind: "terminal",
              worktreePath: "/repo",
              state: { kind: "terminal", sessionId: "missing" },
            },
          ],
        },
      ],
      openFiles: [],
      lastFocusedPaneId: null,
      focusedPaneId: "terminal:pane",
      lastAccessedAt: 1,
    },
  },
  sessions: [session],
  sessionRecords: [],
  serviceConfig: {
    preventIdleSleep: false,
    portDetection: "all-interfaces",
    dropSizeMaxBytes: 10,
    dropSizeHardMaxBytes: 100,
  },
  paneCommands: [],
  ideCommands: [],
};

describe("buildMobileSessionSnapshots", () => {
  it("projects bounded mobile resume records without terminal output", () => {
    const snapshots = buildMobileSessionSnapshots({
      state,
      agentStates: {
        s1: {
          sessionId: "s1",
          lifecycle: "waiting",
          source: "hook",
          confidence: "high",
          detectedAt: 1,
        },
      },
      terminalPresences: {
        s1: {
          sessionId: "s1",
          driver: { kind: "mobile", clientId: "phone" },
          layout: {
            kind: "mobile",
            ownerClientId: "phone",
            cols: 44,
            rows: 18,
          },
          subscribers: [],
        },
      },
    });

    expect(snapshots.p1?.[0]).toMatchObject({
      projectId: "p1",
      worktreePath: "/repo",
      focusedPaneId: "terminal:pane",
      panes: [
        { kind: "files", paneId: "files:/repo" },
        {
          kind: "terminal",
          paneId: "terminal:pane",
          sessionId: "s1",
          status: "ready",
          title: "Claude",
          sessionState: "running",
          agentState: "waiting",
          display: { cols: 44, rows: 18 },
        },
        {
          kind: "terminal",
          paneId: "terminal:missing",
          sessionId: "missing",
          status: "missing-session",
        },
      ],
    });
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AppState,
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
} from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import { reconcileStartupState } from "./reconcile-state.js";

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `parasor-reconcile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("reconcileStartupState", () => {
  it("ends persisted running sessions and prunes orphan project state", async () => {
    const dir = makeTmpDir();
    const seed: AppState = {
      version: 1,
      projects: [
        {
          id: "project-1",
          name: "Project 1",
          path: "/tmp/project-1",
          createdAt: 1,
          lastAccessedAt: 2,
        },
      ],
      projectStates: {
        "project-1": {
          projectId: "project-1",
          layout: {
            type: "split",
            id: "split-1",
            direction: "horizontal",
            children: [
              { type: "terminal", id: "pane-1", sessionId: "session-1" },
              { type: "terminal", id: "pane-2", sessionId: "session-orphan" },
            ],
            sizes: [50, 50],
          },
          worktrees: [],
          openFiles: [],
          lastFocusedPaneId: null,
          focusedPaneId: null,
          lastAccessedAt: 2,
        },
        orphan: {
          projectId: "orphan",
          layout: null,
          worktrees: [],
          openFiles: [],
          lastFocusedPaneId: null,
          focusedPaneId: null,
          lastAccessedAt: 2,
        },
      },
      workItems: {},
      sessions: [
        {
          id: "session-1",
          projectId: "project-1",
          pid: 123,
          state: "running",
          generation: 4,
          title: "bash",
          command: { type: "shell" },
          cwd: "/tmp/project-1",
          shell: "/bin/bash",
          createdAt: 1,
        },
        {
          id: "session-orphan",
          projectId: "missing-project",
          pid: null,
          state: "ended",
          generation: 1,
          title: "bash",
          command: { type: "shell" },
          cwd: "/tmp/missing-project",
          shell: "/bin/bash",
          createdAt: 1,
        },
      ],
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

    writeFileSync(join(dir, "state.json"), JSON.stringify(seed), "utf-8");

    const store = new AppStateStore({ dir });
    await reconcileStartupState(store, 123456);

    const next = store.get();
    expect(next.sessions).toHaveLength(1);
    expect(next.sessions[0]).toMatchObject({
      id: "session-1",
      pid: null,
      state: "ended",
      generation: 5,
      endedAt: 123456,
    });
    expect(next.projectStates.orphan).toBeUndefined();
    expect(next.projectStates["project-1"].layout).toEqual({
      type: "terminal",
      id: "pane-1",
      sessionId: "session-1",
    });
  });
});

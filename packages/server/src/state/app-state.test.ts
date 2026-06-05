import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AppState,
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  type SessionRecord,
} from "@parasor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateReadOnlyError, AppStateStore } from "./app-state.js";

const EMPTY_STATE: AppState = {
  version: 1,
  projects: [],
  projectStates: {},
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

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `parasor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("AppStateStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates empty state when no file exists", () => {
    const store = new AppStateStore({ dir });
    expect(store.get()).toEqual(EMPTY_STATE);
  });

  it("loads existing state from disk", () => {
    const existing: AppState = {
      version: 1,
      projects: [
        {
          id: "p1",
          name: "MyProject",
          path: "/home/user/myproject",
          createdAt: 1000,
          lastAccessedAt: 2000,
        },
      ],
      projectStates: {},
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
    writeFileSync(join(dir, "state.json"), JSON.stringify(existing), "utf-8");

    const store = new AppStateStore({ dir });
    expect(store.get()).toEqual(existing);
  });

  it("normalizes project worktree local file allowlists on load", () => {
    const existing: AppState = {
      version: 1,
      projects: [
        {
          id: "p1",
          name: "MyProject",
          path: "/home/user/myproject",
          createdAt: 1000,
          lastAccessedAt: 2000,
          worktreeLocalFileAllowlist: [
            ".env",
            "./apps/api/.env.local",
            "../secret",
            "/abs/.env",
            ".env",
          ],
        },
      ],
      projectStates: {},
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
    writeFileSync(join(dir, "state.json"), JSON.stringify(existing), "utf-8");

    const store = new AppStateStore({ dir });
    expect(store.get().projects[0]?.worktreeLocalFileAllowlist).toEqual([
      ".env",
      "apps/api/.env.local",
    ]);
  });

  it("renames corrupted file and starts fresh", () => {
    writeFileSync(join(dir, "state.json"), "not valid json {{{}}", "utf-8");

    const store = new AppStateStore({ dir });
    expect(store.get()).toEqual(EMPTY_STATE);

    const files = readdirSync(dir);
    const corrupted = files.find((f) => f.startsWith("state.json.corrupted-"));
    expect(corrupted).toBeDefined();
  });

  it("mutateProjects() updates in-memory state and schedules flush", async () => {
    const store = new AppStateStore({ dir, debounceMs: 300 });

    store.mutateProjects((s) => {
      s.projects.push({
        id: "p1",
        name: "Test",
        path: "/tmp/test",
        createdAt: 1,
        lastAccessedAt: 1,
      });
    });

    expect(store.get().projects).toHaveLength(1);
    expect(store.get().projects[0].name).toBe("Test");

    // file not yet written (debounced)
    expect(existsSync(join(dir, "state.json"))).toBe(false);

    // advance timer to trigger debounced flush
    await vi.runAllTimersAsync();
    expect(existsSync(join(dir, "state.json"))).toBe(true);
  });

  it("flush() writes immediately", async () => {
    const store = new AppStateStore({ dir, debounceMs: 300 });

    store.mutateSessions((s) => {
      s.sessions.push({
        id: "s1",
        projectId: "p1",
        pid: null,
        state: "running",
        generation: 0,
        title: "bash",
        command: { type: "shell" },
        cwd: "/tmp",
        shell: "/bin/bash",
        createdAt: 1,
      });
    });

    expect(existsSync(join(dir, "state.json"))).toBe(false);
    await store.flush();
    expect(existsSync(join(dir, "state.json"))).toBe(true);

    const { readFileSync } = require("node:fs");
    const saved = JSON.parse(readFileSync(join(dir, "state.json"), "utf-8"));
    expect(saved.sessions).toHaveLength(1);
  });

  it("backfills portDetection when absent from persisted state", () => {
    const legacy = {
      version: 1,
      projects: [],
      projectStates: {},
      sessions: [],
      serviceConfig: { preventIdleSleep: true },
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(legacy), "utf-8");
    const store = new AppStateStore({ dir });
    expect(store.get().serviceConfig).toEqual({
      preventIdleSleep: true,
      portDetection: "all-interfaces",
      dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
      dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
    });
    expect(store.get().paneCommands).toEqual([]);
  });

  it("normalizes persisted paneCommands", () => {
    const state = {
      version: 1,
      projects: [],
      projectStates: {},
      sessions: [],
      sessionRecords: [],
      paneCommands: [
        { id: "cmd:1", label: " Dev ", initialInput: " pnpm dev " },
        { id: "cmd:1", label: "Duplicate", initialInput: "echo duplicate" },
        { id: "builtin:terminal", label: "Nope", initialInput: "echo nope" },
      ],
      serviceConfig: {
        preventIdleSleep: false,
        portDetection: "all-interfaces",
        dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
        dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
      },
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(state), "utf-8");
    const store = new AppStateStore({ dir });
    expect(store.get().paneCommands).toEqual([
      { id: "cmd:1", label: "Dev", initialInput: "pnpm dev" },
    ]);
  });

  it("falls back to all-interfaces when persisted portDetection is unknown", () => {
    const tampered = {
      version: 1,
      projects: [],
      projectStates: {},
      sessions: [],
      paneCommands: [],
      serviceConfig: {
        preventIdleSleep: false,
        portDetection: "future-mode",
      },
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(tampered), "utf-8");
    const store = new AppStateStore({ dir });
    expect(store.get().serviceConfig.portDetection).toBe("all-interfaces");
  });

  it("migrates legacy 'all' portDetection to 'all-interfaces'", () => {
    const legacy = {
      version: 1,
      projects: [],
      projectStates: {},
      sessions: [],
      paneCommands: [],
      serviceConfig: {
        preventIdleSleep: false,
        portDetection: "all",
      },
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(legacy), "utf-8");
    const store = new AppStateStore({ dir });
    expect(store.get().serviceConfig.portDetection).toBe("all-interfaces");
  });

  it("atomic write uses tmp file rename", async () => {
    const store = new AppStateStore({ dir, debounceMs: 0 });

    store.mutateProjects((s) => {
      s.projects.push({
        id: "p1",
        name: "Atomic",
        path: "/tmp/atomic",
        createdAt: 1,
        lastAccessedAt: 1,
      });
    });

    await store.flush();

    const files = readdirSync(dir);
    expect(files).toContain("state.json");
    expect(files).not.toContain("state.json.tmp");
  });

  it("round-trips SessionRecord through save and reload", async () => {
    const record: SessionRecord = {
      id: "sr-1",
      projectId: "p1",
      command: { type: "claude" },
      cwd: "/Users/me/proj",
      pid: 12345,
      pgid: 12345,
      argv: ["claude", "code"],
      startedAt: "2026-04-28T01:23:45.000Z",
      state: "running",
      exitCode: null,
      exitSignal: null,
      daemonPid: 999,
      daemonStartedAt: "2026-04-28T01:00:00.000Z",
    };

    const writer = new AppStateStore({ dir, debounceMs: 0 });
    writer.mutateSessions((s) => {
      s.sessionRecords.push(record);
    });
    await writer.flush();
    writer.destroy();

    const reader = new AppStateStore({ dir });
    expect(reader.get().sessionRecords).toEqual([record]);
  });

  it("backfills sessionRecords when absent from a legacy v1 state.json", () => {
    const legacy = {
      version: 1,
      projects: [],
      projectStates: {},
      sessions: [],
      paneCommands: [],
      serviceConfig: {
        preventIdleSleep: false,
        portDetection: "all-interfaces",
        dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
        dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
      },
    };
    writeFileSync(join(dir, "state.json"), JSON.stringify(legacy), "utf-8");
    const store = new AppStateStore({ dir });
    expect(store.get().sessionRecords).toEqual([]);
  });

  it("setSessionsReadOnly(true) makes mutateSessions() throw and leaves state untouched", () => {
    const store = new AppStateStore({ dir, debounceMs: 0 });
    store.setSessionsReadOnly(true);
    expect(store.isSessionsReadOnly()).toBe(true);
    expect(() =>
      store.mutateSessions((s) => {
        s.sessions.push({
          id: "s1",
          projectId: "p1",
          pid: null,
          state: "running",
          generation: 0,
          title: "bash",
          command: { type: "shell" },
          cwd: "/tmp",
          shell: "/bin/bash",
          createdAt: 1,
        });
      }),
    ).toThrow(AppStateReadOnlyError);
    expect(store.get().sessions).toEqual([]);
  });

  it("server-owned domains stay writable when sessions are read-only", () => {
    const store = new AppStateStore({ dir, debounceMs: 0 });
    store.setSessionsReadOnly(true);
    expect(() =>
      store.mutateProjects((s) => {
        s.projects.push({
          id: "p1",
          name: "T",
          path: "/tmp/p",
          createdAt: 1,
          lastAccessedAt: 1,
        });
      }),
    ).not.toThrow();
    expect(() =>
      store.mutateProjectStates((s) => {
        s.projectStates.p1 = {
          projectId: "p1",
          layout: null,
          worktrees: [],
          openFiles: [],
          lastFocusedPaneId: null,
          focusedPaneId: null,
          lastAccessedAt: 1,
        };
      }),
    ).not.toThrow();
    expect(() =>
      store.mutateServiceConfig((s) => {
        s.serviceConfig.preventIdleSleep = true;
      }),
    ).not.toThrow();
    expect(() =>
      store.mutatePaneCommands((s) => {
        s.paneCommands = [
          { id: "cmd:1", label: "Dev", initialInput: "pnpm dev" },
        ];
      }),
    ).not.toThrow();
    expect(store.get().projects).toHaveLength(1);
    expect(store.get().projectStates.p1).toBeDefined();
    expect(store.get().serviceConfig.preventIdleSleep).toBe(true);
    expect(store.get().paneCommands).toEqual([
      { id: "cmd:1", label: "Dev", initialInput: "pnpm dev" },
    ]);
  });

  it("internalMutate() bypasses the read-only guard for daemon reconciliation", () => {
    const store = new AppStateStore({ dir, debounceMs: 0 });
    store.setSessionsReadOnly(true);
    store.internalMutate((s) => {
      s.sessionRecords.push({
        id: "sr-x",
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/tmp",
        pid: null,
        pgid: null,
        argv: ["/bin/bash"],
        startedAt: "2026-04-28T00:00:00.000Z",
        state: "running",
        exitCode: null,
        exitSignal: null,
        daemonPid: 1,
        daemonStartedAt: "2026-04-28T00:00:00.000Z",
      });
    });
    expect(store.get().sessionRecords).toHaveLength(1);
  });
});

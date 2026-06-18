import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentState,
  type AppState,
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  type Session,
  type SessionActivityRecord,
} from "@parasor/shared";
import type { WSContext } from "hono/ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStateStore } from "../agent-detector/agent-state-store.js";
import { AgentDetector } from "../agent-detector/detector.js";
import type { UploadStaging } from "../fs/upload-staging.js";
import type { IpcServer } from "../ipc/socket-server.js";
import type { PortForwarder } from "../port-forwarder/forwarder.js";
import type { PortScanner } from "../port-scanner/scanner.js";
import type { PtyHost } from "../pty/host.js";
import type { SessionActivityStore } from "../session-activity-store.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { WorktreeCache } from "../state/worktree-cache.js";
import { EventBus } from "../ws/events.js";
import type { ProjectRuntime } from "./project-runtime.js";
import { buildHydrationStateSnapshot, wireRuntime } from "./wire-runtime.js";

const roots: string[] = [];

function baseState(storeSessions: Session[]): AppState {
  return {
    version: 1,
    projects: [],
    projectStates: {},
    sessions: storeSessions,
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

function session(id: string, cwd = "/repo"): Session {
  return {
    id,
    projectId: "proj-1",
    pid: null,
    state: "spawning",
    generation: 1,
    title: "shell",
    command: { type: "shell" },
    cwd,
    shell: "/bin/zsh",
    createdAt: 1,
  };
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "parasor-wire-runtime-"));
  roots.push(root);
  return root;
}

function mockWs() {
  return {
    readyState: 1,
    send: vi.fn(),
  };
}

function agentState(sessionId: string): AgentState {
  return {
    sessionId,
    lifecycle: "running",
    source: "hook",
    confidence: "high",
    detectedAt: 123,
  };
}

function wireDeps(overrides: {
  eventBus: EventBus;
  agentDetector: AgentDetector;
  agentStateStore: AgentStateStore;
  ptyManager: PtyHost;
  sessionActivityStore?: SessionActivityStore;
}) {
  return {
    appStateStore: {
      get: () => baseState([]),
      isSessionsReadOnly: () => true,
    } as unknown as AppStateStore,
    eventBus: overrides.eventBus,
    portScanner: {
      getAllPorts: () => ({}),
    } as unknown as PortScanner,
    portForwarder: {
      isInert: () => true,
      getReachablePort: () => null,
    } as unknown as PortForwarder,
    ptyManager: {
      ...overrides.ptyManager,
      get: overrides.ptyManager.get ?? (() => null),
    } as unknown as PtyHost,
    agentDetector: overrides.agentDetector,
    agentStateStore: overrides.agentStateStore,
    ipcServer: {
      onCommand: vi.fn(),
    } as unknown as IpcServer,
    projectManager: {
      get: vi.fn(),
    } as unknown as ProjectManager,
    projectRuntime: {
      getGitStates: () => ({}),
      handleBroadcast: vi.fn(),
      handleSessionEnded: vi.fn(),
    } as unknown as ProjectRuntime,
    worktreeCache: {
      get: () => ({}),
      appendWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      removeProject: vi.fn(),
      setProject: vi.fn(),
    } as unknown as WorktreeCache,
    uploadStaging: {
      releaseSession: vi.fn(),
    } as unknown as UploadStaging,
    sessionActivityStore:
      overrides.sessionActivityStore ??
      ({
        append: vi.fn(),
        getRecent: vi.fn(() => []),
      } as unknown as SessionActivityStore),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("buildHydrationStateSnapshot", () => {
  it("uses the PTY host session mirror when store.sessions lags", () => {
    const stale = session("stale");
    const fresh = session("fresh");
    const appStateStore = {
      get: () => baseState([stale]),
    } as unknown as AppStateStore;
    const ptyManager = {
      list: () => [fresh],
    } as unknown as PtyHost;

    const snapshot = buildHydrationStateSnapshot({
      appStateStore,
      ptyManager,
    });

    expect(snapshot.sessions).toEqual([fresh]);
  });
});

describe("wireRuntime hydration ports", () => {
  it("enriches the hydration snapshot's ports with forwarder reachability", async () => {
    const eventBus = new EventBus();
    const agentDetector = new AgentDetector();
    const agentStateStore = new AgentStateStore({ dir: tempRoot() });
    const ptyManager = {
      list: () => [],
      onSessionInput: vi.fn(),
      onSessionData: vi.fn(),
      getForegroundProcess: vi.fn(),
    } as unknown as PtyHost;

    const deps = wireDeps({
      eventBus,
      agentDetector,
      agentStateStore,
      ptyManager,
    });
    // A loopback dev port fronted by a forwarder that has finished binding.
    (
      deps.portScanner as unknown as { getAllPorts: () => unknown }
    ).getAllPorts = () => ({
      "proj-1": [{ port: 5173, pid: 1, bindsAll: false }],
    });
    (
      deps.portForwarder as unknown as {
        isInert: () => boolean;
        getReachablePort: (p: string, d: number) => number | null;
      }
    ).isInert = () => false;
    (
      deps.portForwarder as unknown as {
        getReachablePort: (p: string, d: number) => number | null;
      }
    ).getReachablePort = (p, d) =>
      p === "proj-1" && d === 5173 ? 49231 : null;

    wireRuntime(deps);

    const ws = mockWs();
    await eventBus.addClient(ws as unknown as WSContext);
    const msg = JSON.parse(ws.send.mock.calls[0][0]);

    expect(msg.payload.ports).toEqual({
      "proj-1": [
        {
          port: 5173,
          pid: 1,
          bindsAll: false,
          reachable: true,
          reachablePort: 49231,
        },
      ],
    });
  });
});

describe("wireRuntime agent state persistence", () => {
  it("hydrates activity history from the activity store", async () => {
    const activityHistory: SessionActivityRecord[] = [
      {
        id: "a1",
        sessionId: "s1",
        timestamp: 1_000,
        kind: "session-created",
        source: "daemon",
        summary: "Session created",
      },
    ];
    const eventBus = new EventBus();
    const agentDetector = new AgentDetector();
    const agentStateStore = new AgentStateStore({ dir: tempRoot() });
    const ptyManager = {
      list: () => [],
      onSessionInput: vi.fn(),
      onSessionData: vi.fn(),
      getForegroundProcess: vi.fn(),
    } as unknown as PtyHost;
    const sessionActivityStore = {
      append: vi.fn(() => true),
      getRecent: vi.fn(() => activityHistory),
    } as unknown as SessionActivityStore;

    wireRuntime(
      wireDeps({
        eventBus,
        agentDetector,
        agentStateStore,
        ptyManager,
        sessionActivityStore,
      }),
    );

    const ws = mockWs();
    await eventBus.addClient(ws as unknown as WSContext);

    const payload = JSON.parse(ws.send.mock.calls[0][0]).payload;
    expect(payload.activityHistory).toEqual(activityHistory);
    expect(sessionActivityStore.getRecent).toHaveBeenCalledWith(100);
  });

  it("broadcasts activity-recorded for daemon session events", async () => {
    const eventBus = new EventBus();
    const agentDetector = new AgentDetector();
    const root = tempRoot();
    const agentStateStore = new AgentStateStore({ dir: root });
    const ptyManager = {
      list: () => [],
      get: () => null,
      onSessionInput: vi.fn(),
      onSessionData: vi.fn(),
      getForegroundProcess: vi.fn(),
    } as unknown as PtyHost;
    const sessionActivityStore = {
      append: vi.fn(() => true),
      getRecent: vi.fn(() => []),
    } as unknown as SessionActivityStore;

    wireRuntime(
      wireDeps({
        eventBus,
        agentDetector,
        agentStateStore,
        ptyManager,
        sessionActivityStore,
      }),
    );
    const ws = mockWs();
    await eventBus.addClient(ws as unknown as WSContext);
    ws.send.mockReset();

    eventBus.broadcast({
      type: "session-created",
      session: session("s1"),
    });

    const events = ws.send.mock.calls.map(
      (call) => JSON.parse(call[0] as string).message?.type,
    );
    expect(events).toContain("activity-recorded");
    expect(sessionActivityStore.append).toHaveBeenCalledTimes(1);
    expect(sessionActivityStore.append).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        kind: "session-created",
        source: "daemon",
      }),
    );
  });

  it("hydrates reconnecting clients from the persisted live-session state", async () => {
    const eventBus = new EventBus();
    const agentDetector = new AgentDetector();
    const agentStateStore = new AgentStateStore({ dir: tempRoot() });
    agentStateStore.set(agentState("s1"));
    agentStateStore.set(agentState("ended"));
    const ptyManager = {
      list: () => [
        { ...session("s1"), state: "running" },
        { ...session("ended"), state: "ended" },
      ],
      onSessionInput: vi.fn(),
      onSessionData: vi.fn(),
      getForegroundProcess: vi.fn(),
    } as unknown as PtyHost;

    wireRuntime(
      wireDeps({ eventBus, agentDetector, agentStateStore, ptyManager }),
    );

    const ws = mockWs();
    await eventBus.addClient(ws as unknown as WSContext);
    const msg = JSON.parse(ws.send.mock.calls[0][0]);

    expect(msg.payload.agentStates).toEqual({ s1: agentState("s1") });
    expect(agentStateStore.getStates()).toEqual({ s1: agentState("s1") });
  });

  it("does not let native-managed preset sessions fall back to output detection", () => {
    let inputCallback:
      | ((sessionId: string, data: string, generation: number) => void)
      | undefined;
    let dataCallback:
      | ((sessionId: string, data: string, generation: number) => void)
      | undefined;
    const eventBus = new EventBus();
    const agentDetector = new AgentDetector({ now: () => 456 });
    const root = tempRoot();
    const agentStateStore = new AgentStateStore({ dir: root });
    const codexSession: Session = {
      ...session("s1"),
      state: "running",
      launchPreset: {
        presetId: "builtin:codex",
        source: "builtin",
        label: "Codex",
        commandLine: "codex",
        runtimeHint: {
          runtimeId: "codex",
          tier: "native-managed",
          expectedProcesses: ["codex"],
        },
      },
    };
    const ptyManager = {
      list: () => [codexSession],
      get: (sessionId: string) => (sessionId === "s1" ? codexSession : null),
      onSessionInput: vi.fn((cb) => {
        inputCallback = cb;
      }),
      onSessionData: vi.fn((cb) => {
        dataCallback = cb;
      }),
      getForegroundProcess: vi.fn(() => "codex"),
    } as unknown as PtyHost;

    wireRuntime(
      wireDeps({ eventBus, agentDetector, agentStateStore, ptyManager }),
    );

    inputCallback?.("s1", "hello\n", 1);
    dataCallback?.("s1", "Codex output\n", 1);

    expect(agentDetector.getStates()).toEqual({});
    expect(agentStateStore.getStates()).toEqual({});
  });

  it("persists detector state changes for the next server process", () => {
    const eventBus = new EventBus();
    const agentDetector = new AgentDetector({ now: () => 456 });
    const root = tempRoot();
    const agentStateStore = new AgentStateStore({ dir: root });
    const ptyManager = {
      list: () => [{ ...session("s1"), state: "running" }],
      onSessionInput: vi.fn(),
      onSessionData: vi.fn(),
      getForegroundProcess: vi.fn(),
    } as unknown as PtyHost;

    wireRuntime(
      wireDeps({ eventBus, agentDetector, agentStateStore, ptyManager }),
    );
    agentDetector.setExternalState("s1", {
      lifecycle: "running",
      source: "hook",
      confidence: "high",
    });

    const reloaded = new AgentStateStore({ dir: root });
    expect(reloaded.getStates()).toEqual({
      s1: {
        sessionId: "s1",
        lifecycle: "running",
        source: "hook",
        confidence: "high",
        detectedAt: 456,
      },
    });
  });
});

import {
  type AgentState,
  type AppState,
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
} from "@parasor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, handleEventClientMessage } from "./events.js";

function mockWs() {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    url: new URL("ws://localhost"),
    protocol: "",
    raw: undefined,
    binaryType: "blob" as const,
  } as unknown as Parameters<EventBus["addClient"]>[0];
}

function emptyState(): AppState {
  return {
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
}

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
    bus.setHydrationSources({
      getState: () => emptyState(),
      getAgentStates: () => ({}),
      getNotifications: () => [],
      getPorts: () => ({}),
      getGitStates: () => ({}),
      getWorktrees: () => ({}),
    });
  });

  it("sends snapshot on client add", async () => {
    const ws = mockWs();
    await bus.addClient(ws);

    expect(ws.send).toHaveBeenCalledOnce();
    const msg = JSON.parse(
      (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );
    expect(msg.type).toBe("app-state-snapshot");
    expect(msg.payload.seq).toBe(0);
  });

  it("broadcasts with incrementing seq", async () => {
    const ws = mockWs();
    await bus.addClient(ws);

    bus.broadcast({ type: "project-deleted", projectId: "p1" });
    bus.broadcast({ type: "project-deleted", projectId: "p2" });

    const calls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
    const env1 = JSON.parse(calls[1][0]);
    const env2 = JSON.parse(calls[2][0]);

    expect(env1.seq).toBe(1);
    expect(env2.seq).toBe(2);
    expect(env1.message.type).toBe("project-deleted");
  });

  it("does not send to removed clients", async () => {
    const ws = mockWs();
    await bus.addClient(ws);
    bus.removeClient(ws);

    bus.broadcast({ type: "project-deleted", projectId: "p1" });

    // Only snapshot was sent, not the broadcast
    expect(ws.send).toHaveBeenCalledOnce();
  });

  it("skips clients with closed readyState", async () => {
    const ws = mockWs();
    await bus.addClient(ws);
    (ws as { readyState: number }).readyState = 3; // CLOSED

    bus.broadcast({ type: "project-deleted", projectId: "p1" });

    // Only snapshot was sent
    expect(ws.send).toHaveBeenCalledOnce();
  });

  it("tracks notifications", () => {
    const n = {
      id: "n1",
      projectId: "p1",
      sessionId: "s1",
      type: "agent-waiting" as const,
      title: "test",
      message: "",
      read: false,
      timestamp: Date.now(),
    };
    bus.addNotification(n);

    expect(bus.getNotifications()).toHaveLength(1);
    expect(bus.getNotifications()[0].id).toBe("n1");
  });

  it("caps retained notifications and drops the oldest when overflowing", () => {
    const total = 205;
    for (let i = 0; i < total; i++) {
      bus.addNotification({
        id: `n${i}`,
        projectId: "p1",
        sessionId: "s1",
        type: "agent-waiting",
        title: "test",
        message: "",
        read: false,
        timestamp: i,
      });
    }
    const retained = bus.getNotifications();
    expect(retained).toHaveLength(200);
    expect(retained[0].id).toBe("n5");
    expect(retained[retained.length - 1].id).toBe(`n${total - 1}`);
  });

  it("snapshot includes correct seq after broadcasts", async () => {
    bus.broadcast({ type: "project-deleted", projectId: "p1" });
    bus.broadcast({ type: "project-deleted", projectId: "p2" });

    const ws = mockWs();
    await bus.addClient(ws);

    const msg = JSON.parse(
      (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );
    expect(msg.payload.seq).toBe(2);
  });

  it("snapshot includes the current agent state mirror for reconnecting clients", async () => {
    const running: AgentState = {
      sessionId: "s1",
      lifecycle: "running",
      source: "hook",
      confidence: "high",
      detectedAt: 123,
    };
    bus.setHydrationSources({
      getState: () => emptyState(),
      getAgentStates: () => ({ s1: running }),
      getNotifications: () => [],
      getPorts: () => ({}),
      getGitStates: () => ({}),
      getWorktrees: () => ({}),
    });

    const ws = mockWs();
    await bus.addClient(ws);

    const msg = JSON.parse(
      (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );
    expect(msg.payload.agentStates).toEqual({ s1: running });
  });
});

describe("handleEventClientMessage", () => {
  it("echoes pong with same ts on ping", () => {
    const ws = mockWs();
    handleEventClientMessage(ws, JSON.stringify({ type: "ping", ts: 1234 }));

    expect(ws.send).toHaveBeenCalledOnce();
    const msg = JSON.parse(
      (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );
    expect(msg).toEqual({ type: "pong", ts: 1234 });
  });

  it("ignores unknown message types", () => {
    const ws = mockWs();
    handleEventClientMessage(ws, JSON.stringify({ type: "future-thing" }));

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("ignores ping with non-numeric ts", () => {
    const ws = mockWs();
    handleEventClientMessage(ws, JSON.stringify({ type: "ping", ts: "now" }));

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("ignores ping with non-finite ts (NaN/Infinity)", () => {
    const ws = mockWs();
    // JSON.stringify({ ts: NaN }) emits "ts":null, so feed the parsed shape
    // directly via a raw string the parser will accept.
    handleEventClientMessage(ws, '{"type":"ping","ts":null}');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON without throwing", () => {
    const ws = mockWs();
    expect(() => handleEventClientMessage(ws, "{not json")).not.toThrow();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("ignores non-string payloads", () => {
    const ws = mockWs();
    expect(() =>
      handleEventClientMessage(ws, new ArrayBuffer(8) as unknown as string),
    ).not.toThrow();
    expect(ws.send).not.toHaveBeenCalled();
  });
});

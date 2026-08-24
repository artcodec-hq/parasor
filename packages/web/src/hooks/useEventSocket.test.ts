import type { AgentState, HydrationPayload } from "@parasor/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureAuthenticatedMock = vi.fn<() => Promise<boolean>>();
vi.mock("../lib/auth-fetch.js", () => ({
  authFetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
  ensureAuthenticated: () => ensureAuthenticatedMock(),
}));

import {
  disableTerminalTrace,
  enableTerminalTrace,
} from "../lib/terminal-trace.js";
import { useEventSocket } from "./useEventSocket.js";

class FakeWebSocket {
  static OPEN = 1 as const;
  static CLOSED = 3 as const;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.fireClose(1005);
  }

  fireOpen() {
    this.readyState = FakeWebSocket.OPEN;
    for (const h of this.listeners.get("open") ?? []) h(new Event("open"));
  }

  fireMessage(data: string | Blob | ArrayBuffer) {
    for (const h of this.listeners.get("message") ?? [])
      h({ data } as MessageEvent);
  }

  fireClose(code: number, reason = "") {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    for (const h of this.listeners.get("close") ?? [])
      h({ code, reason } as CloseEvent);
  }
}

function latestSocket(): FakeWebSocket {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no WebSocket constructed yet");
  return ws;
}

async function settleAuth() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => state === "hidden",
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  ensureAuthenticatedMock.mockResolvedValue(true);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("location", {
    protocol: "http:",
    host: "127.0.0.1:3000",
  } as Location);
  setVisibility("visible");
  window.parasorTerminalTrace?.clear();
  disableTerminalTrace();
  window.parasorTerminalTrace?.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ensureAuthenticatedMock.mockReset();
});

function pingFrames(ws: FakeWebSocket): { type: string; ts: number }[] {
  return ws.sent
    .map((s) => JSON.parse(s) as { type: string; ts: number })
    .filter((m) => m.type === "ping");
}

function makeSnapshot(
  overrides: Partial<HydrationPayload> = {},
): HydrationPayload {
  return {
    seq: 0,
    state: {
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
        dropSizeMaxBytes: 5242880,
        dropSizeHardMaxBytes: 26214400,
      },
    },
    agentStates: {},
    notifications: [],
    ports: {},
    services: {},
    gitStates: {},
    worktrees: {},
    hostPlatform: "darwin",
    ...overrides,
  };
}

function sendSnapshot(
  ws: FakeWebSocket,
  overrides: Partial<HydrationPayload> = {},
) {
  ws.fireMessage(
    JSON.stringify({
      type: "app-state-snapshot",
      payload: makeSnapshot(overrides),
    }),
  );
}

describe("useEventSocket heartbeat", () => {
  it("marks the event socket reachable on open before snapshot hydration", async () => {
    const { result } = renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();

    expect(result.current.connected).toBe(false);
    expect(result.current.eventSocketConnected).toBe(false);
    expect(result.current.eventSocketStatus.phase).toBe("connecting");

    act(() => ws.fireOpen());

    expect(result.current.connected).toBe(false);
    expect(result.current.eventSocketConnected).toBe(true);
    expect(result.current.eventSocketStatus.phase).toBe("hydrating");
  });

  it("closes and reconnects when the snapshot never arrives after open", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
      }),
    );
    enableTerminalTrace();
    renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(ws.closed).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/debug/terminal-trace/client-diagnostic",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      diagnostic: "client-startup-load",
      reason: "event-socket-snapshot-timeout",
      events: expect.arrayContaining([
        expect.objectContaining({
          type: "event-socket-snapshot-timeout",
          timeoutMs: 10_000,
        }),
      ]),
    });
  });

  it("keeps the socket open when the initial snapshot arrives", async () => {
    const { result } = renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());

    act(() => sendSnapshot(ws));

    expect(result.current.eventSocketStatus.phase).toBe("open");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(ws.closed).toBe(false);
  });

  it("hydrates when the initial snapshot arrives as a Blob", async () => {
    const { result } = renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());

    await act(async () => {
      ws.fireMessage(
        new Blob([
          JSON.stringify({
            type: "app-state-snapshot",
            payload: makeSnapshot({
              state: {
                ...makeSnapshot().state,
                projects: [
                  {
                    id: "p1",
                    name: "Project",
                    path: "/tmp/project",
                    createdAt: 1,
                    lastAccessedAt: 1,
                  },
                ],
              },
            }),
          }),
        ]),
      );
      await Promise.resolve();
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.projects.map((p) => p.id)).toEqual(["p1"]);
  });

  it("persists custom IDE commands in the warm-boot cache", async () => {
    const fakeStore = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => fakeStore.get(key) ?? null,
      setItem: (key: string, value: string) => fakeStore.set(key, value),
      removeItem: (key: string) => fakeStore.delete(key),
      clear: () => fakeStore.clear(),
    });
    const { result } = renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());
    act(() =>
      sendSnapshot(ws, {
        state: {
          ...makeSnapshot().state,
          ideCommands: [
            {
              id: "zed",
              label: "Zed",
              command: "zed",
              args: ["{path}"],
            },
          ],
        },
      }),
    );

    expect(result.current.ideCommands).toEqual([
      { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
    ]);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(501);
    });

    const cached = JSON.parse(
      localStorage.getItem("parasor:store-cache") ?? "{}",
    ) as { ideCommands?: unknown };
    expect(cached.ideCommands).toEqual([
      { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
    ]);
  });

  it("sends a ping 20s after open", async () => {
    renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());
    act(() => sendSnapshot(ws));

    expect(pingFrames(ws)).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(pingFrames(ws)).toHaveLength(1);
    expect(pingFrames(ws)[0].type).toBe("ping");
    expect(typeof pingFrames(ws)[0].ts).toBe("number");
  });

  it("keeps the socket open when pong arrives within 10s", async () => {
    renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());
    act(() => sendSnapshot(ws));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    const ts = pingFrames(ws)[0].ts;

    act(() => ws.fireMessage(JSON.stringify({ type: "pong", ts })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(ws.closed).toBe(false);
  });

  it("closes the socket when no pong arrives within 10s", async () => {
    renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());
    act(() => sendSnapshot(ws));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(ws.closed).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(ws.closed).toBe(true);
  });

  it("stops sending pings after the socket is closed", async () => {
    renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());
    act(() => sendSnapshot(ws));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(pingFrames(ws)).toHaveLength(1);

    // Force-close: simulates pong-timeout or external drop. After the close
    // listener fires, stopHeartbeat must clear the interval so no further
    // pings are sent on this socket -- even though reconnect schedules a new
    // socket, the original ws.sent must not grow.
    act(() => ws.fireClose(1006));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(pingFrames(ws)).toHaveLength(1);
  });

  it("reconnects immediately after a stable established socket closes", async () => {
    renderHook(() => useEventSocket());
    await settleAuth();
    const first = latestSocket();
    act(() => first.fireOpen());
    act(() => sendSnapshot(first));

    // Stay established beyond the stability window so the drop counts as a
    // genuine drop (instant reconnect), not a flap.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    act(() => first.fireClose(1006));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await settleAuth();

    const second = latestSocket();
    expect(second).not.toBe(first);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("backs off instead of reconnecting at 0ms when an established socket flaps", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { result } = renderHook(() => useEventSocket());
    await settleAuth();
    const first = latestSocket();
    act(() => first.fireOpen());
    act(() => sendSnapshot(first));

    // Drop almost immediately -- below the stability window = a flap.
    const closedAt = Date.now();
    act(() => first.fireClose(1006));

    expect(result.current.eventSocketStatus).toMatchObject({
      phase: "recovering",
      disconnectedAt: closedAt,
      lastProgressAt: closedAt,
      nextRetryAt: closedAt + 2000,
      attempt: 1,
    });

    // A 0ms advance must NOT create the second socket: backoff applies.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await settleAuth();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Once the backoff window elapses, it reconnects.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.eventSocketStatus).toMatchObject({
      phase: "recovering",
      disconnectedAt: closedAt,
      lastProgressAt: closedAt + 2000,
      nextRetryAt: null,
      attempt: 1,
    });
    await settleAuth();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("removes the visibilitychange listener after the socket is closed", async () => {
    renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());
    act(() => sendSnapshot(ws));

    act(() => ws.fireClose(1006));

    // After cleanup, visibility flips on the original ws's listener must
    // not produce additional pings on that socket.
    setVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(pingFrames(ws)).toHaveLength(0);
  });

  it("sends an immediate ping on visibilitychange to visible", async () => {
    renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());
    act(() => sendSnapshot(ws));

    expect(pingFrames(ws)).toHaveLength(0);

    setVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(pingFrames(ws)).toHaveLength(1);
  });

  it("does not send heartbeats before the socket is open", async () => {
    renderHook(() => useEventSocket());
    await settleAuth();
    const ws = latestSocket();
    // intentionally do not fire open

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(pingFrames(ws)).toHaveLength(0);
  });

  it("rehydrates running agent state from the reconnect snapshot", async () => {
    const running: AgentState = {
      sessionId: "s1",
      lifecycle: "running",
      source: "hook",
      confidence: "high",
      detectedAt: 123,
    };
    const { result } = renderHook(() => useEventSocket());
    await settleAuth();
    const first = latestSocket();
    act(() => first.fireOpen());
    act(() => sendSnapshot(first));

    expect(result.current.agentStates.s1).toBeUndefined();

    act(() => first.fireClose(1006));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await settleAuth();
    const second = latestSocket();
    expect(second).not.toBe(first);

    act(() => second.fireOpen());
    act(() => sendSnapshot(second, { agentStates: { s1: running } }));

    expect(result.current.agentStates.s1).toEqual(running);
  });
});

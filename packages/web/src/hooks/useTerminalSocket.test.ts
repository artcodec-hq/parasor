import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disableTerminalTrace,
  enableTerminalTrace,
} from "../lib/terminal-trace.js";

const ensureAuthenticatedMock =
  vi.fn<
    (options?: {
      reuseRecentSuccess?: boolean;
      source?: string;
      trace?: (event: unknown) => void;
    }) => Promise<boolean>
  >();
vi.mock("../lib/auth-fetch.js", () => ({
  ensureAuthenticated: (options?: {
    reuseRecentSuccess?: boolean;
    source?: string;
    trace?: (event: unknown) => void;
  }) => ensureAuthenticatedMock(options),
}));

import { useTerminalSocket } from "./useTerminalSocket.js";

function installStorage(name: "localStorage" | "sessionStorage"): Storage {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  } as Storage;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, name, { configurable: true, value: storage });
  return storage;
}

class FakeWebSocket {
  static OPEN = 1 as const;
  static CLOSED = 3 as const;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  binaryType = "blob";
  sent: Array<string | Uint8Array> = [];
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

  send(data: string | Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.fireClose(1005);
  }

  fireOpen() {
    this.readyState = FakeWebSocket.OPEN;
    for (const h of this.listeners.get("open") ?? []) h(new Event("open"));
  }

  fireMessage(data: string | ArrayBuffer) {
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

beforeEach(() => {
  installStorage("localStorage");
  installStorage("sessionStorage");
  FakeWebSocket.instances = [];
  ensureAuthenticatedMock.mockResolvedValue(true);
  sessionStorage.clear();
  localStorage.clear();
  window.parasorTerminalTrace?.clear();
  disableTerminalTrace();
  window.parasorTerminalTrace?.clear();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("location", {
    protocol: "http:",
    host: "127.0.0.1:3000",
  } as Location);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  ensureAuthenticatedMock.mockReset();
});

describe("useTerminalSocket", () => {
  it("reaches 'open' status and flushes queued input only after init-ack", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s1", onData: () => {} }),
    );
    expect(result.current.status).toBe("connecting");

    await settleAuth();
    const ws = latestSocket();

    act(() => result.current.sendInit(80, 24));
    act(() => result.current.send({ type: "input", data: "hello" }));

    act(() => ws.fireOpen());

    expect(result.current.status).toBe("open");
    expect(ws.sent).toEqual([
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: { binary: true, chunkedReplay: true },
      }),
    ]);

    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: false, chunkedReplay: false },
          serverState: {
            generation: 7,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    expect(result.current.status).toBe("attached");
    expect(ws.sent.at(-1)).toBe(
      JSON.stringify({ type: "input", data: "hello", generation: 7 }),
    );
  });

  it("sends an initial cached cursor in the init capabilities", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({
        sessionId: "s-cached",
        initialLastSeen: { generation: 4, seq: "99" },
        onData: () => {},
      }),
    );

    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());

    expect(ws.sent[0]).toBe(
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: {
          binary: true,
          chunkedReplay: true,
          lastSeen: { generation: 4, seq: "99" },
        },
      }),
    );
  });

  it("resolves the initial cached cursor after terminal dimensions are known", async () => {
    const resolveInitialLastSeen = vi.fn(
      (dims: { cols: number; rows: number }) =>
        dims.cols === 100 && dims.rows === 30
          ? { generation: 4, seq: "99" }
          : null,
    );
    const { result } = renderHook(() =>
      useTerminalSocket({
        sessionId: "s-cached",
        resolveInitialLastSeen,
        onData: () => {},
      }),
    );

    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(100, 30));
    act(() => ws.fireOpen());

    expect(resolveInitialLastSeen).toHaveBeenCalledWith({
      cols: 100,
      rows: 30,
    });
    expect(ws.sent[0]).toBe(
      JSON.stringify({
        type: "init",
        cols: 100,
        rows: 30,
        capabilities: {
          binary: true,
          chunkedReplay: true,
          lastSeen: { generation: 4, seq: "99" },
        },
      }),
    );
  });

  it("omits the cached cursor when the resolver rejects the fitted dimensions", async () => {
    const resolveInitialLastSeen = vi.fn(() => null);
    const { result } = renderHook(() =>
      useTerminalSocket({
        sessionId: "s-cached",
        resolveInitialLastSeen,
        onData: () => {},
      }),
    );

    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());

    expect(resolveInitialLastSeen).toHaveBeenCalledWith({
      cols: 80,
      rows: 24,
    });
    expect(ws.sent[0]).toBe(
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: {
          binary: true,
          chunkedReplay: true,
        },
      }),
    );
  });

  it("does not reconnect when initialLastSeen identity changes after init-ack", async () => {
    const { result, rerender } = renderHook(
      ({ seen }: { seen: { generation: number; seq: string } | null }) =>
        useTerminalSocket({
          sessionId: "s1",
          initialLastSeen: seen,
          onData: () => {},
        }),
      {
        initialProps: { seen: null } as {
          seen: { generation: number; seq: string } | null;
        },
      },
    );

    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: false, chunkedReplay: false },
          serverState: {
            generation: 7,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );
    expect(FakeWebSocket.instances).toHaveLength(1);

    // A full replay stores a fresh lastSeen object, so the parent re-renders
    // with a new `initialLastSeen` identity. That must NOT tear the socket
    // down: a teardown nulls lastDimsRef and the fresh socket can never send
    // init, stranding the terminal connected-but-input-dead.
    act(() => rerender({ seen: { generation: 7, seq: "42" } }));
    await settleAuth();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.status).toBe("attached");

    // Input still reaches the same live, init-acked socket.
    act(() => result.current.send({ type: "input", data: "x" }));
    expect(ws.sent.at(-1)).toBe(
      JSON.stringify({ type: "input", data: "x", generation: 7 }),
    );
  });

  it("reconnects on transient close and replays queued keystrokes in order", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s1", onData: () => {} }),
    );

    await settleAuth();
    const first = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => first.fireOpen());
    act(() =>
      first.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: false, chunkedReplay: false },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    act(() => result.current.send({ type: "input", data: "a" }));
    expect(first.sent).toEqual([
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: { binary: true, chunkedReplay: true },
      }),
      JSON.stringify({ type: "input", data: "a", generation: 1 }),
    ]);

    // Transient network drop.
    act(() => first.fireClose(1006));
    expect(result.current.status).toBe("reconnecting");

    // Keystrokes during the reconnect window must queue, not drop.
    act(() => result.current.send({ type: "input", data: "b" }));
    act(() => result.current.send({ type: "input", data: "c" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35000);
    });

    const second = latestSocket();
    expect(second).not.toBe(first);
    act(() => second.fireOpen());

    expect(result.current.status).toBe("open");
    expect(second.sent).toEqual([
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: { binary: true, chunkedReplay: true },
      }),
    ]);
    act(() =>
      second.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: false, chunkedReplay: false },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );
    expect(second.sent.slice(1)).toEqual([
      JSON.stringify({ type: "input", data: "b", generation: 1 }),
      JSON.stringify({ type: "input", data: "c", generation: 1 }),
    ]);
  });

  it("reconnects immediately after a stable established socket closes", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s1", onData: () => {} }),
    );

    await settleAuth();
    const first = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => first.fireOpen());
    act(() =>
      first.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: false, chunkedReplay: false },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    // Stay established beyond the stability window so the drop counts as a
    // genuine drop (instant reconnect), not a flap.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    act(() => first.fireClose(1006));
    expect(result.current.status).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await settleAuth();

    const second = latestSocket();
    expect(second).not.toBe(first);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.status).toBe("reconnecting");
  });

  it("backs off instead of reconnecting at 0ms when an established socket flaps", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s1", onData: () => {} }),
    );

    await settleAuth();
    const first = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => first.fireOpen());
    act(() =>
      first.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: false, chunkedReplay: false },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    // Drop almost immediately -- below the stability window = a flap.
    act(() => first.fireClose(1006));
    expect(result.current.status).toBe("reconnecting");

    // A 0ms advance must NOT create the second socket: backoff applies.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await settleAuth();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Once the backoff window elapses, it reconnects.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35000);
    });
    await settleAuth();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("marks status 'ended' on close code 1008 and stops retrying", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s1", onData: () => {} }),
    );

    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());

    act(() => ws.fireClose(1008, "Session not found"));
    expect(result.current.status).toBe("ended");
    expect(result.current.endedReason).toBe("Session not found");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("falls back to 'Session unavailable' when 1008 close has no reason string", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s1", onData: () => {} }),
    );

    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());

    act(() => ws.fireClose(1008, ""));
    expect(result.current.endedReason).toBe("Session unavailable");
  });

  it("caps sendQueue at MAX_SEND_QUEUE frames after the socket closes with 1008", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s1", onData: () => {} }),
    );

    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());
    act(() => ws.fireClose(1008, "Session unavailable"));
    expect(result.current.status).toBe("ended");

    // Push far past any reasonable cap. The cap itself (1000) is an
    // implementation detail, so we assert only the upper bound.
    act(() => {
      for (let i = 0; i < 5000; i++) {
        result.current.send({ type: "input", data: String(i) });
      }
    });

    // No new socket was created (ended parks the hook), so the server
    // received no frames at all.
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.sent).toEqual([
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: { binary: true, chunkedReplay: true },
      }),
    ]);
    // Overflow warning fires at most once.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("cancels a pending reconnect when sessionId changes", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useTerminalSocket({ sessionId: id, onData: () => {} }),
      { initialProps: { id: "s1" } },
    );

    await settleAuth();
    const first = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => first.fireOpen());
    act(() => first.fireClose(1006));
    expect(result.current.status).toBe("reconnecting");

    rerender({ id: "s2" });
    await settleAuth();

    // Advance past the scheduled reconnect for s1 -- it should be cancelled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35000);
    });

    // Only the s2 socket should exist after the original s1 + s2 constructions;
    // no third socket for the cancelled s1 retry.
    const s2Sockets = FakeWebSocket.instances.filter((w) =>
      w.url.includes("s2"),
    );
    const s1Sockets = FakeWebSocket.instances.filter((w) =>
      w.url.includes("s1"),
    );
    expect(s1Sockets).toHaveLength(1);
    expect(s2Sockets).toHaveLength(1);
  });

  it("does not construct a WebSocket when auth preflight fails", async () => {
    ensureAuthenticatedMock.mockResolvedValue(false);
    renderHook(() => useTerminalSocket({ sessionId: "s1", onData: () => {} }));
    await settleAuth();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("records sanitized socket trace events when terminal tracing is enabled", async () => {
    enableTerminalTrace();
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-trace", onData: () => {} }),
    );

    act(() => result.current.sendInit(80, 24));
    act(() => result.current.send({ type: "input", data: "secret text" }));
    await settleAuth();
    const ws = latestSocket();
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: false, chunkedReplay: false },
          serverState: {
            generation: 7,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    const trace = window.parasorTerminalTrace?.dump() ?? [];
    expect(trace.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "socket-queue",
        "socket-auth-start",
        "socket-auth-complete",
        "socket-open",
        "socket-init-sent",
        "socket-init-ack",
        "socket-flush-queued",
      ]),
    );
    expect(JSON.stringify(trace)).not.toContain("secret text");
    expect(ensureAuthenticatedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reuseRecentSuccess: true,
        source: "terminal-socket",
        trace: expect.any(Function),
      }),
    );
    expect(
      trace.find((event) => event.type === "socket-auth-complete"),
    ).toEqual(expect.objectContaining({ status: "ok" }));
    expect(trace.find((event) => event.type === "socket-queue")).toMatchObject({
      sessionId: "s-trace",
      dataLength: 11,
      queueLength: 1,
    });
    window.parasorTerminalTrace?.clear();
  });
});

/*
 * -- capability negotiation + binary path coverage.
 * The mock WS is fed an init-ack JSON envelope and then drives the
 * client through binary OUTPUT/INPUT, mirroring the real wire format
 * (1-byte prefix + uint32 BE generation + uint64 BE seq + payload).
 */
describe("useTerminalSocket -- binary capability path", () => {
  function encodeOutput(
    generation: number,
    seq: bigint,
    payload: Uint8Array,
  ): ArrayBuffer {
    const buf = new Uint8Array(1 + 4 + 8 + payload.length);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x10;
    dv.setUint32(1, generation, false);
    dv.setBigUint64(5, seq, false);
    buf.set(payload, 13);
    return buf.buffer.slice(0) as ArrayBuffer;
  }

  it("ws.binaryType is set to 'arraybuffer' on connect", async () => {
    renderHook(() =>
      useTerminalSocket({ sessionId: "s-bin", onData: () => {} }),
    );
    await settleAuth();
    const ws = latestSocket();
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("after init-ack(binary=true), input/resize/refresh are sent as binary frames", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-bin2", onData: () => {} }),
    );
    await settleAuth();
    const ws = latestSocket();

    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());

    // Server returns init-ack with binary=true and a fresh (empty) ring.
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: true, chunkedReplay: true },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    act(() => result.current.send({ type: "input", data: "ab" }));
    act(() => result.current.send({ type: "resize", cols: 100, rows: 30 }));
    act(() => result.current.send({ type: "refresh" }));

    // [0]=init JSON, [1]=INPUT binary, [2]=RESIZE binary, [3]=REFRESH binary
    expect(ws.sent).toHaveLength(4);
    expect(typeof ws.sent[0]).toBe("string");
    const input = ws.sent[1] as Uint8Array;
    expect(input).toBeInstanceOf(Uint8Array);
    expect(input[0]).toBe(0x00);
    // PTY generation gate: INPUT now carries `[uint32 BE generation][data]` after the
    // prefix. init-ack seeded generation=1, so bytes 1..4 must be 0,0,0,1.
    expect(Array.from(input.slice(1, 5))).toEqual([0x00, 0x00, 0x00, 0x01]);
    expect(Array.from(input.slice(5))).toEqual([0x61, 0x62]);
    const resize = ws.sent[2] as Uint8Array;
    expect(resize[0]).toBe(0x01);
    const dvR = new DataView(
      resize.buffer,
      resize.byteOffset,
      resize.byteLength,
    );
    expect(dvR.getUint32(1, false)).toBe(100);
    expect(dvR.getUint32(5, false)).toBe(30);
    const refresh = ws.sent[3] as Uint8Array;
    expect(refresh.length).toBe(1);
    expect(refresh[0]).toBe(0x02);
  });

  it("after init-ack(binary=false), legacy JSON is still emitted (daemon-mode fallback)", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-fallback", onData: () => {} }),
    );
    await settleAuth();
    const ws = latestSocket();

    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());

    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: false, chunkedReplay: false },
          serverState: {
            generation: 0,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    act(() => result.current.send({ type: "input", data: "x" }));
    // PTY generation gate: legacy JSON path also stamps `generation` (init-ack seeded 0).
    expect(ws.sent[1]).toBe(
      JSON.stringify({ type: "input", data: "x", generation: 0 }),
    );
  });

  /*
   * PTY generation gate: an OUTPUT frame whose generation is greater than init-ack's
   * (server auto-resumed mid-session, bumped generation, and emitted
   * the separator OUTPUT) must update the client's input-tag so the
   * next INPUT carries the new generation. Otherwise the server would
   * drop user keystrokes after auto-resume.
   */
  it("retags subsequent INPUT with the latest OUTPUT generation (PTY generation gate)", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-bump", onData: () => {} }),
    );
    await settleAuth();
    const ws = latestSocket();

    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: true, chunkedReplay: true },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    // Auto-resume on the server bumped generation 1 -> 2; the separator
    // OUTPUT lands here and must retag the client's currentGeneration.
    act(() => ws.fireMessage(encodeOutput(2, 1n, new Uint8Array([0x21]))));

    act(() => result.current.send({ type: "input", data: "k" }));
    const inputFrame = ws.sent.at(-1) as Uint8Array;
    expect(inputFrame[0]).toBe(0x00);
    expect(Array.from(inputFrame.slice(1, 5))).toEqual([0, 0, 0, 2]);
    expect(Array.from(inputFrame.slice(5))).toEqual([0x6b]);
  });

  /*
   * PTY generation gate: input that is enqueued while the WS is dropped
   * must keep the generation that was current at *enqueue* time, not the
   * gen that the reconnect's init-ack later seeds. If the gen ref were
   * reset on close, every reconnect would flush queued bytes as gen=0,
   * the server would coerce 0 to live gen, and stale terminal-reply
   * bytes (xterm.js DECRPM auto-replies queued during the gap) would
   * pour into the new shell's prompt -- exactly the auto-resume garbage
   * PTY generation gate is meant to suppress.
   */
  it("preserves enqueue-time generation across reconnect (PTY generation gate)", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-reconnect-gen", onData: () => {} }),
    );
    await settleAuth();
    const first = latestSocket();

    act(() => result.current.sendInit(80, 24));
    act(() => first.fireOpen());
    act(() =>
      first.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: true, chunkedReplay: true },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    // Transient WS drop. Auto-resume happens on the server side during
    // the gap, bumping its generation 1 -> 2.
    act(() => first.fireClose(1006));
    expect(result.current.status).toBe("reconnecting");

    // Keystroke typed during the disconnect window -- captured against
    // the last-known gen=1.
    act(() => result.current.send({ type: "input", data: "q" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35000);
    });

    const second = latestSocket();
    expect(second).not.toBe(first);
    act(() => second.fireOpen());

    // Queued input stays parked until the reconnect's init-ack. This is
    // the important fence for xterm auto-replies produced before attach
    // completes: never emit wire generation 0 once the server is about
    // to provide an authoritative generation.
    expect(second.sent).toEqual([
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: { binary: true, chunkedReplay: true },
      }),
    ]);

    // After init-ack on the second socket reseeds gen=2, fresh INPUT
    // tagged as gen=2 confirms the ref was overwritten authoritatively.
    act(() =>
      second.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: true, chunkedReplay: true },
          serverState: {
            generation: 2,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );
    const staleFrame = second.sent.at(-1) as Uint8Array;
    expect(staleFrame[0]).toBe(0x00);
    expect(Array.from(staleFrame.slice(1, 5))).toEqual([0, 0, 0, 1]);
    expect(Array.from(staleFrame.slice(5))).toEqual([0x71]);

    act(() => result.current.send({ type: "input", data: "r" }));
    const freshFrame = second.sent.at(-1) as Uint8Array;
    expect(freshFrame[0]).toBe(0x00);
    expect(Array.from(freshFrame.slice(1, 5))).toEqual([0, 0, 0, 2]);
    expect(Array.from(freshFrame.slice(5))).toEqual([0x72]);
  });

  it("uses in-memory lastSeen on transient reconnect after binary OUTPUT", async () => {
    const onData = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-out", onData }),
    );
    await settleAuth();
    const ws = latestSocket();

    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: true, chunkedReplay: true },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    const frame = encodeOutput(1, 5n, new TextEncoder().encode("hello"));
    act(() => ws.fireMessage(frame));

    expect(onData).toHaveBeenCalledWith("hello");
    expect(
      sessionStorage.getItem("parasor:terminal:lastSeen:s-out"),
    ).toBeNull();

    act(() => ws.fireClose(1006));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35000);
    });

    const second = latestSocket();
    expect(second).not.toBe(ws);
    act(() => second.fireOpen());
    expect(second.sent[0]).toBe(
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: {
          binary: true,
          chunkedReplay: true,
          lastSeen: { generation: 1, seq: "5" },
        },
      }),
    );
  });

  it("anchors lastSeen to serverState.lastDeliveredSeq on replay='full'", async () => {
    const onData = vi.fn();
    const onFullReplay = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-full", onData, onFullReplay }),
    );
    await settleAuth();
    const ws = latestSocket();

    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: true, chunkedReplay: true },
          serverState: {
            generation: 2,
            lastDeliveredSeq: "42",
            oldestSeq: "0",
          },
          replay: "full",
        }),
      ),
    );
    expect(onFullReplay).not.toHaveBeenCalled();
    act(() =>
      ws.fireMessage(JSON.stringify({ type: "replay", data: "snapshot" })),
    );

    expect(onFullReplay.mock.invocationCallOrder[0]).toBeLessThan(
      onData.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(onFullReplay).toHaveBeenCalledWith({ generation: 2, seq: "42" });
    expect(onData).toHaveBeenCalledWith("snapshot");
    expect(
      sessionStorage.getItem("parasor:terminal:lastSeen:s-full"),
    ).toBeNull();

    act(() => ws.fireClose(1006));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35000);
    });

    const second = latestSocket();
    expect(second).not.toBe(ws);
    act(() => second.fireOpen());
    expect(second.sent[0]).toBe(
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: {
          binary: true,
          chunkedReplay: true,
          lastSeen: { generation: 2, seq: "42" },
        },
      }),
    );
  });

  it("resets the terminal on replay='full' when an empty snapshot envelope arrives", async () => {
    const onFullReplay = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSocket({
        sessionId: "s-full-empty",
        onData: () => {},
        onFullReplay,
      }),
    );
    await settleAuth();
    const ws = latestSocket();

    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: true, chunkedReplay: true },
          serverState: {
            generation: 3,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "full",
        }),
      ),
    );
    expect(onFullReplay).not.toHaveBeenCalled();
    act(() => ws.fireMessage(JSON.stringify({ type: "replay", data: "" })));

    expect(onFullReplay).toHaveBeenCalledWith(null);
  });

  it("ignores stale persisted lastSeen on a fresh terminal mount", async () => {
    sessionStorage.setItem(
      "parasor:terminal:lastSeen:s-reco",
      JSON.stringify({ generation: 3, seq: "7" }),
    );
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-reco", onData: () => {} }),
    );
    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());

    expect(ws.sent[0]).toBe(
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: {
          binary: true,
          chunkedReplay: true,
        },
      }),
    );
  });

  it("ignores malformed binary frames silently", async () => {
    const onData = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-bad", onData }),
    );
    await settleAuth();
    const ws = latestSocket();

    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: true, chunkedReplay: true },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );

    // Unknown prefix -- must not crash and must not invoke onData.
    const garbage = new Uint8Array([0xff, 0xff]).buffer;
    act(() => ws.fireMessage(garbage));
    expect(onData).not.toHaveBeenCalled();
  });

  // WebSocket open-before-init regression: when the WS opens BEFORE sendInit (the
  // auth-fast race -- auth preflight resolves before the consumer's
  // xterm-setup effect fires sendInit), the open handler has no dims
  // to build the init frame from. sendInit must then nudge the unified
  // init helper so init is sent now, exactly once.
  it("sendInit dispatches init when called after the socket already opened", async () => {
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-late-init", onData: () => {} }),
    );
    await settleAuth();
    const ws = latestSocket();

    // Open fires while lastDimsRef is still null -- handler sends nothing.
    act(() => ws.fireOpen());
    expect(ws.sent).toEqual([]);

    // sendInit now fills dims and must trigger the (sole) init send path.
    act(() => result.current.sendInit(80, 24));
    expect(ws.sent).toEqual([
      JSON.stringify({
        type: "init",
        cols: 80,
        rows: 24,
        capabilities: { binary: true, chunkedReplay: true },
      }),
    ]);

    // Calling again must NOT re-send (initSentRef guards the single funnel).
    act(() => result.current.sendInit(80, 24));
    expect(ws.sent).toHaveLength(1);
  });

  // Binary output-before-init regression: binary OUTPUT arriving before init-ack (in
  // practice, a frame that races the init-ack timeout's close()) must
  // be dropped. Otherwise we'd spin up a TextDecoder and seed
  // lastSeen/currentGeneration from an un-acknowledged state.
  it("drops binary OUTPUT frames that arrive before init-ack", async () => {
    const onData = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId: "s-preack", onData }),
    );
    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());

    // Server sends a binary OUTPUT before init-ack -- protocol violation.
    const payload = new TextEncoder().encode("STRAY");
    act(() => ws.fireMessage(encodeOutput(99, 1n, payload)));
    expect(onData).not.toHaveBeenCalled();

    // After init-ack lands, normal OUTPUT must still flow.
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: true, chunkedReplay: true },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );
    act(() =>
      ws.fireMessage(encodeOutput(1, 1n, new TextEncoder().encode("ok"))),
    );
    expect(onData).toHaveBeenCalledWith("ok");
  });
});

/*
 * Foreground recovery + zombie-OPEN close handling. The hook listens to
 * visibilitychange / focus / pageshow / online so that an iOS Safari tab
 * returning from background -- where the server-side keepalive may have
 * already terminated the socket but the client still sees readyState=OPEN --
 * funnels into the reconnect path within ~1 frame instead of stalling
 * 30s on a zombie socket. These tests guard the four entry points.
 */
describe("useTerminalSocket -- foreground recovery", () => {
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {
      value: state,
      configurable: true,
    });
  }

  async function establish(sessionId: string) {
    setVisibility("visible");
    const { result } = renderHook(() =>
      useTerminalSocket({ sessionId, onData: () => {} }),
    );
    await settleAuth();
    const ws = latestSocket();
    act(() => result.current.sendInit(80, 24));
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage(
        JSON.stringify({
          type: "init-ack",
          capabilities: { binary: false, chunkedReplay: false },
          serverState: {
            generation: 1,
            lastDeliveredSeq: null,
            oldestSeq: null,
          },
          replay: "none",
        }),
      ),
    );
    return { result, ws };
  }

  it("force-closes a zombie-OPEN socket after long (>10s) background", async () => {
    const { result, ws } = await establish("s-fg-long");

    setVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    // Sit in background for longer than the 10s threshold.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(result.current.status).toBe("reconnecting");
  });

  it("does NOT close the socket on short (<10s) background", async () => {
    const { result, ws } = await establish("s-fg-short");

    setVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    expect(result.current.status).toBe("attached");
    // No second socket was constructed.
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("BFCache pageshow with persisted=true force-closes regardless of dwell", async () => {
    const { result, ws } = await establish("s-bfcache");

    // pageshow fires before visibilitychange in BFCache restore -- no prior
    // hidden state was observed, so backgroundedAt is 0 from the threshold
    // path's POV. The onPageShow handler must override that and still close.
    const ev = new Event("pageshow");
    Object.defineProperty(ev, "persisted", { value: true });
    act(() => window.dispatchEvent(ev));

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(result.current.status).toBe("reconnecting");
  });

  it("ignores pageshow with persisted=false (normal navigation)", async () => {
    const { ws, result } = await establish("s-pageshow-fresh");

    const ev = new Event("pageshow");
    Object.defineProperty(ev, "persisted", { value: false });
    act(() => window.dispatchEvent(ev));

    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    expect(result.current.status).toBe("attached");
  });

  it("online event force-closes the socket regardless of visibility", async () => {
    const { result, ws } = await establish("s-online");

    // Tab is still visible; network just bounced. The previous socket is
    // stale and the hook should funnel into reconnect anyway.
    act(() => window.dispatchEvent(new Event("online")));

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(result.current.status).toBe("reconnecting");
  });

  it("reconnects (not 'ended') on WS close code 1012 (PTY host unavailable)", async () => {
    const { result, ws } = await establish("s-1012");

    // Server emits 1012 when the PTY daemon disappears mid-session. The
    // session itself may still recover after daemon restart, so the hook
    // must NOT lock to 'ended' the way 1008 does.
    act(() => ws.fireClose(1012, "PTY host unavailable"));

    expect(result.current.status).toBe("reconnecting");
    expect(result.current.endedReason).toBeNull();

    // Confirm the backoff actually schedules a fresh socket.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });
});

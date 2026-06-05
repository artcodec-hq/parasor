/**
 * Journey smoke: the REAL Terminal rendered with the REAL
 * useTerminalSocket, mocking only the lowest boundaries (WebSocket, auth,
 * xterm). The fatal "connected-but-input-dead" bug lived in the INTERACTION
 * between the two -- Terminal's post-replay re-render changed the hook's
 * `initialLastSeen` prop, which (when it was an effect dependency) tore the
 * socket down. Component-only and hook-only tests each mocked the other and
 * missed it. This test exercises J3 (type -> socket) and J5 (replay -> cache
 * re-render must not drop the live socket).
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { MockXTerm, mockTermWrite, onDataRef } = vi.hoisted(() => {
  const onDataRef: { cb?: (data: string) => void } = {};
  const mockTermWrite = vi.fn((_data: string, callback?: () => void) => {
    callback?.();
  });
  // biome-ignore lint/complexity/useArrowFunction: Vitest constructor mocks must be constructable.
  const MockXTerm = vi.fn(function (_options?: unknown) {
    return {
      open: (container: HTMLElement) => {
        const element = document.createElement("div");
        element.className = "xterm";
        const screen = document.createElement("div");
        screen.className = "xterm-screen";
        element.appendChild(screen);
        container.appendChild(element);
      },
      dispose: vi.fn(),
      onData: (cb: (data: string) => void) => {
        onDataRef.cb = cb;
      },
      onScroll: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onSelectionChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn(),
      scrollToTop: vi.fn(),
      getSelection: vi.fn().mockReturnValue(""),
      hasSelection: vi.fn().mockReturnValue(false),
      clearSelection: vi.fn(),
      selectLines: vi.fn(),
      loadAddon: vi.fn(),
      registerLinkProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      resize: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      select: vi.fn(),
      focus: vi.fn(),
      write: mockTermWrite,
      attachCustomKeyEventHandler: vi.fn(),
      buffer: { active: { viewportY: 5, baseY: 5, getLine: vi.fn() } },
      textarea: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      get modes() {
        return { showCursor: true, mouseTrackingMode: "none" as const };
      },
      element: null,
      cols: 80,
      rows: 24,
      options: {},
      unicode: { activeVersion: "6" as string, register: vi.fn() },
    };
  });
  return { MockXTerm, mockTermWrite, onDataRef };
});

const ensureAuthenticatedMock = vi.fn(async () => true);

vi.mock("@xterm/xterm", () => ({ Terminal: MockXTerm }));
vi.mock("@xterm/addon-fit", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest constructor mocks must be constructable.
  FitAddon: vi.fn(function () {
    return {
      fit: vi.fn(),
      proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
      dispose: vi.fn(),
    };
  }),
}));
vi.mock("@xterm/addon-webgl", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest constructor mocks must be constructable.
  WebglAddon: vi.fn(function () {
    return {
      dispose: vi.fn(),
      clearTextureAtlas: vi.fn(),
      onContextLoss: vi.fn(),
    };
  }),
}));
vi.mock("@xterm/addon-unicode11", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest constructor mocks must be constructable.
  Unicode11Addon: vi.fn(function () {
    return {};
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest constructor mocks must be constructable.
  WebLinksAddon: vi.fn(function () {
    return {};
  }),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../../../lib/auth-fetch.js", () => ({
  ensureAuthenticated: () => ensureAuthenticatedMock(),
  authFetch: vi.fn(),
}));

class MockResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

class FakeWebSocket {
  static OPEN = 1 as const;
  static CLOSED = 3 as const;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = "blob";
  sent: Array<string | Uint8Array> = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();
  constructor(public url: string) {
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
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    for (const h of this.listeners.get("close") ?? [])
      h({ code: 1005, reason: "" } as CloseEvent);
  }
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN;
    for (const h of this.listeners.get("open") ?? []) h(new Event("open"));
  }
  fireMessage(data: string | ArrayBuffer) {
    for (const h of this.listeners.get("message") ?? [])
      h({ data } as MessageEvent);
  }
}

function installStorage(name: "localStorage" | "sessionStorage") {
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
}

import { authFetch } from "../../../lib/auth-fetch.js";
import { SettingsProvider } from "../../../lib/settings-context.js";
import { clearTerminalReplayCache } from "../../../lib/terminal-replay-cache.js";
import { Terminal } from "./Terminal.js";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);
const mockAuthFetch = vi.mocked(authFetch);

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const INIT_ACK_FULL = JSON.stringify({
  type: "init-ack",
  capabilities: { binary: false, chunkedReplay: false },
  serverState: { generation: 7, lastDeliveredSeq: "3", oldestSeq: "1" },
  replay: "full",
});

function initAckNone(generation: number): string {
  return JSON.stringify({
    type: "init-ack",
    capabilities: { binary: false, chunkedReplay: false },
    serverState: { generation, lastDeliveredSeq: null, oldestSeq: null },
    replay: "none",
  });
}

function initAckDelta(generation: number): string {
  return JSON.stringify({
    type: "init-ack",
    capabilities: { binary: true, chunkedReplay: true },
    serverState: { generation, lastDeliveredSeq: "4", oldestSeq: "1" },
    replay: "delta",
  });
}

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

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// Drive a fresh socket from construction through init-ack so a test can start
// from a live, input-ready terminal.
async function openAndAck(ws: FakeWebSocket, generation: number) {
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
  ws.fireOpen();
  await flush();
  act(() => ws.fireMessage(initAckNone(generation)));
  await flush();
}

beforeEach(() => {
  installStorage("localStorage");
  installStorage("sessionStorage");
  FakeWebSocket.instances = [];
  onDataRef.cb = undefined;
  ensureAuthenticatedMock.mockResolvedValue(true);
  mockAuthFetch.mockResolvedValue(new Response(null, { status: 204 }));
  clearTerminalReplayCache("s1");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:3000" });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Terminal × useTerminalSocket integration", () => {
  it("keeps one live socket through replay and routes typed input to the PTY", async () => {
    render(<Terminal sessionId="s1" projectId="p1" />, { wrapper });

    // Auth resolves and the first socket is constructed.
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];

    // Container has zero size in jsdom, so init commits via the 500ms fallback
    // timer, which calls sendInit with the xterm dims.
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    ws.fireOpen();
    await flush();

    // init frame was sent on the one socket.
    expect(ws.sent.some((f) => String(f).includes('"type":"init"'))).toBe(true);

    // Server acks with a full replay, then delivers the snapshot. Completing
    // the replay stores a fresh lastSeen in the cache and re-renders Terminal
    // with a new initialLastSeen identity.
    act(() => ws.fireMessage(INIT_ACK_FULL));
    await flush();
    act(() => ws.fireMessage(JSON.stringify({ type: "replay", data: "snap" })));
    await flush();

    // J5: the post-replay re-render must NOT tear the socket down.
    expect(FakeWebSocket.instances).toHaveLength(1);

    // J3: a typed character reaches the live, init-acked socket as input.
    const typed = ws.sent.length;
    act(() => onDataRef.cb?.("x"));
    const newFrames = ws.sent.slice(typed).map(String);
    expect(newFrames.some((f) => f.includes('"data":"x"'))).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("recovers input after a background->foreground forced reconnect (J4)", async () => {
    render(<Terminal sessionId="s1" projectId="p1" />, { wrapper });
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const first = FakeWebSocket.instances[0];
    await openAndAck(first, 7);

    // Input flows on the original socket.
    act(() => onDataRef.cb?.("a"));
    expect(first.sent.some((f) => String(f).includes('"data":"a"'))).toBe(true);

    // Background long enough to cross the zombie-socket threshold, then return.
    // The hook force-closes the (possibly half-open) socket and reconnects.
    act(() => setVisibility("hidden"));
    await act(async () => {
      vi.advanceTimersByTime(11_000);
      await Promise.resolve();
    });
    act(() => setVisibility("visible"));
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      await Promise.resolve();
    });

    // A second socket was created and must re-handshake (lastDims survives the
    // reconnect, so init is sent without a remount).
    expect(FakeWebSocket.instances.length).toBe(2);
    const second = FakeWebSocket.instances[1];
    second.fireOpen();
    await flush();
    expect(second.sent.some((f) => String(f).includes('"type":"init"'))).toBe(
      true,
    );
    act(() => second.fireMessage(initAckNone(8)));
    await flush();

    // J4: input now reaches the NEW live socket -- not silently lost.
    const before = second.sent.length;
    act(() => onDataRef.cb?.("b"));
    const frames = second.sent.slice(before).map(String);
    expect(frames.some((f) => f.includes('"data":"b"'))).toBe(true);
  });

  it("does not recreate xterm across replay and socket reconnect(xterm churn guard)", async () => {
    // The xterm mount effect has a large dependency array; if any dep churns
    // identity on re-render the whole terminal is disposed and rebuilt --
    // scrollback lost, input re-wired, a visible flicker. This pins the running
    // lifecycle (connect -> full replay -> forced reconnect) to a SINGLE xterm
    // construction, guarding the entire class of "a re-render tore the terminal
    // down" regressions that unit tests miss.
    render(<Terminal sessionId="s1" projectId="p1" />, { wrapper });
    await flush();
    const ws = FakeWebSocket.instances[0];

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    ws.fireOpen();
    await flush();
    // Full replay -> cache store -> re-render (the path that broke input).
    act(() => ws.fireMessage(INIT_ACK_FULL));
    await flush();
    act(() => ws.fireMessage(JSON.stringify({ type: "replay", data: "snap" })));
    await flush();

    // Forced reconnect (background->foreground) -- must reconnect the socket
    // WITHOUT remounting xterm.
    act(() => setVisibility("hidden"));
    await act(async () => {
      vi.advanceTimersByTime(11_000);
      await Promise.resolve();
    });
    act(() => setVisibility("visible"));
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      await Promise.resolve();
    });

    // One terminal for the whole running session; the socket may have churned
    // but the xterm instance (and its scrollback) is preserved.
    expect(MockXTerm).toHaveBeenCalledTimes(1);
  });

  it("restores cached replay on remount and catches up from cached lastSeen", async () => {
    const firstRender = render(<Terminal sessionId="s1" projectId="p1" />, {
      wrapper,
    });
    await flush();
    const first = FakeWebSocket.instances[0];

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    first.fireOpen();
    await flush();

    act(() => first.fireMessage(INIT_ACK_FULL));
    await flush();
    act(() =>
      first.fireMessage(JSON.stringify({ type: "replay", data: "snap" })),
    );
    await flush();

    expect(mockTermWrite).toHaveBeenCalledWith("snap", expect.any(Function));
    firstRender.unmount();
    await flush();

    mockTermWrite.mockClear();
    render(<Terminal sessionId="s1" projectId="p1" />, { wrapper });
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1];

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mockTermWrite).toHaveBeenCalledWith("snap", expect.any(Function));

    second.fireOpen();
    await flush();
    const initFrame = JSON.parse(String(second.sent[0]));
    expect(initFrame).toMatchObject({
      type: "init",
      capabilities: {
        binary: true,
        chunkedReplay: true,
        lastSeen: { generation: 7, seq: "3" },
      },
    });

    act(() => second.fireMessage(initAckDelta(7)));
    await flush();
    act(() =>
      second.fireMessage(
        encodeOutput(7, 4n, new TextEncoder().encode("\ncatch-up")),
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(16);
      await Promise.resolve();
    });
    await flush();

    expect(mockTermWrite).toHaveBeenCalledWith("\ncatch-up");
  });
});

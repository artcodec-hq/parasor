import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disableTerminalTrace,
  enableTerminalTrace,
  isTerminalTraceEnabled,
  registerTerminalBottomRowsSnapshotProvider,
  scheduleClientStartupDiagnosticCapture,
  scheduleTerminalInputDiagnosticCapture,
  startTerminalMainThreadTrace,
  subscribeTerminalTraceEnabled,
  traceTerminalEvent,
} from "./terminal-trace.js";

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

describe("terminal-trace", () => {
  beforeEach(() => {
    installStorage("localStorage");
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    window.parasorTerminalTrace?.clear();
    disableTerminalTrace();
    window.parasorTerminalTrace?.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is disabled by default and records sanitized metadata when enabled", () => {
    traceTerminalEvent("socket-queue", {
      sessionId: "s1",
      dataLength: 6,
    });
    expect(window.parasorTerminalTrace?.dump() ?? []).toEqual([]);

    enableTerminalTrace();
    expect(isTerminalTraceEnabled()).toBe(true);
    traceTerminalEvent("socket-queue", {
      sessionId: "s1",
      dataLength: 6,
    });

    expect(window.parasorTerminalTrace?.dump()).toEqual([
      expect.objectContaining({
        seq: 1,
        type: "socket-queue",
        sessionId: "s1",
        dataLength: 6,
      }),
    ]);
    expect(JSON.stringify(window.parasorTerminalTrace?.dump())).not.toContain(
      "secret",
    );
  });

  it("notifies subscribers when terminal trace is enabled or disabled", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalTraceEnabled(listener);

    enableTerminalTrace();
    enableTerminalTrace();
    disableTerminalTrace();
    unsubscribe();
    enableTerminalTrace();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns a no-op main-thread sampler when disabled", () => {
    const stop = startTerminalMainThreadTrace("s1");
    expect(() => stop()).not.toThrow();
  });

  it("keeps verbose trace local and does not upload client batches", () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    enableTerminalTrace();
    traceTerminalEvent("virtual-keyboard-height-change", {
      sessionId: "s1",
      height: 300,
      durationMs: 16,
    });
    traceTerminalEvent("xterm-write-start", {
      sessionId: "s1",
      dataLength: 11,
      cursorX: 4,
      cursorY: 5,
      viewportY: 3,
      baseY: 9,
      bufferType: "normal",
    });

    window.parasorTerminalTrace?.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.parasorTerminalTrace?.dump()).toEqual([
      expect.objectContaining({
        type: "virtual-keyboard-height-change",
        sessionId: "s1",
        height: 300,
        durationMs: 16,
      }),
      expect.objectContaining({
        type: "xterm-write-start",
        sessionId: "s1",
        dataLength: 11,
        cursorX: 4,
        cursorY: 5,
        viewportY: 3,
        baseY: 9,
        bufferType: "normal",
      }),
    ]);
  });

  it("records only long-delay warnings while verbose trace is disabled", () => {
    traceTerminalEvent("terminal-mount", { sessionId: "s1" });
    traceTerminalEvent("terminal-resize-apply", {
      sessionId: "s1",
      durationMs: 999,
    });
    traceTerminalEvent("xterm-replay-paint", {
      sessionId: "s1",
      sinceReplayStartMs: 1500,
    });
    traceTerminalEvent("socket-init-timeout", {
      sessionId: "s1",
      timeoutMs: 10_000,
    });

    expect(window.parasorTerminalTrace?.dump()).toEqual([
      expect.objectContaining({
        type: "xterm-replay-paint",
        sessionId: "s1",
        sinceReplayStartMs: 1500,
        warning: true,
        warningMetric: "sinceReplayStartMs",
        warningThresholdMs: 1500,
      }),
      expect.objectContaining({
        type: "socket-init-timeout",
        sessionId: "s1",
        timeoutMs: 10_000,
        warning: true,
        warningMetric: "timeoutMs",
      }),
    ]);
  });

  it("does not call trace APIs for local enable, disable, or warnings", () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ enabled: true }), { status: 200 }),
      );

    expect(isTerminalTraceEnabled()).toBe(false);
    traceTerminalEvent("main-thread-drift", { sessionId: "s1", driftMs: 300 });
    enableTerminalTrace();
    window.parasorTerminalTrace?.flush();
    disableTerminalTrace();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes bottom-row snapshots locally without fetching", () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ enabled: true }), { status: 200 }),
      );

    expect(window.parasorTerminalTrace?.dumpBottomRows()).toBeNull();

    const unregister = registerTerminalBottomRowsSnapshotProvider(
      (rowCount = 8) => ({
        rowCount,
        rowsSampled: [{ line: 7, text: "composer" }],
      }),
    );

    expect(window.parasorTerminalTrace?.dumpBottomRows(1)).toEqual({
      rowCount: 1,
      rowsSampled: [{ line: 7, text: "composer" }],
    });
    unregister();
    expect(window.parasorTerminalTrace?.dumpBottomRows()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("selects local bottom-row snapshots by requested source identity", () => {
    const unregisterA = registerTerminalBottomRowsSnapshotProvider(
      (rowCount = 8) => ({
        rowCount,
        rowsSampled: [{ line: 7, text: "a" }],
      }),
      { sessionId: "s-a", paneId: "pane-a" },
    );
    const unregisterB = registerTerminalBottomRowsSnapshotProvider(
      (rowCount = 8) => ({
        rowCount,
        rowsSampled: [{ line: 9, text: "b" }],
      }),
      { sessionId: "s-b", paneId: "pane-b" },
    );

    expect(window.parasorTerminalTrace?.dumpBottomRows(1)).toEqual({
      rowCount: 1,
      rowsSampled: [{ line: 9, text: "b" }],
    });
    expect(
      window.parasorTerminalTrace?.dumpBottomRows({
        rowCount: 2,
        sessionId: "s-a",
        paneId: "pane-a",
      }),
    ).toEqual({
      rowCount: 2,
      rowsSampled: [{ line: 7, text: "a" }],
    });
    expect(
      window.parasorTerminalTrace?.dumpBottomRows({
        rowCount: 2,
        sessionId: "s-missing",
      }),
    ).toBeNull();

    unregisterA();
    unregisterB();
  });

  it("uploads terminal diagnostics when explicitly requested", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, accepted: 1 }), {
        status: 200,
      }),
    );
    enableTerminalTrace();
    traceTerminalEvent("terminal-resize-apply", {
      sessionId: "s431",
      clientId: "c431",
      rows: 24,
      viewportY: 10,
      baseY: 20,
    });
    const unregister = registerTerminalBottomRowsSnapshotProvider(
      () => ({
        cols: 80,
        rows: 24,
        renderer: {
          requestedWebgl: true,
          effectiveRenderer: "webgl",
          webglStatus: "attached",
          contextLossCount: 0,
          fontLoadingDoneCount: 1,
          atlasRebuildCount: 1,
          iosFontPrefetchStatus: "not-ios",
          unicodeVersion: "11",
          isTouch: false,
          isIos: false,
          fontFamily: "SF Mono, monospace",
          fontSize: 13,
        },
        rowsSampled: [
          {
            line: 20,
            viewportRow: 23,
            text: "composer",
            attrRuns: [{ start: 0, end: 8, attrs: { bg: 240 } }],
          },
        ],
      }),
      { sessionId: "s431", paneId: "pane-431" },
    );

    await expect(
      window.parasorTerminalTrace?.captureTerminalInput("visible symptom"),
    ).resolves.toEqual({ ok: true, accepted: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/debug/terminal-trace/client-diagnostic");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      diagnostic: "terminal-input-background",
      reason: "visible symptom",
      sessionId: "s431",
      clientId: "c431",
      source: {
        status: "selected",
        requested: { sessionId: "s431" },
        selected: { sessionId: "s431", paneId: "pane-431" },
      },
      bottomRows: {
        cols: 80,
        rows: 24,
        renderer: {
          requestedWebgl: true,
          effectiveRenderer: "webgl",
          webglStatus: "attached",
          fontFamily: "SF Mono, monospace",
        },
        rowsSampled: [{ line: 20, text: "composer" }],
      },
    });
    expect(body.events).toEqual([
      expect.objectContaining({
        type: "terminal-resize-apply",
        sessionId: "s431",
        clientId: "c431",
      }),
    ]);
    unregister();
  });

  it("uploads bounded terminal diagnostics by default for high-signal transitions without duplicate snapshots", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, accepted: 1 }), {
        status: 200,
      }),
    );
    let contextLossCount = 0;
    const unregister = registerTerminalBottomRowsSnapshotProvider(
      () => ({
        cols: 80,
        rows: 24,
        viewportY: 10,
        baseY: 20,
        renderer: {
          requestedWebgl: true,
          effectiveRenderer: contextLossCount > 0 ? "dom" : "webgl",
          webglStatus: contextLossCount > 0 ? "context-lost" : "attached",
          contextLossCount,
          fontLoadingDoneCount: 0,
          atlasRebuildCount: 0,
          iosFontPrefetchStatus: "not-ios",
          unicodeVersion: "11",
          isTouch: false,
          isIos: false,
          fontFamily: "SF Mono, monospace",
          fontSize: 13,
        },
        rowsSampled: [
          {
            line: 31,
            viewportRow: 23,
            text: "composer",
            attrRuns: [{ start: 0, end: 8, attrs: { bg: 240 } }],
          },
        ],
      }),
      { sessionId: "s-auto", paneId: "pane-auto" },
    );

    scheduleTerminalInputDiagnosticCapture("xterm-replay-paint", {
      type: "xterm-replay-paint",
      sessionId: "s-auto",
      rows: 24,
      viewportY: 10,
      baseY: 20,
    });
    scheduleTerminalInputDiagnosticCapture("xterm-replay-paint", {
      type: "xterm-replay-paint",
      sessionId: "s-auto",
      rows: 24,
      viewportY: 10,
      baseY: 20,
    });
    contextLossCount = 1;
    scheduleTerminalInputDiagnosticCapture("xterm-replay-paint", {
      type: "xterm-replay-paint",
      sessionId: "s-auto",
      rows: 24,
      viewportY: 10,
      baseY: 20,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      diagnostic: "terminal-input-background",
      reason: "xterm-replay-paint",
      sessionId: "s-auto",
      source: {
        status: "selected",
        requested: { sessionId: "s-auto" },
        selected: { sessionId: "s-auto", paneId: "pane-auto" },
      },
      bottomRows: {
        cols: 80,
        rows: 24,
        renderer: {
          effectiveRenderer: "webgl",
          webglStatus: "attached",
          contextLossCount: 0,
        },
        rowsSampled: [{ line: 31, text: "composer" }],
      },
    });
    expect(body.events).toEqual([
      expect.objectContaining({
        type: "xterm-replay-paint",
        sessionId: "s-auto",
        rows: 24,
        viewportY: 10,
        baseY: 20,
      }),
    ]);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody).toMatchObject({
      bottomRows: {
        renderer: {
          effectiveRenderer: "dom",
          webglStatus: "context-lost",
          contextLossCount: 1,
        },
      },
    });
    unregister();
  });

  it("fails closed for targeted terminal diagnostics when the requested terminal is not mounted", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, accepted: 1 }), {
        status: 200,
      }),
    );
    const unregister = registerTerminalBottomRowsSnapshotProvider(
      () => ({
        cols: 80,
        rows: 24,
        rowsSampled: [{ line: 1, text: "wrong terminal" }],
      }),
      { sessionId: "other-session", paneId: "other-pane" },
    );

    await window.parasorTerminalTrace?.captureTerminalInput("manual-target", {
      sessionId: "missing-session",
      paneId: "missing-pane",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      diagnostic: "terminal-input-background",
      reason: "manual-target",
      sessionId: "missing-session",
      source: {
        status: "missing",
        requested: {
          sessionId: "missing-session",
          paneId: "missing-pane",
        },
      },
      bottomRows: null,
    });
    expect(JSON.stringify(body)).not.toContain("wrong terminal");
    unregister();
  });

  it("uploads bounded startup diagnostics without terminal bottom rows", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, accepted: 1 }), {
        status: 200,
      }),
    );

    scheduleClientStartupDiagnosticCapture("event-socket-snapshot-timeout", {
      type: "event-socket-snapshot-timeout",
      timeoutMs: 10_000,
      durationMs: 10_050,
      routeKind: "session",
      status: "timeout",
    });
    scheduleClientStartupDiagnosticCapture("event-socket-snapshot-timeout", {
      type: "event-socket-snapshot-timeout",
      timeoutMs: 10_000,
      durationMs: 10_050,
      routeKind: "session",
      status: "timeout",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/debug/terminal-trace/client-diagnostic");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      diagnostic: "client-startup-load",
      reason: "event-socket-snapshot-timeout",
      bottomRows: null,
    });
    expect(body.events).toEqual([
      expect.objectContaining({
        type: "event-socket-snapshot-timeout",
        timeoutMs: 10_000,
        durationMs: 10_050,
      }),
    ]);
  });

  it("does not upload client trace events while disabled", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    traceTerminalEvent("virtual-keyboard-height-change", {
      sessionId: "s1",
      height: 300,
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("samples high-volume output events without dropping sparse diagnostics", () => {
    enableTerminalTrace();

    for (let i = 0; i < 500; i++) {
      traceTerminalEvent("socket-output", {
        sessionId: "s1",
        dataLength: 1,
        byteLength: 2,
      });
    }
    traceTerminalEvent("virtual-keyboard-height-change", {
      sessionId: "s1",
      height: 300,
    });
    traceTerminalEvent("terminal-resize-apply", {
      sessionId: "s1",
      cols: 80,
      rows: 24,
      viewportY: 10,
      baseY: 100,
    });
    for (let i = 0; i < 500; i++) {
      traceTerminalEvent("xterm-write-start", {
        sessionId: "s1",
        dataLength: 3,
      });
    }

    const events = window.parasorTerminalTrace?.dump() ?? [];
    const socketOutputEvents = events.filter(
      (event) => event.type === "socket-output",
    );
    const writeStartEvents = events.filter(
      (event) => event.type === "xterm-write-start",
    );

    expect(socketOutputEvents.length).toBeLessThan(20);
    expect(writeStartEvents.length).toBeLessThan(20);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "virtual-keyboard-height-change",
          height: 300,
        }),
        expect.objectContaining({
          type: "terminal-resize-apply",
          viewportY: 10,
          baseY: 100,
        }),
      ]),
    );
    expect(socketOutputEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sampledEvents: expect.any(Number),
          sampledDataLength: expect.any(Number),
          sampledByteLength: expect.any(Number),
        }),
      ]),
    );
    expect(
      socketOutputEvents.some((event) => (event.sampledEvents ?? 0) >= 100),
    ).toBe(true);
  });

  it("does not sync tracing state from the server", () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ enabled: true }), { status: 200 }),
      );

    expect(isTerminalTraceEnabled()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

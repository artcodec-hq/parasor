import { describe, expect, it } from "vitest";
import type { TerminalTraceEvent } from "./terminal-trace.js";
import { computeTerminalKpis } from "./terminal-trace-kpi.js";

let seq = 0;
function ev(
  type: string,
  t: number,
  fields: Partial<TerminalTraceEvent> = {},
): TerminalTraceEvent {
  return { seq: ++seq, t, type, ...fields };
}

describe("computeTerminalKpis", () => {
  it("measures K1 switch-to-paint from mount to the first painted replay", () => {
    const report = computeTerminalKpis([
      ev("terminal-mount", 100, { sessionId: "s1" }),
      ev("xterm-cache-replay-paint", 140, { sessionId: "s1" }),
      ev("terminal-mount", 200, { sessionId: "s2" }),
      ev("xterm-replay-paint", 260, { sessionId: "s2" }),
    ]);
    expect(report.k1SwitchToPaint.count).toBe(2);
    expect(report.k1SwitchToPaint.minMs).toBe(40);
    expect(report.k1SwitchToPaint.maxMs).toBe(60);
  });

  it("measures K3 blank window from reset to repaint per replay cycle", () => {
    const report = computeTerminalKpis([
      ev("xterm-replay-reset", 1000, { sessionId: "s1" }),
      ev("xterm-replay-paint", 1080, { sessionId: "s1" }),
      ev("xterm-cache-replay-start", 2000, { sessionId: "s1" }),
      ev("xterm-cache-replay-paint", 2030, { sessionId: "s1" }),
    ]);
    expect(report.k3ClearRedrawBlank.count).toBe(2);
    expect(report.k3ClearRedrawBlank.minMs).toBe(30);
    expect(report.k3ClearRedrawBlank.maxMs).toBe(80);
  });

  it("aggregates K2 resize durations and counts the anchor-changed signature", () => {
    const report = computeTerminalKpis([
      ev("terminal-resize-apply", 10, {
        durationMs: 12,
        resizeDurationMs: 4,
        reason: "anchor-changed",
      }),
      ev("terminal-resize-apply", 20, {
        durationMs: 8,
        resizeDurationMs: 2,
        reason: "was-at-bottom",
      }),
      ev("terminal-resize-deferred-flush", 21),
      ev("terminal-history-load-suppressed", 22),
      ev("main-thread-drift", 30, { driftMs: 70 }),
    ]);
    expect(report.k2KeyboardResize.maxMs).toBe(12);
    expect(report.k2ResizeInner.maxMs).toBe(4);
    expect(report.signatures.anchorChangedResizes).toBe(1);
    expect(report.signatures.deferredResizeFlushes).toBe(1);
    expect(report.signatures.historyLoadSuppressed).toBe(1);
    expect(report.signatures.maxMainThreadDriftMs).toBe(70);
  });

  it("does not pair a paint that precedes its start", () => {
    const report = computeTerminalKpis([
      ev("xterm-replay-paint", 50, { sessionId: "s1" }),
      ev("xterm-replay-reset", 100, { sessionId: "s1" }),
    ]);
    expect(report.k3ClearRedrawBlank.count).toBe(0);
  });

  it("measures K1 switch via visible-refresh to the next render", () => {
    const report = computeTerminalKpis([
      ev("terminal-visible-refresh", 500, { sessionId: "s1" }),
      ev("xterm-render", 530, { sessionId: "s1" }),
    ]);
    expect(report.k1SwitchToPaint.count).toBe(1);
    expect(report.k1SwitchToPaint.maxMs).toBe(30);
  });

  it("drops a cross-episode mount whose paint never arrived within the window", () => {
    // mount with no nearby paint must not pair with a paint minutes later.
    const report = computeTerminalKpis([
      ev("terminal-mount", 0, { sessionId: "s1" }),
      ev("xterm-cache-replay-paint", 200_000, { sessionId: "s1" }),
    ]);
    expect(report.k1SwitchToPaint.count).toBe(0);
  });

  it("returns zeroed stats for an empty trace", () => {
    const report = computeTerminalKpis([]);
    expect(report.k1SwitchToPaint).toEqual({
      count: 0,
      minMs: 0,
      medianMs: 0,
      maxMs: 0,
    });
  });
});

import type { TerminalTraceEvent } from "./terminal-trace.js";

/**
 * Terminal trace KPI harness. Folds the raw trace ring into keyboard/redraw
 * metrics plus symptom-signature counts. Pure and read-only so it can run
 * over a live `dump()` or a saved baseline JSON.
 *
 * - K1 switch/display: terminal mount -> first painted replay (tab switch feel)
 * - K2 keyboard resize: time inside `term.resize()` + the apply pass (blink)
 * - K3 clear-redraw blank: reset -> repaint window during a replay (black flash)
 */
export interface DurationStats {
  count: number;
  minMs: number;
  medianMs: number;
  maxMs: number;
}

export interface TerminalKpiReport {
  k1SwitchToPaint: DurationStats;
  k2KeyboardResize: DurationStats;
  k2ResizeInner: DurationStats;
  k3ClearRedrawBlank: DurationStats;
  signatures: {
    anchorChangedResizes: number;
    deferredResizeFlushes: number;
    historyLoadSuppressed: number;
    mainThreadDriftEvents: number;
    maxMainThreadDriftMs: number;
  };
}

function stats(samples: readonly number[]): DurationStats {
  if (samples.length === 0) {
    return { count: 0, minMs: 0, medianMs: 0, maxMs: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    count: sorted.length,
    minMs: round(sorted[0]),
    medianMs: round(median),
    maxMs: round(sorted[sorted.length - 1]),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Forward-pair each `from` event with the first later `to` event sharing the
 * same sessionId, returning `to.t - from.t`. Each `to` is consumed at most
 * once so a burst of starts maps to its own ends rather than collapsing to
 * one. `maxWindowMs` drops a pair whose gap exceeds it: a `from` whose matching
 * `to` never arrived (terminal unmounted, switched away) would otherwise pair
 * with an unrelated `to` from a much later episode and report a bogus
 * multi-second/minute "duration".
 */
function pairElapsed(
  events: readonly TerminalTraceEvent[],
  fromType: string,
  toType: string,
  maxWindowMs = Number.POSITIVE_INFINITY,
): number[] {
  const pendingBySession = new Map<string, number[]>();
  const out: number[] = [];
  for (const event of events) {
    const key = event.sessionId ?? "";
    if (event.type === fromType) {
      const queue = pendingBySession.get(key) ?? [];
      queue.push(event.t);
      pendingBySession.set(key, queue);
      continue;
    }
    if (event.type === toType) {
      const queue = pendingBySession.get(key);
      const start = queue?.shift();
      if (start === undefined) continue;
      const elapsed = event.t - start;
      if (elapsed >= 0 && elapsed <= maxWindowMs) out.push(elapsed);
    }
  }
  return out;
}

// Initial display can wait on the socket; a switch repaint should be quick. The
// window only has to be tight enough to reject cross-episode mispairs.
const DISPLAY_WINDOW_MS = 8000;
const SWITCH_WINDOW_MS = 2000;

export function computeTerminalKpis(
  events: readonly TerminalTraceEvent[],
): TerminalKpiReport {
  // K1: first display = mount -> first painted replay; switch = a retained pane
  // becoming visible (`terminal-visible-refresh`) -> its next render. A pane
  // switch does NOT remount, so mount->paint alone misses the switch case.
  const k1 = pairElapsed(
    events,
    "terminal-mount",
    "xterm-cache-replay-paint",
    DISPLAY_WINDOW_MS,
  )
    .concat(
      pairElapsed(
        events,
        "terminal-mount",
        "xterm-replay-paint",
        DISPLAY_WINDOW_MS,
      ),
    )
    .concat(
      pairElapsed(
        events,
        "terminal-visible-refresh",
        "xterm-render",
        SWITCH_WINDOW_MS,
      ),
    );

  // K3: blank window = the moment the screen is cleared until it repaints,
  // for both the full-replay (reset) and cached-replay (start) restore paths.
  const k3 = pairElapsed(
    events,
    "xterm-replay-reset",
    "xterm-replay-paint",
    DISPLAY_WINDOW_MS,
  ).concat(
    pairElapsed(
      events,
      "xterm-cache-replay-start",
      "xterm-cache-replay-paint",
      DISPLAY_WINDOW_MS,
    ),
  );

  const resizeApplies = events.filter(
    (event) => event.type === "terminal-resize-apply",
  );
  const k2Outer = resizeApplies
    .map((event) => event.durationMs)
    .filter((value): value is number => typeof value === "number");
  const k2Inner = resizeApplies
    .map((event) => event.resizeDurationMs)
    .filter((value): value is number => typeof value === "number");

  let maxDrift = 0;
  let driftEvents = 0;
  for (const event of events) {
    if (event.type === "main-thread-drift") {
      driftEvents += 1;
      if (typeof event.driftMs === "number") {
        maxDrift = Math.max(maxDrift, event.driftMs);
      }
    }
  }

  return {
    k1SwitchToPaint: stats(k1),
    k2KeyboardResize: stats(k2Outer),
    k2ResizeInner: stats(k2Inner),
    k3ClearRedrawBlank: stats(k3),
    signatures: {
      anchorChangedResizes: resizeApplies.filter(
        (event) => event.reason === "anchor-changed",
      ).length,
      deferredResizeFlushes: events.filter(
        (event) => event.type === "terminal-resize-deferred-flush",
      ).length,
      historyLoadSuppressed: events.filter(
        (event) => event.type === "terminal-history-load-suppressed",
      ).length,
      mainThreadDriftEvents: driftEvents,
      maxMainThreadDriftMs: round(maxDrift),
    },
  };
}

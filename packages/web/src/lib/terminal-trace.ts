import { authFetch } from "./auth-fetch.js";
import {
  computeTerminalKpis,
  type TerminalKpiReport,
} from "./terminal-trace-kpi.js";

const TRACE_STORAGE_KEY = "parasor:terminal-trace";
const TRACE_LIMIT = 2000;
const MAIN_THREAD_INTERVAL_MS = 250;
const MAIN_THREAD_DRIFT_THRESHOLD_MS = 50;
const CLIENT_OUTPUT_SAMPLE_INTERVAL_MS = 2000;
const CLIENT_OUTPUT_SAMPLE_COUNT = 100;
const CLIENT_OUTPUT_SAMPLE_TYPES = new Set([
  "socket-output",
  "xterm-output-batch",
  "xterm-write-start",
  "xterm-write-callback",
]);
const WARNING_DURATION_THRESHOLD_MS = 1000;
const WARNING_REPLAY_THRESHOLD_MS = 1500;
const WARNING_DRIFT_THRESHOLD_MS = 250;
const WARNING_DELAY_THRESHOLD_MS = 5000;
const TERMINAL_INPUT_DIAGNOSTIC = "terminal-input-background";
const CLIENT_STARTUP_DIAGNOSTIC = "client-startup-load";
const TERMINAL_INPUT_RECENT_EVENT_LIMIT = 80;
const TERMINAL_INPUT_BOTTOM_ROW_COUNT = 12;
const TERMINAL_INPUT_AUTO_CAPTURE_LIMIT = 24;
const CLIENT_STARTUP_AUTO_CAPTURE_LIMIT = 16;
type WarningMetric =
  | "driftMs"
  | "sinceReplayStartMs"
  | "durationMs"
  | "delayMs";

export type TerminalTraceEvent = {
  seq: number;
  t: number;
  type: string;
  sessionId?: string | null;
  clientId?: string;
  dataLength?: number;
  byteLength?: number;
  queueLength?: number;
  readyState?: number;
  status?: string;
  routeKind?: string;
  surface?: string;
  paneId?: string | null;
  cols?: number;
  rows?: number;
  width?: number;
  height?: number;
  viewportY?: number;
  baseY?: number;
  previousViewportY?: number;
  previousBaseY?: number;
  previousHeight?: number;
  cursorX?: number;
  cursorY?: number;
  targetViewportY?: number;
  bufferType?: string;
  renderStart?: number;
  renderEnd?: number;
  visible?: boolean;
  proposedCols?: number;
  proposedRows?: number;
  skipped?: boolean;
  reason?: string;
  replay?: string;
  generation?: number;
  driftMs?: number;
  durationMs?: number;
  sinceReplayStartMs?: number;
  proposeDurationMs?: number;
  resizeDurationMs?: number;
  delayMs?: number;
  timeoutMs?: number;
  backgroundedMs?: number;
  attempt?: number;
  flushed?: number;
  pendingCallbacks?: number;
  established?: boolean;
  hasLastSeen?: boolean;
  deferred?: boolean;
  settling?: boolean;
  isComposing?: boolean;
  inputType?: string;
  maxBytes?: number;
  sampledEvents?: number;
  sampledDataLength?: number;
  sampledByteLength?: number;
  sampleWindowMs?: number;
  warning?: boolean;
  warningMetric?: string;
  warningThresholdMs?: number;
  ptyResizeSent?: boolean;
  ptyResizeSuppressedReason?: string;
  requestedWebgl?: boolean;
  effectiveRenderer?: string;
  webglStatus?: string;
  webglFailureReason?: string;
  contextLossCount?: number;
  fontLoadingDoneCount?: number;
  atlasRebuildCount?: number;
  iosFontPrefetchStatus?: string;
  unicodeVersion?: string;
  isTouch?: boolean;
  isIos?: boolean;
};

export type TerminalTracePublicApi = {
  dump: () => TerminalTraceEvent[];
  dumpBottomRows: (
    input?: number | TerminalBottomRowsDumpOptions,
  ) => unknown | null;
  captureTerminalInput: (
    reason?: string,
    target?: TerminalDiagnosticTarget,
  ) => Promise<unknown>;
  clear: () => void;
  summary: () => Record<string, unknown>;
  kpi: () => TerminalKpiReport;
  enabled: () => boolean;
  enable: () => void;
  disable: () => void;
  flush: () => void;
};

export type TerminalDiagnosticTarget = {
  sessionId?: string | null;
  paneId?: string | null;
};

export type TerminalBottomRowsDumpOptions = TerminalDiagnosticTarget & {
  rowCount?: number;
};

type TerminalDiagnosticSourceStatus = "selected" | "missing";

type TerminalDiagnosticSourcePayload = {
  status: TerminalDiagnosticSourceStatus;
  requested?: TerminalDiagnosticTarget;
  selected?: TerminalDiagnosticTarget;
};

type TerminalBottomRowsSnapshotProvider = (rowCount?: number) => unknown | null;

type TerminalBottomRowsSnapshotProviderEntry = {
  source: TerminalDiagnosticTarget;
  provider: TerminalBottomRowsSnapshotProvider;
};

declare global {
  interface Window {
    parasorTerminalTrace?: TerminalTracePublicApi;
  }
}

const events = new Array<TerminalTraceEvent>(TRACE_LIMIT);
let eventStart = 0;
let eventCount = 0;
let seq = 0;
let installed = false;
let enabledCache: boolean | null = null;

interface OutputSampleState {
  firstAt: number;
  count: number;
  dataLength: number;
  byteLength: number;
}

const outputSampleStates = new Map<string, OutputSampleState>();
const bottomRowsSnapshotProviders: TerminalBottomRowsSnapshotProviderEntry[] =
  [];
const terminalInputAutoCaptureKeys = new Set<string>();
let terminalInputAutoCaptureCount = 0;
const clientStartupAutoCaptureKeys = new Set<string>();
let clientStartupAutoCaptureCount = 0;

function now(): number {
  return performance.now();
}

function queryEnablesTrace(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("terminalTrace");
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

function readInitialEnabled(): boolean {
  try {
    if (queryEnablesTrace()) {
      window.localStorage.setItem(TRACE_STORAGE_KEY, "1");
      return true;
    }
    return window.localStorage.getItem(TRACE_STORAGE_KEY) === "1";
  } catch {
    return queryEnablesTrace();
  }
}

function setTerminalTraceEnabled(enabled: boolean): void {
  enabledCache = enabled;
  try {
    if (enabled) {
      window.localStorage.setItem(TRACE_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(TRACE_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in private/opaque contexts. The in-memory
    // flag still lets the current tab trace.
  }
}

export function enableTerminalTrace(): void {
  installPublicApi();
  setTerminalTraceEnabled(true);
}

export function disableTerminalTrace(): void {
  setTerminalTraceEnabled(false);
}

export function isTerminalTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  installPublicApi();
  if (enabledCache === null) {
    enabledCache = readInitialEnabled();
  }
  return enabledCache;
}

function summarize(): Record<string, unknown> {
  const byType: Record<string, number> = {};
  let maxMainThreadDriftMs = 0;
  let maxWriteCallbackMs = 0;
  const pendingWrites = new Map<number, TerminalTraceEvent>();
  const snapshot = dumpEvents();

  for (const event of snapshot) {
    byType[event.type] = (byType[event.type] ?? 0) + 1;
    if (
      event.type === "main-thread-drift" &&
      typeof event.driftMs === "number"
    ) {
      maxMainThreadDriftMs = Math.max(maxMainThreadDriftMs, event.driftMs);
    }
    if (event.type === "xterm-write-start") {
      pendingWrites.set(event.seq, event);
    } else if (event.type === "xterm-write-callback") {
      const start = [...pendingWrites.values()]
        .filter((candidate) => candidate.sessionId === event.sessionId)
        .at(-1);
      if (start)
        maxWriteCallbackMs = Math.max(maxWriteCallbackMs, event.t - start.t);
    }
  }

  return {
    enabled: isTerminalTraceEnabled(),
    eventCount,
    firstEventAt: snapshot[0]?.t ?? null,
    lastEventAt: snapshot.at(-1)?.t ?? null,
    maxMainThreadDriftMs,
    maxWriteCallbackMs,
    byType,
  };
}

function outputSampleKey(event: Omit<TerminalTraceEvent, "seq">): string {
  return `${event.type}:${event.sessionId ?? ""}:${event.clientId ?? ""}`;
}

function sampleOutputEvent(
  event: Omit<TerminalTraceEvent, "seq">,
): Omit<TerminalTraceEvent, "seq"> | null {
  if (!CLIENT_OUTPUT_SAMPLE_TYPES.has(event.type)) return event;
  const key = outputSampleKey(event);
  const state = outputSampleStates.get(key);
  const dataLength = event.dataLength ?? 0;
  const byteLength = event.byteLength ?? 0;

  if (!state) {
    outputSampleStates.set(key, {
      firstAt: event.t,
      count: 1,
      dataLength,
      byteLength,
    });
    return {
      ...event,
      sampledEvents: 1,
      sampledDataLength: dataLength,
      sampledByteLength: byteLength,
      sampleWindowMs: 0,
    };
  }

  state.count += 1;
  state.dataLength += dataLength;
  state.byteLength += byteLength;
  const sampleWindowMs = event.t - state.firstAt;
  if (
    state.count < CLIENT_OUTPUT_SAMPLE_COUNT &&
    sampleWindowMs < CLIENT_OUTPUT_SAMPLE_INTERVAL_MS
  ) {
    return null;
  }

  const sampled = {
    ...event,
    dataLength: state.dataLength,
    byteLength: state.byteLength,
    sampledEvents: state.count,
    sampledDataLength: state.dataLength,
    sampledByteLength: state.byteLength,
    sampleWindowMs,
  };
  outputSampleStates.delete(key);
  return sampled;
}

function pushEvent(event: TerminalTraceEvent): void {
  if (eventCount < TRACE_LIMIT) {
    events[(eventStart + eventCount) % TRACE_LIMIT] = event;
    eventCount += 1;
    return;
  }
  events[eventStart] = event;
  eventStart = (eventStart + 1) % TRACE_LIMIT;
}

function dumpEvents(): TerminalTraceEvent[] {
  const out: TerminalTraceEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    out.push(events[(eventStart + i) % TRACE_LIMIT]);
  }
  return out;
}

function installPublicApi(): void {
  if (typeof window === "undefined") return;
  if (installed) return;
  installed = true;
  window.parasorTerminalTrace = {
    dump: dumpEvents,
    dumpBottomRows: dumpBottomRowsPublic,
    captureTerminalInput: captureTerminalInputDiagnostics,
    clear: () => {
      eventStart = 0;
      eventCount = 0;
      seq = 0;
      outputSampleStates.clear();
      terminalInputAutoCaptureKeys.clear();
      terminalInputAutoCaptureCount = 0;
      clientStartupAutoCaptureKeys.clear();
      clientStartupAutoCaptureCount = 0;
    },
    summary: summarize,
    kpi: () => computeTerminalKpis(dumpEvents()),
    enabled: isTerminalTraceEnabled,
    enable: enableTerminalTrace,
    disable: disableTerminalTrace,
    flush: () => {},
  };
}

function cleanDiagnosticTarget(
  target: TerminalDiagnosticTarget | undefined,
): TerminalDiagnosticTarget | undefined {
  if (!target) return undefined;
  const sessionId =
    typeof target.sessionId === "string" && target.sessionId.length > 0
      ? target.sessionId
      : undefined;
  const paneId =
    typeof target.paneId === "string" && target.paneId.length > 0
      ? target.paneId
      : undefined;
  if (!sessionId && !paneId) return undefined;
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(paneId ? { paneId } : {}),
  };
}

function diagnosticTargetMatches(
  source: TerminalDiagnosticTarget,
  target: TerminalDiagnosticTarget,
): boolean {
  if (target.sessionId && source.sessionId !== target.sessionId) return false;
  if (target.paneId && source.paneId !== target.paneId) return false;
  return true;
}

function selectBottomRowsProvider(target?: TerminalDiagnosticTarget): {
  entry: TerminalBottomRowsSnapshotProviderEntry | null;
  source: TerminalDiagnosticSourcePayload;
} {
  const requested = cleanDiagnosticTarget(target);
  if (requested) {
    const entry =
      [...bottomRowsSnapshotProviders]
        .reverse()
        .find((candidate) =>
          diagnosticTargetMatches(candidate.source, requested),
        ) ?? null;
    return {
      entry,
      source: {
        status: entry ? "selected" : "missing",
        requested,
        ...(entry ? { selected: entry.source } : {}),
      },
    };
  }

  const entry = bottomRowsSnapshotProviders.at(-1) ?? null;
  return {
    entry,
    source: {
      status: entry ? "selected" : "missing",
      ...(entry ? { selected: entry.source } : {}),
    },
  };
}

function parseBottomRowsDumpInput(
  input?: number | TerminalBottomRowsDumpOptions,
): { rowCount?: number; target?: TerminalDiagnosticTarget } {
  if (typeof input === "number") return { rowCount: input };
  if (typeof input === "object" && input !== null) {
    return {
      rowCount: typeof input.rowCount === "number" ? input.rowCount : undefined,
      target: cleanDiagnosticTarget(input),
    };
  }
  return {};
}

function dumpBottomRowsPublic(
  input?: number | TerminalBottomRowsDumpOptions,
): unknown | null {
  const { rowCount, target } = parseBottomRowsDumpInput(input);
  const { entry } = selectBottomRowsProvider(target);
  return entry?.provider(rowCount) ?? null;
}

function latestTraceId(
  events: TerminalTraceEvent[],
  field: "sessionId" | "clientId",
): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const value = events[i]?.[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

async function captureTerminalInputDiagnostics(
  reason = "manual",
  target?: TerminalDiagnosticTarget,
): Promise<unknown> {
  const payload = buildTerminalInputPayload(reason, [], target);
  const response = await postDiagnosticPayload(payload);
  return response.json().catch(() => ({ ok: response.ok }));
}

type ClientDiagnosticPayload = {
  diagnostic: string;
  reason: string;
  sessionId?: string;
  clientId?: string;
  source?: TerminalDiagnosticSourcePayload;
  events: TerminalTraceEvent[];
  bottomRows: unknown | null;
};

function buildTerminalInputPayload(
  reason: string,
  extraEvents: TerminalTraceEvent[] = [],
  target?: TerminalDiagnosticTarget,
): ClientDiagnosticPayload {
  installPublicApi();
  const events = [...dumpEvents(), ...extraEvents].slice(
    -TERMINAL_INPUT_RECENT_EVENT_LIMIT,
  );
  const latestSessionId = latestTraceId(events, "sessionId");
  const requestedTarget =
    cleanDiagnosticTarget(target) ??
    cleanDiagnosticTarget({
      sessionId: latestSessionId,
    });
  const { entry, source } = selectBottomRowsProvider(requestedTarget);
  const bottomRows = entry?.provider(TERMINAL_INPUT_BOTTOM_ROW_COUNT) ?? null;
  return {
    diagnostic: TERMINAL_INPUT_DIAGNOSTIC,
    reason,
    sessionId:
      requestedTarget?.sessionId ??
      source.selected?.sessionId ??
      latestSessionId,
    clientId: latestTraceId(events, "clientId"),
    source,
    events,
    bottomRows,
  };
}

function buildClientStartupPayload(
  reason: string,
  extraEvents: TerminalTraceEvent[] = [],
): ClientDiagnosticPayload {
  installPublicApi();
  const events = [...dumpEvents(), ...extraEvents].slice(
    -TERMINAL_INPUT_RECENT_EVENT_LIMIT,
  );
  return {
    diagnostic: CLIENT_STARTUP_DIAGNOSTIC,
    reason,
    sessionId: latestTraceId(events, "sessionId"),
    clientId: latestTraceId(events, "clientId"),
    events,
    bottomRows: null,
  };
}

function postDiagnosticPayload(
  payload: ClientDiagnosticPayload,
): Promise<Response> {
  return authFetch("/api/debug/terminal-trace/client-diagnostic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function terminalInputBottomRowsFingerprint(bottomRows: unknown): unknown {
  if (typeof bottomRows !== "object" || bottomRows === null) return null;
  const source = bottomRows as Record<string, unknown>;
  const rowsSampled = Array.isArray(source.rowsSampled)
    ? source.rowsSampled.slice(-4).map((row) => {
        if (typeof row !== "object" || row === null) return null;
        const rowSource = row as Record<string, unknown>;
        return {
          line: rowSource.line,
          viewportRow: rowSource.viewportRow,
          text: rowSource.text,
          attrRuns: rowSource.attrRuns,
        };
      })
    : [];
  return {
    cols: source.cols,
    rows: source.rows,
    cursorX: source.cursorX,
    cursorY: source.cursorY,
    viewportY: source.viewportY,
    baseY: source.baseY,
    renderer: source.renderer,
    rowsSampled,
  };
}

function terminalInputAutoCaptureKey(payload: ClientDiagnosticPayload): string {
  const latestEvent = payload.events.at(-1);
  return JSON.stringify({
    reason: payload.reason,
    sessionId: payload.sessionId,
    clientId: payload.clientId,
    eventType: latestEvent?.type,
    cols: latestEvent?.cols,
    rows: latestEvent?.rows,
    viewportY: latestEvent?.viewportY,
    baseY: latestEvent?.baseY,
    ptyResizeSent: latestEvent?.ptyResizeSent,
    ptyResizeSuppressedReason: latestEvent?.ptyResizeSuppressedReason,
    source: payload.source,
    bottomRows: terminalInputBottomRowsFingerprint(payload.bottomRows),
  });
}

function clientStartupAutoCaptureKey(payload: ClientDiagnosticPayload): string {
  const latestEvent = payload.events.at(-1);
  return JSON.stringify({
    reason: payload.reason,
    eventType: latestEvent?.type,
    durationMs: latestEvent?.durationMs,
    delayMs: latestEvent?.delayMs,
    timeoutMs: latestEvent?.timeoutMs,
    routeKind: latestEvent?.routeKind,
    status: latestEvent?.status,
  });
}

export function scheduleTerminalInputDiagnosticCapture(
  reason: string,
  event: Omit<TerminalTraceEvent, "seq" | "t">,
): void {
  if (typeof window === "undefined") return;
  if (terminalInputAutoCaptureCount >= TERMINAL_INPUT_AUTO_CAPTURE_LIMIT)
    return;
  const payload = buildTerminalInputPayload(reason, [
    {
      seq: seq + 1,
      t: now(),
      ...event,
    },
  ]);
  const key = terminalInputAutoCaptureKey(payload);
  if (terminalInputAutoCaptureKeys.has(key)) return;
  terminalInputAutoCaptureKeys.add(key);
  terminalInputAutoCaptureCount += 1;
  void postDiagnosticPayload(payload).catch(() => {
    // Diagnostics must never affect terminal behavior.
  });
}

export function scheduleClientStartupDiagnosticCapture(
  reason: string,
  event: Omit<TerminalTraceEvent, "seq" | "t">,
): void {
  if (typeof window === "undefined") return;
  if (clientStartupAutoCaptureCount >= CLIENT_STARTUP_AUTO_CAPTURE_LIMIT)
    return;
  const payload = buildClientStartupPayload(reason, [
    {
      seq: seq + 1,
      t: now(),
      ...event,
    },
  ]);
  const key = clientStartupAutoCaptureKey(payload);
  if (clientStartupAutoCaptureKeys.has(key)) return;
  clientStartupAutoCaptureKeys.add(key);
  clientStartupAutoCaptureCount += 1;
  void postDiagnosticPayload(payload).catch(() => {
    // Diagnostics must never affect terminal behavior.
  });
}

export function registerTerminalBottomRowsSnapshotProvider(
  provider: TerminalBottomRowsSnapshotProvider,
  source: TerminalDiagnosticTarget = {},
): () => void {
  installPublicApi();
  const entry: TerminalBottomRowsSnapshotProviderEntry = {
    provider,
    source: cleanDiagnosticTarget(source) ?? {},
  };
  const existingIndex = bottomRowsSnapshotProviders.findIndex(
    (candidate) => candidate.provider === provider,
  );
  if (existingIndex !== -1) {
    bottomRowsSnapshotProviders.splice(existingIndex, 1);
  }
  bottomRowsSnapshotProviders.push(entry);
  return () => {
    const index = bottomRowsSnapshotProviders.findIndex(
      (candidate) => candidate.provider === provider,
    );
    if (index !== -1) {
      bottomRowsSnapshotProviders.splice(index, 1);
    }
  };
}

function warningForEvent(
  event: Omit<TerminalTraceEvent, "seq">,
): Pick<
  TerminalTraceEvent,
  "warning" | "warningMetric" | "warningThresholdMs"
> | null {
  const checks: Array<[WarningMetric, number]> = [
    ["driftMs", WARNING_DRIFT_THRESHOLD_MS],
    ["sinceReplayStartMs", WARNING_REPLAY_THRESHOLD_MS],
    ["durationMs", WARNING_DURATION_THRESHOLD_MS],
    ["delayMs", WARNING_DELAY_THRESHOLD_MS],
  ];

  for (const [metric, threshold] of checks) {
    const value = event[metric];
    if (typeof value === "number" && value >= threshold) {
      return {
        warning: true,
        warningMetric: metric,
        warningThresholdMs: threshold,
      };
    }
  }

  if (event.type.endsWith("-timeout")) {
    return {
      warning: true,
      warningMetric: "timeoutMs",
      warningThresholdMs: event.timeoutMs ?? 0,
    };
  }

  return null;
}

export function traceTerminalEvent(
  type: string,
  fields: Omit<TerminalTraceEvent, "seq" | "t" | "type"> = {},
): void {
  const event = { t: now(), type, ...fields };
  const warning = warningForEvent(event);
  if (!isTerminalTraceEnabled() && !warning) return;
  const sampled = sampleOutputEvent({ ...event, ...warning });
  if (!sampled) return;
  pushEvent({ seq: ++seq, ...sampled });
}

export function traceTerminalEventLazy(
  type: string,
  fields: () => Omit<TerminalTraceEvent, "seq" | "t" | "type">,
): void {
  if (!isTerminalTraceEnabled()) return;
  const sampled = sampleOutputEvent({ t: now(), type, ...fields() });
  if (!sampled) return;
  pushEvent({ seq: ++seq, ...sampled });
}

export function startTerminalMainThreadTrace(sessionId: string): () => void {
  if (!isTerminalTraceEnabled()) return () => {};
  installPublicApi();
  let expected = now() + MAIN_THREAD_INTERVAL_MS;
  const timer = window.setInterval(() => {
    const actual = now();
    const driftMs = actual - expected;
    expected = actual + MAIN_THREAD_INTERVAL_MS;
    if (driftMs >= MAIN_THREAD_DRIFT_THRESHOLD_MS) {
      traceTerminalEvent("main-thread-drift", { sessionId, driftMs });
    }
  }, MAIN_THREAD_INTERVAL_MS);
  return () => clearInterval(timer);
}

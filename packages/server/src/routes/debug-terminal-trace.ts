import { randomUUID } from "node:crypto";
import { decodeBinaryFrame } from "@parasor/shared";
import { Hono } from "hono";
import type { WSMessageReceive } from "hono/ws";
import { createSessionCommands } from "../application/workspace/session-commands.js";
import type { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";
import type { PtyHost } from "../pty/host.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { EventBus } from "../ws/events.js";
import {
  cleanupTerminalRelay,
  handleTerminalMessage,
  setupTerminalRelay,
} from "../ws/terminal.js";

interface DebugTerminalTraceRouteDeps {
  recorder: TerminalTraceRecorder;
  ptyManager: PtyHost;
  eventBus: EventBus;
  appStateStore: AppStateStore;
  projectManager: ProjectManager;
}

type ProbeResult = {
  ok: boolean;
  projectId: string;
  sessionId: string | null;
  mode: "server-terminal-relay";
  timings: {
    createMs: number;
    relaySetupMs: number;
    initMs: number;
    firstOutputMs: number | null;
    inputToMarkerMs: number | null;
    cleanupMs: number | null;
    totalMs: number;
  };
  bytes: {
    output: number;
  };
  timedOut: boolean;
  error?: string;
};

const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const MAX_CLIENT_TRACE_EVENTS = 200;
const MAX_CLIENT_DIAGNOSTIC_EVENTS = 80;
const MAX_CLIENT_DIAGNOSTIC_ROWS = 20;
const MAX_CLIENT_DIAGNOSTIC_ATTR_RUNS = 20;
const MAX_RECENT_CLIENT_TRACE_KEYS = 1000;
const CLIENT_TRACE_PAYLOAD_KEYS = [
  "seq",
  "t",
  "type",
  "sessionId",
  "clientId",
  "dataLength",
  "byteLength",
  "queueLength",
  "readyState",
  "status",
  "httpStatus",
  "traceId",
  "phase",
  "source",
  "routeKind",
  "surface",
  "paneId",
  "cols",
  "rows",
  "width",
  "height",
  "visible",
  "viewportY",
  "baseY",
  "previousViewportY",
  "previousBaseY",
  "previousHeight",
  "cursorX",
  "cursorY",
  "targetViewportY",
  "bufferType",
  "renderStart",
  "renderEnd",
  "proposedCols",
  "proposedRows",
  "skipped",
  "reason",
  "replay",
  "generation",
  "driftMs",
  "durationMs",
  "wallMs",
  "visibilityState",
  "hidden",
  "online",
  "visibilityChanges",
  "pageHideCount",
  "pageShowCount",
  "focusCount",
  "onlineCount",
  "offlineCount",
  "errorName",
  "errorMessage",
  "startedAtWallMs",
  "endedAtWallMs",
  "sinceReplayStartMs",
  "proposeDurationMs",
  "resizeDurationMs",
  "delayMs",
  "timeoutMs",
  "backgroundedMs",
  "attempt",
  "flushed",
  "pendingCallbacks",
  "established",
  "hasLastSeen",
  "deferred",
  "settling",
  "isComposing",
  "inputType",
  "maxBytes",
  "sampledEvents",
  "sampledDataLength",
  "sampledByteLength",
  "sampleWindowMs",
  "requestedWebgl",
  "effectiveRenderer",
  "webglStatus",
  "webglFailureReason",
  "contextLossCount",
  "fontLoadingDoneCount",
  "atlasRebuildCount",
  "iosFontPrefetchStatus",
  "unicodeVersion",
  "isTouch",
  "isIos",
] as const;

class ProbeTerminalWs {
  readyState = 1;
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  constructor(
    private readonly onSend: (
      data: string | ArrayBuffer | Uint8Array<ArrayBuffer>,
    ) => void,
  ) {}

  send(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>): void {
    this.onSend(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }
}

function monotonicMs(): number {
  return performance.now();
}

function durationSince(start: number): number {
  return Math.round((monotonicMs() - start) * 10) / 10;
}

function parseTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PROBE_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.round(value), 500), 30_000);
}

function sanitizeClientTraceEvent(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of CLIENT_TRACE_PAYLOAD_KEYS) {
    const entry = source[key];
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null
    ) {
      out[key] = entry;
    }
  }
  return out;
}

function clientTraceIds(event: Record<string, unknown>): {
  sessionId?: string;
  clientId?: string;
} {
  const sessionId =
    typeof event.sessionId === "string" ? event.sessionId : undefined;
  const clientId =
    typeof event.clientId === "string" ? event.clientId : undefined;
  return { sessionId, clientId };
}

function clientTraceDedupKey(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

function stringField(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.slice(0, 200);
}

function optionalStringField(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 200) : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function definedRecord(
  entries: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  );
}

function sanitizeAttrRun(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  const attrs =
    typeof source.attrs === "object" && source.attrs !== null
      ? (source.attrs as Record<string, unknown>)
      : {};
  return definedRecord({
    start: numberField(source.start),
    end: numberField(source.end),
    attrs: definedRecord({
      fgMode: numberField(attrs.fgMode),
      fg: numberField(attrs.fg),
      bgMode: numberField(attrs.bgMode),
      bg: numberField(attrs.bg),
      bold: booleanField(attrs.bold),
      italic: booleanField(attrs.italic),
      dim: booleanField(attrs.dim),
      underline: booleanField(attrs.underline),
      inverse: booleanField(attrs.inverse),
    }),
  });
}

function sanitizeRendererTrace(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  return definedRecord({
    requestedWebgl: booleanField(source.requestedWebgl),
    effectiveRenderer: optionalStringField(source.effectiveRenderer),
    webglStatus: optionalStringField(source.webglStatus),
    webglFailureReason: optionalStringField(source.webglFailureReason),
    contextLossCount: numberField(source.contextLossCount),
    fontLoadingDoneCount: numberField(source.fontLoadingDoneCount),
    atlasRebuildCount: numberField(source.atlasRebuildCount),
    iosFontPrefetchStatus: optionalStringField(source.iosFontPrefetchStatus),
    unicodeVersion: optionalStringField(source.unicodeVersion),
    isTouch: booleanField(source.isTouch),
    isIos: booleanField(source.isIos),
    fontFamily: optionalStringField(source.fontFamily),
    fontSize: numberField(source.fontSize),
  });
}

function sanitizeBottomRows(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  const rows = Array.isArray(source.rowsSampled)
    ? source.rowsSampled.slice(0, MAX_CLIENT_DIAGNOSTIC_ROWS)
    : [];
  return definedRecord({
    cols: numberField(source.cols),
    rows: numberField(source.rows),
    cursorX: numberField(source.cursorX),
    cursorY: numberField(source.cursorY),
    viewportY: numberField(source.viewportY),
    baseY: numberField(source.baseY),
    bufferType: stringField(source.bufferType),
    rowCount: numberField(source.rowCount),
    renderer: sanitizeRendererTrace(source.renderer),
    rowsSampled: rows.map((row) => {
      const rowSource =
        typeof row === "object" && row !== null
          ? (row as Record<string, unknown>)
          : {};
      const attrRuns = Array.isArray(rowSource.attrRuns)
        ? rowSource.attrRuns
            .slice(0, MAX_CLIENT_DIAGNOSTIC_ATTR_RUNS)
            .map(sanitizeAttrRun)
            .filter((run): run is Record<string, unknown> => run !== null)
        : [];
      return definedRecord({
        line: numberField(rowSource.line),
        viewportRow: numberField(rowSource.viewportRow),
        isWrapped: booleanField(rowSource.isWrapped),
        text: stringField(rowSource.text),
        attrRuns,
      });
    }),
  });
}

function sanitizeDiagnosticSourceIdentity(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const out = definedRecord({
    sessionId: optionalStringField(source.sessionId),
    paneId: optionalStringField(source.paneId),
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeDiagnosticSource(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const status =
    source.status === "selected" || source.status === "missing"
      ? source.status
      : undefined;
  const out = definedRecord({
    status,
    requested: sanitizeDiagnosticSourceIdentity(source.requested),
    selected: sanitizeDiagnosticSourceIdentity(source.selected),
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

function terminalMessage(
  data: string | Uint8Array,
): MessageEvent<WSMessageReceive> {
  return { data } as unknown as MessageEvent<WSMessageReceive>;
}

async function runProbe({
  projectId,
  timeoutMs,
  recorder,
  ptyManager,
  eventBus,
  appStateStore,
}: {
  projectId: string;
  timeoutMs: number;
  recorder: TerminalTraceRecorder;
  ptyManager: PtyHost;
  eventBus: EventBus;
  appStateStore: AppStateStore;
}): Promise<ProbeResult> {
  const totalStart = monotonicMs();
  const marker = `__parasor_latency_probe_${randomUUID().replaceAll("-", "")}`;
  const clientId = `probe-${randomUUID()}`;
  let sessionId: string | null = null;
  let outputBytes = 0;
  let firstOutputAt: number | null = null;
  let markerAt: number | null = null;
  let inputAt: number | null = null;
  let relaySetupMs = 0;
  let initMs = 0;
  let cleanupMs: number | null = null;
  let timedOut = false;
  let probeError: string | undefined;
  const decoder = new TextDecoder();
  let wsForCleanup: ProbeTerminalWs | null = null;

  const sessionCommands = createSessionCommands({
    appStateStore,
    eventBus,
    ptyManager,
  });

  recorder.record(
    "probe-start",
    { timeoutMs, mode: "server-terminal-relay" },
    { clientId },
  );

  const createStart = monotonicMs();
  const session = await sessionCommands.createSession({
    projectId,
    title: "terminal latency probe",
    command: { type: "shell" },
  });
  sessionId = session.id;
  const createMs = durationSince(createStart);

  const markerSeen = new Promise<void>((resolve) => {
    const receiveText = (text: string) => {
      if (text.length === 0) return;
      outputBytes += Buffer.byteLength(text, "utf8");
      firstOutputAt ??= monotonicMs();
      if (markerAt === null && text.includes(marker)) {
        markerAt = monotonicMs();
        resolve();
      }
    };

    const ws = new ProbeTerminalWs((data) => {
      if (typeof data === "string") {
        try {
          const msg = JSON.parse(data) as { type?: string; data?: unknown };
          if (msg.type === "replay" && typeof msg.data === "string") {
            receiveText(msg.data);
          }
        } catch {
          receiveText(data);
        }
        return;
      }

      const buf =
        data instanceof Uint8Array
          ? data
          : new Uint8Array(data as ArrayBufferLike);
      const decoded = decodeBinaryFrame(buf);
      if (decoded.ok && decoded.frame.kind === "output") {
        receiveText(decoder.decode(decoded.frame.data, { stream: true }));
      }
    });
    wsForCleanup = ws;

    void (async () => {
      const relaySetupStart = monotonicMs();
      setupTerminalRelay(ws, session.id, clientId, ptyManager, recorder);
      relaySetupMs = durationSince(relaySetupStart);

      const initStart = monotonicMs();
      await handleTerminalMessage(
        ws,
        session.id,
        clientId,
        ptyManager,
        terminalMessage(
          JSON.stringify({
            type: "init",
            cols: 100,
            rows: 30,
            capabilities: { binary: true, chunkedReplay: true },
          }),
        ),
        recorder,
      );
      initMs = durationSince(initStart);
      if (ws.readyState !== 1) {
        throw new Error(ws.closeCalls.at(-1)?.reason ?? "probe WS closed");
      }

      inputAt = monotonicMs();
      await handleTerminalMessage(
        ws,
        session.id,
        clientId,
        ptyManager,
        terminalMessage(
          JSON.stringify({
            type: "input",
            data: `printf '${marker}\\n'\r`,
            generation: ptyManager.get(session.id)?.generation ?? 0,
          }),
        ),
        recorder,
      );
    })().catch((error) => {
      probeError = error instanceof Error ? error.message : "probe failed";
      resolve();
    });
  });

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });

  await Promise.race([markerSeen, timeout]);
  if (timeoutId !== null) clearTimeout(timeoutId);

  const cleanupStart = monotonicMs();
  try {
    if (wsForCleanup !== null) {
      cleanupTerminalRelay(
        wsForCleanup,
        session.id,
        clientId,
        ptyManager,
        recorder,
      );
    }
    await sessionCommands.deleteSession(session.id);
  } finally {
    cleanupMs = durationSince(cleanupStart);
  }

  const result: ProbeResult = {
    ok: markerAt !== null && !timedOut,
    projectId,
    sessionId,
    mode: "server-terminal-relay",
    timings: {
      createMs,
      relaySetupMs,
      initMs,
      firstOutputMs:
        firstOutputAt === null
          ? null
          : Math.round((firstOutputAt - totalStart) * 10) / 10,
      inputToMarkerMs:
        markerAt === null || inputAt === null
          ? null
          : Math.round((markerAt - inputAt) * 10) / 10,
      cleanupMs,
      totalMs: durationSince(totalStart),
    },
    bytes: { output: outputBytes },
    timedOut,
    ...(probeError !== undefined && { error: probeError }),
  };
  recorder.record(
    "probe-finish",
    {
      ok: result.ok,
      timedOut,
      timings: result.timings,
      outputBytes,
    },
    { sessionId, clientId },
  );
  return result;
}

export function createDebugTerminalTraceRoute({
  recorder,
  ptyManager,
  eventBus,
  appStateStore,
  projectManager,
}: DebugTerminalTraceRouteDeps): Hono {
  const routes = new Hono();
  const recentClientTraceKeys: string[] = [];
  const recentClientTraceKeySet = new Set<string>();

  const rememberClientTraceKey = (key: string): boolean => {
    if (recentClientTraceKeySet.has(key)) return false;
    recentClientTraceKeySet.add(key);
    recentClientTraceKeys.push(key);
    while (recentClientTraceKeys.length > MAX_RECENT_CLIENT_TRACE_KEYS) {
      const evicted = recentClientTraceKeys.shift();
      if (evicted !== undefined) recentClientTraceKeySet.delete(evicted);
    }
    return true;
  };
  const clearClientTraceKeys = (): void => {
    recentClientTraceKeys.length = 0;
    recentClientTraceKeySet.clear();
  };

  routes.get("/", (c) => {
    const sinceRaw = c.req.query("since");
    const since = sinceRaw === undefined ? null : Number(sinceRaw);
    const events =
      since !== null && Number.isFinite(since)
        ? recorder.listSince(since)
        : recorder.list();
    return c.json({
      ...recorder.summary(),
      events,
    });
  });

  routes.post("/", async (c) => {
    const body = await c.req
      .json<{ enabled?: unknown; clear?: unknown }>()
      .catch(() => ({}) as { enabled?: unknown; clear?: unknown });
    if (typeof body.enabled === "boolean") {
      recorder.setEnabled(body.enabled);
    }
    if (body.clear === true) {
      recorder.clear();
      clearClientTraceKeys();
    }
    return c.json(recorder.summary());
  });

  routes.post("/client", async (c) => {
    const body = await c.req
      .json<{ events?: unknown }>()
      .catch(() => ({}) as { events?: unknown });
    const rawEvents = Array.isArray(body.events) ? body.events : [];
    const events = rawEvents.slice(0, MAX_CLIENT_TRACE_EVENTS);
    let duplicates = 0;
    for (const rawEvent of events) {
      const event = sanitizeClientTraceEvent(rawEvent);
      if (!rememberClientTraceKey(clientTraceDedupKey(event))) {
        duplicates += 1;
        continue;
      }
      recorder.record("client-event", event, clientTraceIds(event));
    }
    return c.json({
      ok: true,
      accepted: events.length,
      dropped: Math.max(0, rawEvents.length - events.length),
      duplicates,
      ...recorder.summary(),
    });
  });

  routes.post("/client-diagnostic", async (c) => {
    const body = await c.req
      .json<{
        diagnostic?: unknown;
        reason?: unknown;
        sessionId?: unknown;
        clientId?: unknown;
        source?: unknown;
        events?: unknown;
        bottomRows?: unknown;
      }>()
      .catch(
        () =>
          ({}) as {
            diagnostic?: unknown;
            reason?: unknown;
            sessionId?: unknown;
            clientId?: unknown;
            source?: unknown;
            events?: unknown;
            bottomRows?: unknown;
          },
      );
    const rawEvents = Array.isArray(body.events) ? body.events : [];
    const events = rawEvents
      .slice(0, MAX_CLIENT_DIAGNOSTIC_EVENTS)
      .map(sanitizeClientTraceEvent);
    const bottomRows = sanitizeBottomRows(body.bottomRows);
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId : undefined;
    const clientId =
      typeof body.clientId === "string" ? body.clientId : undefined;
    const payload = {
      diagnostic: stringField(body.diagnostic, "manual"),
      reason: stringField(body.reason, "manual"),
      eventCount: events.length,
      droppedEvents: Math.max(0, rawEvents.length - events.length),
      events,
      source: sanitizeDiagnosticSource(body.source),
      bottomRows,
    };
    const previousEnabled = recorder.isEnabled();
    recorder.setEnabled(true);
    try {
      recorder.record("client-diagnostic", payload, { sessionId, clientId });
    } finally {
      recorder.setEnabled(previousEnabled);
    }
    return c.json({
      ok: true,
      accepted: 1,
      diagnosticEventCount: events.length,
      droppedDiagnosticEvents: payload.droppedEvents,
      hasBottomRows: bottomRows !== null,
      ...recorder.summary(),
    });
  });

  routes.delete("/", (c) => {
    recorder.clear();
    clearClientTraceKeys();
    return c.json({ ok: true });
  });

  routes.post("/probe", async (c) => {
    const body = await c.req
      .json<{ projectId?: unknown; timeoutMs?: unknown }>()
      .catch(() => ({}) as { projectId?: unknown; timeoutMs?: unknown });
    const projectId =
      typeof body.projectId === "string" && body.projectId.length > 0
        ? body.projectId
        : projectManager.list()[0]?.id;
    if (!projectId) {
      return c.json({ error: "projectId is required" }, 400);
    }
    if (!projectManager.get(projectId)) {
      return c.json({ error: "Project not found" }, 404);
    }

    const previousEnabled = recorder.isEnabled();
    recorder.setEnabled(true);
    try {
      const result = await runProbe({
        projectId,
        timeoutMs: parseTimeoutMs(body.timeoutMs),
        recorder,
        ptyManager,
        eventBus,
        appStateStore,
      });
      return c.json(result, result.ok ? 200 : 504);
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "probe failed",
        },
        500,
      );
    } finally {
      recorder.setEnabled(previousEnabled);
    }
  });

  return routes;
}

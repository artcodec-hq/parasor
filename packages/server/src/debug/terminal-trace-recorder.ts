export type TerminalTraceEventType =
  | "session-create-request"
  | "session-create-complete"
  | "session-create-failed"
  | "session-delete-request"
  | "session-delete-complete"
  | "session-delete-failed"
  | "ws-setup"
  | "ws-cleanup"
  | "ws-cleanup-skip"
  | "ws-message"
  | "ws-init"
  | "ws-init-ack"
  | "ws-replay"
  | "ws-output"
  | "ws-close"
  | "pty-attach-start"
  | "pty-attach-complete"
  | "pty-attach-failed"
  | "pty-attach-abandoned"
  | "pty-write"
  | "pty-resize"
  | "pty-refresh"
  | "pty-flow"
  | "malformed-frame"
  | "client-event"
  | "client-diagnostic"
  | "probe-start"
  | "probe-finish";

export interface TerminalTraceEvent {
  seq: number;
  timestamp: number;
  type: TerminalTraceEventType;
  sessionId?: string;
  clientId?: string;
  payload: Record<string, unknown>;
}

interface TerminalTraceRecorderOptions {
  enabled?: boolean;
  maxEvents?: number;
  now?: () => number;
}

const DEFAULT_MAX_EVENTS = 2000;
const MAX_PAYLOAD_KEYS = 40;
const MAX_PAYLOAD_DEPTH = 7;

export class TerminalTraceRecorder {
  private readonly events: TerminalTraceEvent[];
  private readonly maxEvents: number;
  private readonly now: () => number;
  private seq = 0;
  private enabled: boolean;
  private start = 0;
  private count = 0;

  constructor(options?: TerminalTraceRecorderOptions) {
    this.enabled = options?.enabled ?? false;
    this.maxEvents = options?.maxEvents ?? DEFAULT_MAX_EVENTS;
    this.events = new Array<TerminalTraceEvent>(this.maxEvents);
    this.now = options?.now ?? (() => Date.now());
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  record(
    type: TerminalTraceEventType,
    payload: Record<string, unknown> = {},
    ids: { sessionId?: string; clientId?: string } = {},
  ): void {
    if (!this.enabled) return;
    this.push({
      seq: ++this.seq,
      timestamp: this.now(),
      type,
      ...ids,
      payload: sanitizePayloadObject(payload),
    });
  }

  recordLazy(
    type: TerminalTraceEventType,
    payload: () => Record<string, unknown>,
    ids: { sessionId?: string; clientId?: string } = {},
  ): void {
    if (!this.enabled) return;
    this.record(type, payload(), ids);
  }

  private push(event: TerminalTraceEvent): void {
    if (this.count < this.maxEvents) {
      this.events[(this.start + this.count) % this.maxEvents] = event;
      this.count += 1;
      return;
    }
    this.events[this.start] = event;
    this.start = (this.start + 1) % this.maxEvents;
  }

  list(): TerminalTraceEvent[] {
    const out: TerminalTraceEvent[] = [];
    for (let i = 0; i < this.count; i++) {
      out.push(this.events[(this.start + i) % this.maxEvents]);
    }
    return out;
  }

  listSince(since: number): TerminalTraceEvent[] {
    if (!Number.isFinite(since)) return this.list();
    return this.list().filter((event) => event.seq > since);
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }

  summary(): Record<string, unknown> {
    const byType: Record<string, number> = {};
    const events = this.list();
    for (const event of events) {
      byType[event.type] = (byType[event.type] ?? 0) + 1;
    }
    return {
      enabled: this.enabled,
      maxEvents: this.maxEvents,
      eventCount: this.count,
      firstSeq: events[0]?.seq ?? null,
      lastSeq: events.at(-1)?.seq ?? null,
      byType,
    };
  }
}

function sanitizePayloadObject(payload: Record<string, unknown>) {
  return sanitizePayloadValue(payload, 0, new WeakSet()) as Record<
    string,
    unknown
  >;
}

function sanitizePayloadValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return value.length <= 200 ? value : `${value.slice(0, 200)}...`;
  }
  if (depth >= MAX_PAYLOAD_DEPTH) return "[truncated-depth]";
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizePayloadValue(item, depth + 1, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(
      0,
      MAX_PAYLOAD_KEYS,
    )) {
      out[key] = sanitizePayloadValue(entry, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

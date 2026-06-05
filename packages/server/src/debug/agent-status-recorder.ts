import { promises as fsp, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentState } from "@parasor/shared";

export interface AgentStatusDebugEvent {
  seq: number;
  timestamp: number;
  type:
    | "manual-tracker"
    | "hook-debug"
    | "hook-received"
    | "hook-mapped"
    | "detector-state"
    | "detector-skip"
    | "detector-feed";
  sessionId?: string;
  payload: Record<string, unknown>;
}

interface AgentStatusRecorderOptions {
  maxEvents?: number;
  now?: () => number;
  /**
   * Optional append-only JSONL sink. When set, every recorded event is
   * also written to this path so a reproduction can be diagnosed after a
   * server restart. Rotated when {@link maxFileBytes} is exceeded; only
   * one prior rotation (`<path>.1`) is retained.
   */
  logPath?: string;
  maxFileBytes?: number;
  maxEventBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_EVENT_BYTES = 64 * 1024;
const MAX_PAYLOAD_STRING_CHARS = 4096;
const MAX_PAYLOAD_ARRAY_ITEMS = 20;
const MAX_PAYLOAD_OBJECT_KEYS = 50;
const MAX_PAYLOAD_DEPTH = 4;

export class AgentStatusRecorder {
  private readonly events: AgentStatusDebugEvent[] = [];
  private readonly maxEvents: number;
  private readonly now: () => number;
  private readonly logPath: string | undefined;
  private readonly maxFileBytes: number;
  private readonly maxEventBytes: number;
  private seq = 0;

  private writeQueue: string[] = [];
  private writing = false;
  private writtenBytes = 0;

  constructor(options?: AgentStatusRecorderOptions) {
    this.maxEvents = options?.maxEvents ?? 1000;
    this.now = options?.now ?? (() => Date.now());
    this.logPath = options?.logPath;
    this.maxFileBytes = options?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxEventBytes = options?.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;

    if (this.logPath) {
      try {
        mkdirSync(dirname(this.logPath), { recursive: true });
      } catch {
        // Disk errors must never break startup -- debug log is best-effort.
      }
    }
  }

  record(
    type: AgentStatusDebugEvent["type"],
    payload: Record<string, unknown>,
    sessionId?: string,
  ): void {
    const event = this.boundEvent({
      seq: ++this.seq,
      timestamp: this.now(),
      type,
      sessionId,
      payload: sanitizePayloadObject(payload),
    });
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    this.enqueueWrite(event);
  }

  recordState(state: AgentState): void {
    this.record(
      "detector-state",
      {
        lifecycle: state.lifecycle,
        source: state.source,
        confidence: state.confidence,
        detectedAt: state.detectedAt,
      },
      state.sessionId,
    );
  }

  list(): AgentStatusDebugEvent[] {
    return [...this.events];
  }

  /**
   * Return events with `seq > since`. Cheap linear scan because the buffer
   * is capped at {@link maxEvents}. Used by the debug HTTP endpoint so
   * clients can poll without reshipping the whole history.
   */
  listSince(since: number): AgentStatusDebugEvent[] {
    if (!Number.isFinite(since)) return this.list();
    return this.events.filter((event) => event.seq > since);
  }

  clear(): void {
    this.events.length = 0;
  }

  async clearPersistedLog(): Promise<void> {
    if (!this.logPath) return;
    this.writeQueue.length = 0;
    await this.flush();
    try {
      await fsp.rm(this.logPath, { force: true });
      await fsp.rm(`${this.logPath}.1`, { force: true });
      this.writtenBytes = 0;
    } catch {
      // Best-effort debug cleanup. The in-memory clear has already happened.
    }
  }

  /**
   * Flush queued JSONL writes. Returns a promise that resolves when the
   * current drain completes. Best-effort: disk failures swallow silently.
   */
  async flush(): Promise<void> {
    while (this.writing || this.writeQueue.length > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private enqueueWrite(event: AgentStatusDebugEvent): void {
    if (!this.logPath) return;
    const line = this.stringifyEvent(event);
    if (!line) return;
    this.writeQueue.push(`${line}\n`);
    if (!this.writing) void this.drain();
  }

  private async drain(): Promise<void> {
    if (!this.logPath) return;
    this.writing = true;
    try {
      while (this.writeQueue.length > 0) {
        const batch = this.writeQueue.splice(0, this.writeQueue.length);
        const data = batch.join("");
        try {
          await fsp.appendFile(this.logPath, data, "utf8");
          this.writtenBytes += Buffer.byteLength(data, "utf8");
          if (this.writtenBytes >= this.maxFileBytes) {
            await this.rotate();
          }
        } catch {
          // Disk-write failure must never throw into the recorder caller.
        }
      }
    } finally {
      this.writing = false;
    }
  }

  private async rotate(): Promise<void> {
    if (!this.logPath) return;
    const archived = `${this.logPath}.1`;
    try {
      await fsp.rm(archived, { force: true });
      await fsp.rename(this.logPath, archived);
    } catch {
      // If rotation fails, fall through -- next write will just keep
      // appending past the soft cap rather than silently dropping events.
    }
    this.writtenBytes = 0;
  }

  private boundEvent(event: AgentStatusDebugEvent): AgentStatusDebugEvent {
    const serialized = this.stringifyEvent(event);
    if (!serialized) {
      return {
        ...event,
        payload: {
          truncated: true,
          reason: "unserializable payload",
        },
      };
    }
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes <= this.maxEventBytes) return event;
    return {
      ...event,
      payload: {
        truncated: true,
        originalBytes: bytes,
        keys: Object.keys(event.payload).slice(0, 20),
      },
    };
  }

  private stringifyEvent(event: AgentStatusDebugEvent): string | null {
    try {
      return JSON.stringify(event);
    } catch {
      return null;
    }
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
  if (typeof value === "string") {
    if (value.length <= MAX_PAYLOAD_STRING_CHARS) return value;
    return `${value.slice(0, MAX_PAYLOAD_STRING_CHARS)}…`;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= MAX_PAYLOAD_DEPTH) return "[truncated-depth]";
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_PAYLOAD_ARRAY_ITEMS)
      .map((item) => sanitizePayloadValue(item, depth + 1, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(
      0,
      MAX_PAYLOAD_OBJECT_KEYS,
    )) {
      out[key] = sanitizePayloadValue(entry, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

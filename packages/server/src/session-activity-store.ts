import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AgentLifecycle,
  SessionActivityKind,
  SessionActivityRecord,
  SessionActivitySource,
} from "@parasor/shared";

const FILE_VERSION = 1;
const DEFAULT_MAX_RECORDS_PER_SESSION = 50;
const DEFAULT_MAX_RETAINED_SESSIONS = 20;
const DEFAULT_NOISE_WINDOW_MS = 2_000;

const KINDS: Set<SessionActivityKind> = new Set([
  "session-created",
  "session-restarted",
  "session-ended",
  "session-closed",
  "agent-transition",
]);

const SOURCES: Set<SessionActivitySource> = new Set([
  "hook",
  "notify",
  "output",
  "activity",
  "daemon",
]);

const LIFECYCLES: Set<AgentLifecycle> = new Set([
  "running",
  "waiting",
  "completed",
  "idle",
  "unknown",
]);

interface PersistedSessionActivityFile {
  version: typeof FILE_VERSION;
  sessions: Record<string, SessionActivityRecord[]>;
}

interface SessionActivityStoreOptions {
  dir: string;
  fileName?: string;
  maxRecordsPerSession?: number;
  maxRetainedSessions?: number;
  noiseWindowMs?: number;
  now?: () => number;
}

interface SessionActivityState {
  sessionId: string;
  records: SessionActivityRecord[];
}

export class SessionActivityStore {
  private readonly maxRecordsPerSession: number;
  private readonly maxRetainedSessions: number;
  private readonly noiseWindowMs: number;
  private readonly now: () => number;
  private readonly filePath: string;
  private readonly sessions = new Map<string, SessionActivityRecord[]>();

  constructor({
    dir,
    fileName = "session-activity.json",
    maxRecordsPerSession = DEFAULT_MAX_RECORDS_PER_SESSION,
    maxRetainedSessions = DEFAULT_MAX_RETAINED_SESSIONS,
    noiseWindowMs = DEFAULT_NOISE_WINDOW_MS,
    now = () => Date.now(),
  }: SessionActivityStoreOptions) {
    this.maxRecordsPerSession = Math.max(1, maxRecordsPerSession);
    this.maxRetainedSessions = Math.max(1, maxRetainedSessions);
    this.noiseWindowMs = Math.max(0, noiseWindowMs);
    this.now = now;
    this.filePath = join(dir, fileName);
    this.load();
  }

  append(record: SessionActivityRecord): boolean {
    if (!isValidRecord(record)) return false;

    const normalized: SessionActivityRecord = {
      ...record,
      timestamp: Number.isFinite(record.timestamp)
        ? record.timestamp
        : this.now(),
    };

    if (this.shouldDropNoise(normalized)) return false;

    const records = this.sessions.get(record.sessionId) ?? [];
    records.push(normalized);

    if (records.length > this.maxRecordsPerSession) {
      records.splice(0, records.length - this.maxRecordsPerSession);
    }
    this.sessions.set(record.sessionId, records);
    this.enforceSessionRetention();
    this.persist();
    return true;
  }

  getRecent(limit = 100): SessionActivityRecord[] {
    const all = this.getSessionEntries()
      .flatMap((state) => state.records)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (limit <= 0) return [];
    return all.length <= limit ? all : all.slice(-limit);
  }

  private enforceSessionRetention(): void {
    if (this.sessions.size <= this.maxRetainedSessions) return;

    const rankedSessions = Array.from(this.sessions.entries())
      .map(([sessionId, records]) => ({
        sessionId,
        latest: records.at(-1)?.timestamp ?? 0,
      }))
      .sort((lhs, rhs) => {
        if (lhs.latest === rhs.latest) {
          return lhs.sessionId.localeCompare(rhs.sessionId);
        }
        return lhs.latest - rhs.latest;
      });

    const keep = new Set(
      rankedSessions
        .slice(-this.maxRetainedSessions)
        .map((entry) => entry.sessionId),
    );
    for (const { sessionId } of rankedSessions) {
      if (keep.has(sessionId)) continue;
      this.sessions.delete(sessionId);
    }
  }

  private load(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      return;
    }

    if (!isPersistedSessionActivityFile(parsed)) return;

    const recovered = this.migrate(parsed);
    for (const [sessionId, records] of Object.entries(recovered)) {
      this.sessions.set(sessionId, records);
    }
    this.enforceSessionRetention();
  }

  private persist(): void {
    try {
      this.write();
    } catch (error) {
      console.warn(
        `[session-activity-store] failed to persist session activity: ${
          (error as Error).message
        }`,
      );
    }
  }

  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const payload = {
      version: FILE_VERSION,
      sessions: Object.fromEntries(this.getSessionState()),
    } as PersistedSessionActivityFile;
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(tmpPath, this.filePath);
  }

  private shouldDropNoise(record: SessionActivityRecord): boolean {
    const records = this.sessions.get(record.sessionId);
    if (!records || records.length === 0) return false;

    const latest = records.at(-1);
    if (!latest) return false;
    if (record.timestamp - latest.timestamp > this.noiseWindowMs) return false;
    if (record.kind !== latest.kind) return false;
    if (record.source !== latest.source) return false;

    if (record.kind === "agent-transition") {
      return (
        record.agentLifecycle === latest.agentLifecycle &&
        record.source === latest.source
      );
    }
    return true;
  }

  private getSessionState(): [string, SessionActivityRecord[]][] {
    return Array.from(this.sessions.entries());
  }

  private getSessionEntries(): SessionActivityState[] {
    return Array.from(this.sessions.entries(), ([sessionId, records]) => ({
      sessionId,
      records,
    }));
  }

  private migrate(input: PersistedSessionActivityFile): Record<
    string,
    SessionActivityRecord[]
  > {
    const sessions: Record<string, SessionActivityRecord[]> = {};
    for (const [sessionId, records] of Object.entries(input.sessions)) {
      if (!Array.isArray(records)) continue;

      const next: SessionActivityRecord[] = [];
      for (const record of records) {
        if (!isRecord(record)) continue;
        if (record.sessionId !== sessionId) continue;
        if (!isValidRecord(record)) continue;
        if (!Number.isFinite(record.timestamp)) continue;
        next.push(record as SessionActivityRecord);
      }
      if (next.length > 0) {
        sessions[sessionId] = next.slice(-this.maxRecordsPerSession);
      }
    }
    return sessions;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPersistedSessionActivityFile(
  value: unknown,
): value is PersistedSessionActivityFile {
  return (
    isRecord(value) &&
    value.version === FILE_VERSION &&
    isRecord(value.sessions)
  );
}

function isValidRecord(value: unknown): value is SessionActivityRecord {
  if (!isRecord(value)) return false;
  if (typeof value.sessionId !== "string" || !value.sessionId) return false;
  if (typeof value.id !== "string" || !value.id) return false;
  if (typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp)) {
    return false;
  }
  if (value.timestamp < 0) return false;
  if (typeof value.kind !== "string" || !KINDS.has(value.kind as SessionActivityKind)) {
    return false;
  }
  if (typeof value.source !== "string" || !SOURCES.has(value.source as SessionActivitySource)) {
    return false;
  }
  if (typeof value.summary !== "string") return false;
  if (
    value.projectId !== undefined &&
    (typeof value.projectId !== "string" || !value.projectId)
  ) {
    return false;
  }
  if (
    value.agentLifecycle !== undefined &&
    !LIFECYCLES.has(value.agentLifecycle as AgentLifecycle)
  ) {
    return false;
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) return false;

  return true;
}

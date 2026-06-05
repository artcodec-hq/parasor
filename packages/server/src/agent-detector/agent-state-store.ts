import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AgentLifecycle,
  AgentSignalConfidence,
  AgentSignalSource,
  AgentState,
} from "@parasor/shared";

const FILE_VERSION = 1;

const LIFECYCLES = new Set<AgentLifecycle>([
  "running",
  "waiting",
  "completed",
  "idle",
  "unknown",
]);
const SOURCES = new Set<AgentSignalSource>([
  "hook",
  "notify",
  "output",
  "activity",
]);
const CONFIDENCES = new Set<AgentSignalConfidence>(["high", "medium", "low"]);

interface PersistedAgentStateFile {
  version: typeof FILE_VERSION;
  states: Record<string, AgentState>;
}

interface AgentStateStoreOptions {
  dir: string;
  fileName?: string;
}

interface GetStatesOptions {
  liveSessionIds?: Iterable<string>;
}

export class AgentStateStore {
  private states = new Map<string, AgentState>();
  private readonly filePath: string;

  constructor({ dir, fileName = "agent-state.json" }: AgentStateStoreOptions) {
    this.filePath = join(dir, fileName);
    this.load();
  }

  getStates(options?: GetStatesOptions): Record<string, AgentState> {
    if (options?.liveSessionIds) {
      this.prune(options.liveSessionIds);
    }
    return Object.fromEntries(this.states.entries());
  }

  set(state: AgentState): void {
    this.states.set(state.sessionId, state);
    this.persist();
  }

  replace(states: Record<string, AgentState>): void {
    this.states = new Map(Object.entries(states));
    this.persist();
  }

  remove(sessionId: string): void {
    if (!this.states.delete(sessionId)) return;
    this.persist();
  }

  prune(liveSessionIds: Iterable<string>): void {
    const live = new Set(liveSessionIds);
    let changed = false;
    for (const sessionId of this.states.keys()) {
      if (live.has(sessionId)) continue;
      this.states.delete(sessionId);
      changed = true;
    }
    if (changed) this.persist();
  }

  private load(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      return;
    }

    if (!isRecord(parsed) || parsed.version !== FILE_VERSION) return;
    if (!isRecord(parsed.states)) return;

    for (const [sessionId, state] of Object.entries(parsed.states)) {
      if (!isAgentState(state)) continue;
      if (state.sessionId !== sessionId) continue;
      this.states.set(sessionId, state);
    }
  }

  private persist(): void {
    try {
      this.write();
    } catch (error) {
      console.warn(
        `[agent-state-store] failed to persist agent state: ${
          (error as Error).message
        }`,
      );
    }
  }

  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const payload: PersistedAgentStateFile = {
      version: FILE_VERSION,
      states: Object.fromEntries(this.states.entries()),
    };
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(tmpPath, this.filePath);
  }
}

function isAgentState(value: unknown): value is AgentState {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === "string" &&
    LIFECYCLES.has(value.lifecycle as AgentLifecycle) &&
    SOURCES.has(value.source as AgentSignalSource) &&
    CONFIDENCES.has(value.confidence as AgentSignalConfidence) &&
    typeof value.detectedAt === "number" &&
    Number.isFinite(value.detectedAt)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

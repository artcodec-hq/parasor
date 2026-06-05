import type {
  AgentSignalConfidence,
  AgentSignalSource,
  AgentState,
} from "@parasor/shared";

const ATTENTION_PATTERNS = [
  /\(y\/n\)\s*$/i,
  /\[Y\/n\]\s*$/,
  /waiting for input/i,
  /Press Enter/i,
];
const COMPLETED_PATTERNS = [
  /(?:^|\n)\s*❯\s*$/u,
  /(?:^|\n)\s*>\s*$/u,
  /(?:^|\n)\s*\$\s*$/u,
];
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal OSC escapes are control-sequence delimiters we intentionally strip.
const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal CSI escapes are control-sequence delimiters we intentionally strip.
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: remaining ANSI ESC sequences are intentionally stripped.
const ESC_SEQUENCE = /\u001b[@-_]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: remaining C0/DEL control bytes are intentionally stripped from terminal text.
const OTHER_CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * Diagnostic trace events emitted by the detector for the debug recorder.
 * Captures the silent return paths inside {@link AgentDetector.feed} and
 * {@link AgentDetector.applyObservation} so a reproduction can show *why*
 * an expected state never landed (e.g. output regex matched `waiting` but
 * was blocked by a stronger hook source, or a hook landed but lost the
 * priority race).
 */
export type DetectorTraceEvent =
  | {
      kind: "feed-skip-source";
      sessionId: string;
      current: AgentSignalSource;
      currentLifecycle: AgentState["lifecycle"];
    }
  | {
      kind: "feed-control-only";
      sessionId: string;
    }
  | {
      kind: "feed-observed";
      sessionId: string;
      lifecycle: AgentState["lifecycle"];
      sampleTail: string;
    }
  | {
      kind: "applied-skip-source";
      sessionId: string;
      incoming: AgentSignalSource;
      incomingLifecycle: AgentState["lifecycle"];
      current: AgentSignalSource;
      currentLifecycle: AgentState["lifecycle"];
    };

type DetectorTraceCallback = (event: DetectorTraceEvent) => void;

interface DetectorOptions {
  idleTimeoutMs?: number;
  now?: () => number;
  onTrace?: DetectorTraceCallback;
}

interface FeedOptions {
  observeOutput?: boolean;
}

export interface AgentObservation {
  lifecycle: AgentState["lifecycle"];
  source: AgentSignalSource;
  confidence: AgentSignalConfidence;
}

type StateChangeCallback = (state: AgentState) => void;

// Last N chars of sanitized output to attach to feed-observed traces.
// Long enough to capture a prompt suffix or "Press Enter" line without
// blowing up the debug log.
const TRACE_SAMPLE_TAIL_CHARS = 120;

const SOURCE_PRIORITY: Record<AgentSignalSource, number> = {
  activity: 0,
  output: 1,
  notify: 2,
  hook: 3,
};

export class AgentDetector {
  private states = new Map<string, AgentState>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners: StateChangeCallback[] = [];
  private idleTimeoutMs: number;
  private now: () => number;
  private onTrace: DetectorTraceCallback | undefined;

  constructor(options?: DetectorOptions) {
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 30_000;
    this.now = options?.now ?? (() => Date.now());
    this.onTrace = options?.onTrace;
  }

  onStateChange(callback: StateChangeCallback): void {
    this.listeners.push(callback);
  }

  getStates(): Record<string, AgentState> {
    return Object.fromEntries(this.states.entries());
  }

  restoreStates(states: Record<string, AgentState>): void {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    this.states.clear();

    for (const state of Object.values(states)) {
      let restored = state;
      if (state.source === "output" && state.lifecycle !== "idle") {
        const now = this.now();
        if (state.detectedAt + this.idleTimeoutMs <= now) {
          restored = {
            ...state,
            lifecycle: "idle",
            confidence: "medium",
            detectedAt: now,
          };
        }
      }
      this.states.set(restored.sessionId, restored);
      if (restored.source === "output" && restored.lifecycle !== "idle") {
        this.scheduleOutputIdle(restored.sessionId, restored.detectedAt);
      }
    }
  }

  feed(sessionId: string, data: string, options?: FeedOptions): void {
    const current = this.states.get(sessionId);
    if (options?.observeOutput === false) {
      this.clearIdleTimer(sessionId);
      if (current?.source === "output" && current.lifecycle !== "idle") {
        this.applyObservation(sessionId, {
          lifecycle: "idle",
          source: "output",
          confidence: "medium",
        });
      }
      return;
    }
    if (current && this.isWeakerSource("output", current.source)) {
      this.onTrace?.({
        kind: "feed-skip-source",
        sessionId,
        current: current.source,
        currentLifecycle: current.lifecycle,
      });
      return;
    }

    const sanitized = sanitizeTerminalOutput(data);
    const lifecycle = detectOutputLifecycle(sanitized);
    const hasMeaningfulOutput = /[^\s]/u.test(sanitized);
    if (!lifecycle && !hasMeaningfulOutput) {
      if (process.env.PARASOR_AGENT_DEBUG === "1") {
        // eslint-disable-next-line no-console
        console.error(
          `[agent-detector] session=${sessionId.slice(0, 8)} ignore control-only chunk`,
        );
      }
      this.onTrace?.({ kind: "feed-control-only", sessionId });
      return;
    }

    this.clearIdleTimer(sessionId);

    const observed: AgentState["lifecycle"] = lifecycle ?? "running";
    this.applyObservation(sessionId, {
      lifecycle: observed,
      source: "output",
      confidence: "medium",
    });
    if (lifecycle) {
      this.onTrace?.({
        kind: "feed-observed",
        sessionId,
        lifecycle: observed,
        sampleTail: sanitized
          .slice(-TRACE_SAMPLE_TAIL_CHARS)
          .replace(/\s+/g, " ")
          .trim(),
      });
    }

    this.scheduleOutputIdle(sessionId, this.now());
  }

  removeSession(sessionId: string): void {
    this.states.delete(sessionId);
    this.clearIdleTimer(sessionId);
  }

  /**
   * Push a state change from outside the PTY-output fast path. Used by the
   * `parasor notify` CLI / IPC bridge so that hook-driven agents (Claude
   * Code, Codex, custom wrappers) can report state directly instead of
   * relying on output-pattern matching.
   *
   * Once a session has received any external state, it is marked as
   * hook/notify-managed and weaker PTY output observations become a no-op
   * for it until the session is cleared. No idle timer is set here; the
   * matching hook/notify transition is expected to push completed/idle
   * explicitly.
   */
  setExternalState(sessionId: string, state: AgentObservation): void {
    this.clearIdleTimer(sessionId);
    this.applyObservation(sessionId, state);
  }

  dispose(): void {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    this.states.clear();
  }

  private applyObservation(
    sessionId: string,
    observation: AgentObservation,
  ): void {
    const current = this.states.get(sessionId);
    if (current && this.isWeakerSource(observation.source, current.source)) {
      this.onTrace?.({
        kind: "applied-skip-source",
        sessionId,
        incoming: observation.source,
        incomingLifecycle: observation.lifecycle,
        current: current.source,
        currentLifecycle: current.lifecycle,
      });
      return;
    }

    const nextState: AgentState = {
      sessionId,
      ...observation,
      detectedAt: this.now(),
    };
    if (
      current &&
      current.lifecycle === nextState.lifecycle &&
      current.source === nextState.source &&
      current.confidence === nextState.confidence
    ) {
      return;
    }

    this.states.set(sessionId, nextState);
    for (const listener of this.listeners) {
      listener(nextState);
    }
  }

  private isWeakerSource(
    incoming: AgentSignalSource,
    current: AgentSignalSource,
  ): boolean {
    return SOURCE_PRIORITY[incoming] < SOURCE_PRIORITY[current];
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }

  private scheduleOutputIdle(sessionId: string, detectedAt: number): void {
    const delay = Math.max(0, detectedAt + this.idleTimeoutMs - this.now());
    this.idleTimers.set(
      sessionId,
      setTimeout(() => {
        this.applyObservation(sessionId, {
          lifecycle: "idle",
          source: "output",
          confidence: "medium",
        });
      }, delay),
    );
  }
}

export function sanitizeTerminalOutput(data: string): string {
  return data
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESC_SEQUENCE, "")
    .replace(OTHER_CONTROL_CHARS, "");
}

function detectOutputLifecycle(
  sanitized: string,
): AgentState["lifecycle"] | null {
  if (ATTENTION_PATTERNS.some((pattern) => pattern.test(sanitized))) {
    return "waiting";
  }
  if (COMPLETED_PATTERNS.some((pattern) => pattern.test(sanitized))) {
    return "completed";
  }
  return null;
}

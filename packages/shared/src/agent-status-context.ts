import type {
  AgentSignalConfidence,
  AgentSignalSource,
  AgentState,
} from "./runtime.js";
import type { Session } from "./state.js";

export type AgentLivenessState =
  | "active"
  | "waiting_for_user"
  | "recently_completed"
  | "idle"
  | "ended"
  | "unknown";

export interface AgentStatusContext {
  sessionId: string;
  state: AgentLivenessState;
  reason: string;
  source: AgentSignalSource | "session";
  confidence: AgentSignalConfidence;
  lastSignalAt?: number;
  stale: boolean;
}

export const OUTPUT_AGENT_STATUS_STALE_AFTER_MS = 30_000;

interface DeriveAgentStatusContextInput {
  session: Pick<Session, "id" | "state" | "endedAt">;
  agentState?: AgentState;
  now?: number;
}

export function deriveAgentStatusContext({
  session,
  agentState,
  now = Date.now(),
}: DeriveAgentStatusContextInput): AgentStatusContext {
  if (session.state === "ended") {
    return {
      sessionId: session.id,
      state: "ended",
      reason: "Terminal session ended",
      source: "session",
      confidence: "high",
      lastSignalAt: session.endedAt,
      stale: false,
    };
  }

  if (!agentState) {
    return {
      sessionId: session.id,
      state: "idle",
      reason: "No agent activity detected",
      source: "activity",
      confidence: "low",
      stale: false,
    };
  }

  const stale = isAgentStateStale(agentState, now);
  if (stale) {
    return {
      sessionId: session.id,
      state: "idle",
      reason: "Output-derived agent status expired",
      source: agentState.source,
      confidence: "low",
      lastSignalAt: agentState.detectedAt,
      stale: true,
    };
  }

  return {
    sessionId: session.id,
    state: livenessStateForAgentState(agentState),
    reason: reasonForAgentState(agentState),
    source: agentState.source,
    confidence: agentState.confidence,
    lastSignalAt: agentState.detectedAt,
    stale: false,
  };
}

export function isAgentStateStale(
  state: AgentState,
  now = Date.now(),
): boolean {
  return (
    state.source === "output" &&
    state.lifecycle !== "idle" &&
    now - state.detectedAt > OUTPUT_AGENT_STATUS_STALE_AFTER_MS
  );
}

function livenessStateForAgentState(state: AgentState): AgentLivenessState {
  switch (state.lifecycle) {
    case "running":
      return "active";
    case "waiting":
      return "waiting_for_user";
    case "completed":
      return "recently_completed";
    case "idle":
      return "idle";
    case "unknown":
      return "unknown";
  }
}

function reasonForAgentState(state: AgentState): string {
  if (state.lifecycle === "running") {
    return reasonForRunning(state.source);
  }
  if (state.lifecycle === "waiting") {
    return reasonForWaiting(state.source);
  }
  if (state.lifecycle === "completed") {
    return reasonForCompleted(state.source);
  }
  if (state.lifecycle === "idle") {
    return reasonForIdle(state.source);
  }
  return "Agent status is unknown";
}

function reasonForRunning(source: AgentSignalSource): string {
  switch (source) {
    case "hook":
      return "Agent hook reported active work";
    case "notify":
      return "Notify command reported active work";
    case "output":
      return "Terminal output indicates activity";
    case "activity":
      return "Terminal activity was observed";
  }
}

function reasonForWaiting(source: AgentSignalSource): string {
  switch (source) {
    case "hook":
      return "Agent hook reported waiting for user";
    case "notify":
      return "Notify command reported waiting for user";
    case "output":
      return "Terminal output looked like it was waiting for input";
    case "activity":
      return "Terminal activity suggests user attention may be needed";
  }
}

function reasonForCompleted(source: AgentSignalSource): string {
  switch (source) {
    case "hook":
      return "Agent hook reported the turn completed";
    case "notify":
      return "Notify command reported completion";
    case "output":
      return "Terminal output looked like the command returned to a prompt";
    case "activity":
      return "Terminal activity settled";
  }
}

function reasonForIdle(source: AgentSignalSource): string {
  switch (source) {
    case "hook":
      return "Agent hook reported idle";
    case "notify":
      return "Notify command reported idle";
    case "output":
      return "Output-derived status returned to idle";
    case "activity":
      return "No active agent work detected";
  }
}

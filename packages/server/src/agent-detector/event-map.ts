import {
  type AGENT_INTEGRATION_MANIFESTS,
  type AgentEventSpec,
  type AgentSignalConfidence,
  type AgentSignalSource,
  agentIntegrationByHookAgent,
} from "@parasor/shared";
import type { AgentObservation } from "./detector.js";

const MANUAL_NOTIFY_AGENT = "manual";
const MANUAL_NOTIFY_EVENTS: Record<string, AgentEventSpec> = {
  running: { lifecycle: "running", source: "notify" },
  waiting: { lifecycle: "waiting", source: "notify" },
  completed: { lifecycle: "completed", source: "notify" },
  idle: { lifecycle: "idle", source: "notify" },
};

export type AgentName =
  | Extract<(typeof AGENT_INTEGRATION_MANIFESTS)[number]["hookAgent"], string>
  | typeof MANUAL_NOTIFY_AGENT;

/**
 * Outcome of normalizing a hook event:
 *   - `{ kind: "state", state }` -- apply the observation to the session
 *   - `{ kind: "noop" }`          -- recognized but intentionally ignored
 *   - `{ kind: "unknown" }`       -- event name not in the dictionary
 */
export type EventMapResult =
  | { kind: "state"; state: AgentObservation }
  | { kind: "noop" }
  | { kind: "unknown" };

export function isKnownAgent(name: string): name is AgentName {
  return (
    name === MANUAL_NOTIFY_AGENT ||
    agentIntegrationByHookAgent(name) !== undefined
  );
}

export function mapEventType(agent: AgentName, event: string): EventMapResult {
  const events =
    agent === MANUAL_NOTIFY_AGENT
      ? MANUAL_NOTIFY_EVENTS
      : agentIntegrationByHookAgent(agent)?.events;
  if (!events) {
    return { kind: "unknown" };
  }

  const key = event.trim().toLowerCase();
  const exact = events[key];
  if (exact) {
    return toEventMapResult(exact);
  }

  const colonIdx = key.indexOf(":");
  if (colonIdx !== -1) {
    const bare = key.slice(0, colonIdx);
    const fallback = events[bare];
    if (fallback) {
      return toEventMapResult(fallback);
    }
  }

  return { kind: "unknown" };
}

function toEventMapResult(spec: AgentEventSpec): EventMapResult {
  if (spec === "noop") {
    return { kind: "noop" };
  }
  return {
    kind: "state",
    state: {
      lifecycle: spec.lifecycle,
      source: spec.source ?? ("hook" satisfies AgentSignalSource),
      confidence: spec.confidence ?? ("high" satisfies AgentSignalConfidence),
    },
  };
}

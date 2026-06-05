import type { AgentLifecycle } from "@parasor/shared";
import type { AgentObservation } from "./detector.js";

/*
 * Per-agent hook event normalization. Each supported coding agent has its
 * own hook vocabulary; this module is the single source of truth that
 * translates them to parasor's lifecycle/source/confidence observations.
 *
 * Architectural pattern (single normalization layer, agent-specific event
 * dictionaries) re-derived from the same shape the runtime-only wrapper uses in their
 * notify-hook + mapEventType flow. The actual mapping tables and parasor's
 * agent enum are independent.
 */

const AGENT_NAME_LIST = ["claude", "codex", "manual"] as const;
export type AgentName = (typeof AGENT_NAME_LIST)[number];
const AGENT_NAMES: ReadonlySet<AgentName> = new Set(AGENT_NAME_LIST);

/**
 * Outcome of normalizing a hook event:
 *   - `{ kind: "state", state }` -- apply the observation to the session
 *   - `{ kind: "noop" }`          -- recognized but intentionally ignored
 *                                    (e.g. Claude's SessionStart, which is
 *                                    only used for PID registration in
 *                                    other implementations)
 *   - `{ kind: "unknown" }`       -- event name not in the dictionary; the
 *                                    caller should reject with a 4xx
 */
export type EventMapResult =
  | { kind: "state"; state: AgentObservation }
  | { kind: "noop" }
  | { kind: "unknown" };

const NOOP: EventMapResult = { kind: "noop" };

function hookState(lifecycle: AgentLifecycle): EventMapResult {
  return {
    kind: "state",
    state: {
      lifecycle,
      source: "hook",
      confidence: "high",
    },
  };
}

function notifyState(lifecycle: AgentLifecycle): EventMapResult {
  return {
    kind: "state",
    state: {
      lifecycle,
      source: "notify",
      confidence: "high",
    },
  };
}

/*
 * Claude Code event -> AgentStatus dictionary.
 *
 * We keep the primary status model close to the user's requested 3-way
 * split and to the OSS references we studied:
 *
 *   - `running`  = Claude is thinking / acting autonomously
 *   - `waiting`  = Claude explicitly needs a human response or approval
 *   - `completed`/`idle` fold to sidebar `other`
 *
 * The important consequence is that ordinary tool execution stays
 * `running`. `attention` should be reserved for explicit human hand-off
 * moments, not every autonomous tool loop. That keeps the sidebar calmer
 * and avoids red pulses / notifications for routine edits or shell calls.
 *
 * Notification subtypes come in as discriminated keys (see cli/hook.ts).
 * We only elevate the documented user-input-required types to `waiting`;
 * everything else is ignored conservatively rather than over-alerting.
 */
const CLAUDE_EVENTS: Record<string, EventMapResult> = {
  // SessionStart is a noop: in other tools it registered the agent PID,
  // and we don't want it to flash "running" before the first user turn.
  sessionstart: NOOP,
  userpromptsubmit: hookState("running"),
  pretooluse: hookState("running"),
  "pretooluse:askuserquestion": hookState("waiting"),
  "pretooluse:exitplanmode": hookState("waiting"),
  permissionrequest: hookState("waiting"),
  permissiondenied: hookState("running"),
  posttooluse: hookState("running"),
  stop: hookState("completed"),
  notification: NOOP,
  "notification:auth_success": NOOP,
  "notification:permission_prompt": hookState("waiting"),
  "notification:idle_prompt": hookState("waiting"),
  "notification:elicitation_dialog": hookState("waiting"),
  elicitation: hookState("waiting"),
  elicitationresult: hookState("running"),
  sessionend: hookState("idle"),
};

const CODEX_EVENTS: Record<string, EventMapResult> = {
  sessionstart: NOOP,
  userpromptsubmit: hookState("running"),
  stop: hookState("completed"),
  // Codex CLI uses a different event vocabulary. Names re-derived from
  // public docs and the public Codex hook examples
  // (their bash case statement, not their TS code).
  task_started: hookState("running"),
  turn_started: hookState("running"),
  agent_turn_started: hookState("running"),
  // Both naming conventions appear in the wild; accept dash and underscore.
  "agent-turn-started": hookState("running"),
  exec_command_begin: hookState("running"),
  task_complete: hookState("completed"),
  turn_complete: hookState("completed"),
  agent_turn_complete: hookState("completed"),
  "agent-turn-complete": hookState("completed"),
  exec_approval_request: hookState("waiting"),
  apply_patch_approval_request: hookState("waiting"),
  request_user_input: hookState("waiting"),
};

// Manual agent: used by `parasor notify` CLI and shell wrappers that want
// to push state directly without a per-event vocabulary. The "event" here
// is the desired status name, so the table is a 1:1 passthrough.
const MANUAL_EVENTS: Record<string, EventMapResult> = {
  running: notifyState("running"),
  waiting: notifyState("waiting"),
  completed: notifyState("completed"),
  idle: notifyState("idle"),
};

const AGENT_TABLES: Record<AgentName, Record<string, EventMapResult>> = {
  claude: CLAUDE_EVENTS,
  codex: CODEX_EVENTS,
  manual: MANUAL_EVENTS,
};

export function isKnownAgent(name: string): name is AgentName {
  return (AGENT_NAMES as ReadonlySet<string>).has(name);
}

export function mapEventType(agent: AgentName, event: string): EventMapResult {
  // Hook scripts may pass events with different casing depending on the
  // agent's quoting / template (Claude uses PascalCase, Codex uses
  // snake_case). Normalize before lookup so the dictionary stays small.
  const key = event.trim().toLowerCase();
  const table = AGENT_TABLES[agent];
  const exact = table[key];
  if (exact) return exact;

  // Discriminator fallback. cli/hook.ts may emit composite events like
  // `PreToolUse:Bash` or `Notification:auth_success` for payload-driven
  // dispatch. If the composite key isn't in the dictionary explicitly we
  // strip the discriminator and try the bare event class, which is biased
  // toward `running` / `noop` for Claude so unknown future subtypes don't
  // over-alert the user.
  const colonIdx = key.indexOf(":");
  if (colonIdx !== -1) {
    const bare = key.slice(0, colonIdx);
    const fallback = table[bare];
    if (fallback) return fallback;
  }

  return { kind: "unknown" };
}

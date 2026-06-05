import { postHookNotify } from "./hook-client.js";

/*
 * Per-agent hook bridge. Reads the agent's native hook input from stdin
 * (or argv[1] for agents that pass it as an argument), parses out the
 * event name in TypeScript with a typed parser, and forwards a normalized
 * {sessionId, agent, event} request to the loopback hook endpoint.
 *
 * Why this and not bash + grep? Because every agent has its own JSON
 * shape, and parsing JSON with regex in a hook script is fragile (broken
 * by escaped quotes, nested objects, format drift between agent
 * versions). The single-purpose CLI keeps all per-agent format
 * knowledge in TypeScript where it belongs, and the bash side of each
 * wrapper script becomes a one-liner.
 */

// Agents that have a typed hook bridge below. "manual" is excluded -- it
// is not produced by a coding agent's hook system; the `parasor notify`
// CLI uses it directly via hook-client without going through this bridge.
type HookableAgent = "claude" | "codex";
const HOOKABLE_AGENTS: ReadonlySet<HookableAgent> = new Set([
  "claude",
  "codex",
]);

function isHookableAgent(value: string): value is HookableAgent {
  return (HOOKABLE_AGENTS as ReadonlySet<string>).has(value);
}

// Hook stdin must arrive promptly; bail if it doesn't so we don't hang
// the agent's own hook timeout (Claude Code's default is ~10s).
const STDIN_TIMEOUT_MS = 1500;
// Defensive cap on hook stdin size. Real hook payloads are a few KB at
// most (an event name plus a small object). A buggy or hostile agent
// could pipe an unbounded stream which would otherwise pin our heap.
const STDIN_MAX_BYTES = 1_000_000;

export async function cliHook(args: string[]): Promise<void> {
  const agent = args[0];
  if (!agent || !isHookableAgent(agent)) {
    console.error(
      `Usage: parasor hook <claude|codex>\nReads the agent's hook payload from stdin (or argv for agents that pass it as an argument), translates the event, and posts it to the parasor server.`,
    );
    process.exit(1);
  }

  const sessionId = process.env.PARASOR_SESSION_ID;
  if (!sessionId) {
    // Hook scripts run inside the PTY where the parasor server set
    // PARASOR_SESSION_ID. If we somehow got here without it, exit 0
    // (not an error) so the agent doesn't get a non-zero hook return
    // code that might surface in its UI.
    process.exit(0);
  }

  // Some agents (Codex) pass the hook payload as the second argv. Most
  // (Claude) pipe it on stdin. Try both, in that order.
  let payload = args.slice(1).join(" ");
  if (!payload) payload = await readStdin();
  if (!payload) {
    // No payload, nothing to do -- exit 0 so we don't break the agent.
    process.exit(0);
  }

  let event: string | null = null;
  try {
    if (agent === "claude") {
      event = parseClaudeEvent(payload);
    } else if (agent === "codex") {
      event = parseCodexEvent(payload);
    }
  } catch {
    // Parse failure should not break the agent's flow -- exit 0 silently.
    process.exit(0);
  }

  if (process.env.PARASOR_HOOK_DEBUG === "1") {
    console.error(`parasor hook ${agent}: parsed event=${event ?? "<null>"}`);
  }

  if (!event) process.exit(0);

  const result = await postHookNotify({ sessionId, agent, event });
  if (!result.ok) {
    // Don't print to stdout -- Claude Code displays hook stderr to the
    // user. Use stderr for visibility but exit 0 so the agent isn't
    // disrupted by network blips. Hook bridge failures are a UX
    // degradation, not an agent error.
    if (process.env.PARASOR_HOOK_DEBUG === "1") {
      console.error(`parasor hook ${agent}: ${result.error}`);
    }
    process.exit(0);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    let truncated = false;
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      if (truncated) return;
      data += chunk;
      if (data.length >= STDIN_MAX_BYTES) {
        truncated = true;
        // Truncate so downstream parsers don't see partial trailing data
        // mixed with real fields. We resolve with empty so the caller
        // treats it as "no payload" and exits silently.
        resolve("");
      }
    });
    process.stdin.on("end", () => {
      if (!truncated) resolve(data);
    });
    process.stdin.on("error", () => resolve(""));
    setTimeout(() => resolve(data), STDIN_TIMEOUT_MS);
  });
}

interface ClaudeHookInput {
  hook_event_name?: unknown;
  tool_name?: unknown;
  notification_type?: unknown;
}

/*
 * Translate a Claude Code hook payload into the event name we forward to the
 * server. Returns the bare `hook_event_name` for most events, but composes
 * `<event>:<discriminator>` for two payload-dependent cases so the server's
 * event-map can dispatch them to different states:
 *
 *   PreToolUse     -> `PreToolUse:<tool_name>` so user-input-required tools
 *                    (AskUserQuestion, ExitPlanMode) map to `waiting`
 *                    while every other tool stays at the default `running`.
 *
 *   Notification   -> `Notification:<notification_type>` so `auth_success`
 *                    becomes a noop instead of flashing waiting, while real
 *                    input-required types (`permission_prompt`,
 *                    `idle_prompt`, `elicitation_dialog`) still resolve to
 *                    waiting through their dedicated mappings.
 *
 * Newer Claude Code builds also emit explicit `PermissionRequest`,
 * `PermissionDenied`, `Elicitation`, and `ElicitationResult` events.
 * Those don't need extra discrimination here; we forward the bare
 * `hook_event_name` and let the server-side event map decide.
 *
 * The server's `mapEventType` lower-cases the event before dictionary
 * lookup, so the casing here doesn't matter.
 */
export function parseClaudeEvent(raw: string): string | null {
  const parsed = JSON.parse(raw) as ClaudeHookInput;
  const event = parsed.hook_event_name;
  if (typeof event !== "string" || !event) return null;

  if (
    event === "PreToolUse" &&
    typeof parsed.tool_name === "string" &&
    parsed.tool_name
  ) {
    return `${event}:${parsed.tool_name}`;
  }

  if (
    event === "Notification" &&
    typeof parsed.notification_type === "string" &&
    parsed.notification_type
  ) {
    return `${event}:${parsed.notification_type}`;
  }

  return event;
}

interface CodexHookInput {
  type?: unknown;
  event?: unknown;
  hook_event_name?: unknown;
}

function parseCodexEvent(raw: string): string | null {
  const parsed = JSON.parse(raw) as CodexHookInput;
  if (typeof parsed.hook_event_name === "string" && parsed.hook_event_name) {
    return parsed.hook_event_name;
  }
  // Codex CLI has shipped a couple of variants over time -- `type` is the
  // current one, `event` was used in an older draft schema.
  if (typeof parsed.type === "string" && parsed.type) return parsed.type;
  if (typeof parsed.event === "string" && parsed.event) return parsed.event;
  return null;
}

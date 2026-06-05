import { postHookNotify } from "./hook-client.js";

const VALID_STATES = new Set(["running", "waiting", "completed", "idle"]);

/**
 * Push an agent state into the running parasor server via the loopback
 * HTTP hook endpoint. Invoked manually from shell scripts or arbitrary
 * agent wrappers that don't have a typed `parasor hook` integration:
 *
 *   parasor notify running
 *   parasor notify waiting --session abc-123
 *
 * Session resolution: --session flag first, then PARASOR_SESSION_ID env.
 * Both are set automatically when the PTY was spawned by the parasor
 * server (alongside PARASOR_PORT, which is what the HTTP client targets).
 *
 * Hook agents (Claude Code, Codex, ...) should NOT call this directly --
 * they have their own typed bridge `parasor hook <agent>` that parses the
 * native hook input on stdin and forwards a structured event to the same
 * /hook/notify endpoint.
 */
export async function cliNotify(args: string[]): Promise<void> {
  let state: string | undefined;
  let sessionId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--session" && i + 1 < args.length) {
      sessionId = args[++i];
      continue;
    }
    if (a.startsWith("--session=")) {
      sessionId = a.slice("--session=".length);
      continue;
    }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (state === undefined) {
      state = a;
    }
  }

  if (state === undefined) {
    printHelp();
    process.exit(1);
  }
  if (!VALID_STATES.has(state)) {
    console.error(
      `parasor notify: unknown state "${state}". Expected one of: ${[...VALID_STATES].join(", ")}.`,
    );
    process.exit(1);
  }

  const resolvedSessionId = sessionId ?? process.env.PARASOR_SESSION_ID;
  if (!resolvedSessionId) {
    console.error(
      "parasor notify: no session id available. Pass --session <id> or run inside a parasor PTY where PARASOR_SESSION_ID is set.",
    );
    process.exit(1);
  }

  const result = await postHookNotify({
    sessionId: resolvedSessionId,
    agent: "manual",
    event: state,
  });
  if (!result.ok) {
    console.error(`parasor notify: ${result.error}`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`Usage: parasor notify <running|waiting|completed|idle> [--session <id>]

Push an agent state into the running parasor server over the loopback
HTTP hook endpoint. The session id is read from --session, then
PARASOR_SESSION_ID. Requires PARASOR_PORT to point at the running
server (set automatically inside parasor PTYs).

Examples:
  parasor notify running
  parasor notify waiting --session abc-123
  parasor notify completed`);
}

import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import type { AgentDetector } from "../agent-detector/detector.js";
import {
  HookAccessError,
  HookNotFoundError,
  HookRateLimitError,
  HookValidationError,
} from "../application/integrations/errors.js";
import {
  createHookNotifier,
  isLoopbackAddress,
} from "../application/integrations/hook-notify.js";
import type { AgentStatusRecorder } from "../debug/agent-status-recorder.js";
import type { PtyHost } from "../pty/host.js";

/*
 * Hook bridge endpoint. Coding agents (Claude Code, Codex, ...) call this
 * via curl from inside their hook scripts to push state changes into the
 * running parasor server. This is the multi-agent equivalent of the
 * `parasor notify` CLI -- the CLI itself is now a thin wrapper around the
 * same HTTP endpoint.
 *
 * Mounted at /hook/notify (NOT /api/hook/notify) so the global token-auth
 * middleware on /api/* does not apply. Authentication is enforced
 * differently here: the route is loopback-only, the session must already
 * exist in the PTY host, and the agent + event must be in the recognized
 * dictionary. See the security model for the full threat model --
 * the blast radius is limited to spoofing AgentStatusIndicator UI state
 * for sessions on the same machine.
 */

interface CreateHookRouteOptions {
  ptyManager: PtyHost;
  agentDetector: AgentDetector;
  debugRecorder?: AgentStatusRecorder;
  /** Override for tests so they don't need to fake @hono/node-server/conninfo. */
  remoteAddress?: () => string | null;
}

export function createHookRoute(opts: CreateHookRouteOptions): Hono {
  const routes = new Hono();
  const hookNotifier = createHookNotifier({
    agentDetector: opts.agentDetector,
    ptyManager: opts.ptyManager,
    debugRecorder: opts.debugRecorder,
  });

  routes.post("/notify", async (c) => {
    const remote = readRemoteAddress(c, opts.remoteAddress);
    // Reject non-loopback callers BEFORE reading the body. /hook is
    // unauthenticated and LAN-reachable; without this an off-machine client
    // could make us parse an arbitrary-size JSON payload (DoS) before the
    // notifier's own access check rejects it. Mirrors /hook/debug.
    if (!isLoopbackAddress(remote)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    // Defense-in-depth for loopback callers: hook payloads are tiny status
    // JSON, so cap the declared size (64 KB) rather than parse an oversized
    // body.
    const declaredBytes = Number(c.req.header("content-length") ?? 0);
    if (Number.isFinite(declaredBytes) && declaredBytes > 64 * 1024) {
      return c.json({ error: "Payload too large" }, 413);
    }
    const body = await c.req.json().catch(() => null);

    try {
      return c.json(hookNotifier.notify(remote, body));
    } catch (error) {
      if (error instanceof HookAccessError) {
        return c.json({ error: error.message }, 403);
      }
      if (error instanceof HookRateLimitError) {
        return c.json({ error: error.message }, 429);
      }
      if (error instanceof HookNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof HookValidationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  routes.post("/debug", async (c) => {
    const remote = readRemoteAddress(c, opts.remoteAddress);
    if (!isLoopbackAddress(remote)) {
      return c.json(
        { error: "Forbidden: hook endpoint is loopback-only" },
        403,
      );
    }

    const body = await c.req
      .json<{
        sessionId?: unknown;
        label?: unknown;
        detail?: unknown;
      }>()
      .catch(() => null);

    if (
      !body ||
      typeof body.sessionId !== "string" ||
      body.sessionId.length === 0
    ) {
      return c.json({ error: "sessionId required" }, 400);
    }
    if (typeof body.label !== "string" || body.label.length === 0) {
      return c.json({ error: "label required" }, 400);
    }
    if (!opts.ptyManager.get(body.sessionId)) {
      return c.json({ error: "Session not found" }, 404);
    }

    opts.debugRecorder?.record(
      "hook-debug",
      {
        label: body.label,
        detail: body.detail ?? null,
      },
      body.sessionId,
    );

    return c.json({ ok: true });
  });

  return routes;
}

function readRemoteAddress(
  c: Context,
  override?: () => string | null,
): string | null {
  if (override) return override();
  try {
    const info = getConnInfo(c);
    return info.remote.address ?? null;
  } catch {
    return null;
  }
}

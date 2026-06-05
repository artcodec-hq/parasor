import type { AgentState } from "@parasor/shared";
import { Hono } from "hono";
import type { AgentStatusRecorder } from "../debug/agent-status-recorder.js";

export function createDebugAgentStatusRoute(
  recorder: AgentStatusRecorder,
  getStates: () => Record<string, AgentState>,
): Hono {
  const routes = new Hono();

  routes.get("/", (c) => {
    const sinceRaw = c.req.query("since");
    const since = sinceRaw === undefined ? null : Number(sinceRaw);
    const events =
      since !== null && Number.isFinite(since)
        ? recorder.listSince(since)
        : recorder.list();
    return c.json({
      states: getStates(),
      events,
    });
  });

  routes.delete("/", async (c) => {
    recorder.clear();
    await recorder.clearPersistedLog();
    return c.json({ ok: true });
  });

  return routes;
}

import { Hono } from "hono";
import type { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";

interface DebugDiagnosticsRouteDeps {
  terminalTraceRecorder: TerminalTraceRecorder;
}

function diagnosticsSummary(terminalTraceRecorder: TerminalTraceRecorder) {
  return {
    diagnostics: {
      enabled: terminalTraceRecorder.isEnabled(),
    },
    terminalTrace: terminalTraceRecorder.summary(),
  };
}

export function createDebugDiagnosticsRoute({
  terminalTraceRecorder,
}: DebugDiagnosticsRouteDeps): Hono {
  const routes = new Hono();

  routes.get("/", (c) => {
    return c.json(diagnosticsSummary(terminalTraceRecorder));
  });

  routes.post("/", async (c) => {
    const body = await c.req
      .json<{ enabled?: unknown; clear?: unknown }>()
      .catch(() => ({}) as { enabled?: unknown; clear?: unknown });

    if (typeof body.enabled === "boolean") {
      terminalTraceRecorder.setEnabled(body.enabled);
    }
    if (body.clear === true) {
      terminalTraceRecorder.clear();
    }

    return c.json(diagnosticsSummary(terminalTraceRecorder));
  });

  routes.delete("/", (c) => {
    terminalTraceRecorder.setEnabled(false);
    terminalTraceRecorder.clear();
    return c.json(diagnosticsSummary(terminalTraceRecorder));
  });

  return routes;
}

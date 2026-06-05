import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";
import { createDebugDiagnosticsRoute } from "./debug-diagnostics.js";

describe("debug diagnostics route", () => {
  function makeApp() {
    const terminalTraceRecorder = new TerminalTraceRecorder({ now: () => 123 });
    const app = new Hono();
    app.route(
      "/api/debug/diagnostics",
      createDebugDiagnosticsRoute({ terminalTraceRecorder }),
    );
    return { app, terminalTraceRecorder };
  }

  it("reports diagnostics and terminal trace state", async () => {
    const { app } = makeApp();

    const res = await app.request("/api/debug/diagnostics");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      diagnostics: { enabled: false },
      terminalTrace: {
        enabled: false,
        eventCount: 0,
      },
    });
  });

  it("enables diagnostics without requiring a restart", async () => {
    const { app, terminalTraceRecorder } = makeApp();

    const res = await app.request("/api/debug/diagnostics", {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
      headers: { "content-type": "application/json" },
    });
    terminalTraceRecorder.record("pty-refresh", {}, { sessionId: "s1" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      diagnostics: { enabled: true },
      terminalTrace: { enabled: true },
    });
    expect(terminalTraceRecorder.list()).toEqual([
      expect.objectContaining({ type: "pty-refresh", sessionId: "s1" }),
    ]);
  });

  it("clears trace data while preserving requested enablement", async () => {
    const { app, terminalTraceRecorder } = makeApp();
    terminalTraceRecorder.setEnabled(true);
    terminalTraceRecorder.record("pty-refresh", {}, { sessionId: "s1" });

    const res = await app.request("/api/debug/diagnostics", {
      method: "POST",
      body: JSON.stringify({ enabled: true, clear: true }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      diagnostics: { enabled: true },
      terminalTrace: { enabled: true, eventCount: 0 },
    });
    expect(terminalTraceRecorder.list()).toEqual([]);
  });

  it("delete disables diagnostics and clears trace data", async () => {
    const { app, terminalTraceRecorder } = makeApp();
    terminalTraceRecorder.setEnabled(true);
    terminalTraceRecorder.record("pty-refresh", {}, { sessionId: "s1" });

    const res = await app.request("/api/debug/diagnostics", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      diagnostics: { enabled: false },
      terminalTrace: { enabled: false, eventCount: 0 },
    });
    expect(terminalTraceRecorder.isEnabled()).toBe(false);
    expect(terminalTraceRecorder.list()).toEqual([]);
  });
});

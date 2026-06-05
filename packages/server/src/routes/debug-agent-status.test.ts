import { promises as fsp, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentState } from "@parasor/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { AgentStatusRecorder } from "../debug/agent-status-recorder.js";
import { createDebugAgentStatusRoute } from "./debug-agent-status.js";

describe("debug agent status route", () => {
  const cleanups: string[] = [];

  afterEach(async () => {
    for (const dir of cleanups.splice(0)) {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns current states and recorded events", async () => {
    const recorder = new AgentStatusRecorder({ now: () => 123 });
    recorder.record("hook-received", { event: "PermissionRequest" }, "s1");

    const states: Record<string, AgentState> = {
      s1: {
        sessionId: "s1",
        lifecycle: "waiting",
        source: "hook",
        confidence: "high",
        detectedAt: 123,
      },
    };

    const app = new Hono();
    app.route(
      "/api/debug/agent-status",
      createDebugAgentStatusRoute(recorder, () => states),
    );

    const res = await app.request("/api/debug/agent-status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      states,
      events: [
        {
          seq: 1,
          timestamp: 123,
          type: "hook-received",
          sessionId: "s1",
          payload: { event: "PermissionRequest" },
        },
      ],
    });
  });

  it("supports `?since=<seq>` to fetch only newer events", async () => {
    const recorder = new AgentStatusRecorder({ now: () => 123 });
    recorder.record("hook-received", { event: "A" }, "s1");
    recorder.record("hook-received", { event: "B" }, "s1");
    recorder.record("hook-received", { event: "C" }, "s1");

    const app = new Hono();
    app.route(
      "/api/debug/agent-status",
      createDebugAgentStatusRoute(recorder, () => ({})),
    );

    const res = await app.request("/api/debug/agent-status?since=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: { payload: { event: string } }[];
    };
    expect(body.events.map((e) => e.payload.event)).toEqual(["B", "C"]);
  });

  it("clears recorded events on delete", async () => {
    const recorder = new AgentStatusRecorder();
    recorder.record("manual-tracker", { message: "hint claude" }, "s1");

    const app = new Hono();
    app.route(
      "/api/debug/agent-status",
      createDebugAgentStatusRoute(recorder, () => ({})),
    );

    const res = await app.request("/api/debug/agent-status", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(recorder.list()).toEqual([]);
  });

  it("clears persisted debug logs on delete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "parasor-agent-status-route-"));
    cleanups.push(dir);
    const logPath = join(dir, "events.jsonl");
    const recorder = new AgentStatusRecorder({ now: () => 123, logPath });
    recorder.record("manual-tracker", { message: "hint claude" }, "s1");
    await recorder.flush();
    await fsp.writeFile(`${logPath}.1`, "old\n", "utf8");

    const app = new Hono();
    app.route(
      "/api/debug/agent-status",
      createDebugAgentStatusRoute(recorder, () => ({})),
    );

    const res = await app.request("/api/debug/agent-status", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(recorder.list()).toEqual([]);
    await expect(fsp.stat(logPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fsp.stat(`${logPath}.1`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(() => readFileSync(logPath, "utf8")).toThrow();
  });
});

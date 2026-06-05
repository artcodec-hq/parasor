import { promises as fsp, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentStatusRecorder } from "./agent-status-recorder.js";

describe("AgentStatusRecorder", () => {
  it("keeps recent events in insertion order", () => {
    const recorder = new AgentStatusRecorder({ maxEvents: 2, now: () => 123 });

    recorder.record("manual-tracker", { message: "hint claude" }, "s1");
    recorder.record("hook-received", { event: "PermissionRequest" }, "s1");
    recorder.record("detector-state", { lifecycle: "waiting" }, "s1");

    expect(recorder.list()).toEqual([
      {
        seq: 2,
        timestamp: 123,
        type: "hook-received",
        sessionId: "s1",
        payload: { event: "PermissionRequest" },
      },
      {
        seq: 3,
        timestamp: 123,
        type: "detector-state",
        sessionId: "s1",
        payload: { lifecycle: "waiting" },
      },
    ]);
  });

  it("clears events", () => {
    const recorder = new AgentStatusRecorder();
    recorder.record("manual-tracker", { message: "x" }, "s1");
    recorder.clear();
    expect(recorder.list()).toEqual([]);
  });

  it("returns only events after `since` via listSince", () => {
    const recorder = new AgentStatusRecorder({ now: () => 1 });
    recorder.record("hook-received", { event: "a" }, "s1");
    recorder.record("hook-received", { event: "b" }, "s1");
    recorder.record("hook-received", { event: "c" }, "s1");

    expect(recorder.listSince(1).map((e) => e.payload.event)).toEqual([
      "b",
      "c",
    ]);
    expect(recorder.listSince(3)).toEqual([]);
  });

  it("bounds payload strings before storing events", () => {
    const recorder = new AgentStatusRecorder({ now: () => 1 });
    recorder.record("hook-debug", { detail: "x".repeat(5000) }, "s1");

    const detail = recorder.list()[0]?.payload.detail;
    expect(typeof detail).toBe("string");
    expect((detail as string).length).toBeLessThan(5000);
    expect(detail).toMatch(/…$/u);
  });

  describe("JSONL persistence", () => {
    let dir: string;
    let logPath: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "parasor-agent-status-"));
      logPath = join(dir, "events.jsonl");
    });

    afterEach(async () => {
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it("appends each record as a JSONL line at logPath", async () => {
      const recorder = new AgentStatusRecorder({ now: () => 1, logPath });
      recorder.record("hook-received", { event: "PermissionRequest" }, "s1");
      recorder.record("hook-mapped", { lifecycle: "waiting" }, "s1");
      await recorder.flush();

      const contents = readFileSync(logPath, "utf8").trim().split("\n");
      expect(contents).toHaveLength(2);
      const first = JSON.parse(contents[0]);
      expect(first.type).toBe("hook-received");
      expect(first.payload).toEqual({ event: "PermissionRequest" });
      expect(first.seq).toBe(1);
    });

    it("rotates to <path>.1 once maxFileBytes is exceeded", async () => {
      const recorder = new AgentStatusRecorder({
        now: () => 1,
        logPath,
        maxFileBytes: 200,
      });
      const big = "x".repeat(80);
      recorder.record("hook-received", { payload: big }, "s1");
      recorder.record("hook-received", { payload: big }, "s1");
      recorder.record("hook-received", { payload: big }, "s1");
      await recorder.flush();

      const archived = readFileSync(`${logPath}.1`, "utf8");
      expect(archived.length).toBeGreaterThan(0);
      // After rotation the live file may or may not exist depending on
      // ordering, but the archived file must contain at least one of the
      // earlier records.
      expect(archived).toContain('"hook-received"');
    });

    it("truncates oversized event payloads before buffering or writing", async () => {
      const recorder = new AgentStatusRecorder({
        now: () => 1,
        logPath,
        maxEventBytes: 180,
      });
      recorder.record("hook-debug", { detail: "x".repeat(1000) }, "s1");
      await recorder.flush();

      expect(recorder.list()[0]?.payload).toEqual({
        truncated: true,
        originalBytes: expect.any(Number),
        keys: ["detail"],
      });
      const [line] = readFileSync(logPath, "utf8").trim().split("\n");
      expect(JSON.parse(line).payload).toEqual({
        truncated: true,
        originalBytes: expect.any(Number),
        keys: ["detail"],
      });
    });

    it("clears persisted live and rotated logs", async () => {
      const recorder = new AgentStatusRecorder({ now: () => 1, logPath });
      recorder.record("hook-received", { event: "A" }, "s1");
      await recorder.flush();
      await fsp.writeFile(`${logPath}.1`, "old\n", "utf8");

      await recorder.clearPersistedLog();

      await expect(fsp.stat(logPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(fsp.stat(`${logPath}.1`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});

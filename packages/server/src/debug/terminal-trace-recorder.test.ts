import { describe, expect, it } from "vitest";
import { TerminalTraceRecorder } from "./terminal-trace-recorder.js";

describe("TerminalTraceRecorder", () => {
  it("is opt-in and keeps a bounded sanitized event buffer", () => {
    const recorder = new TerminalTraceRecorder({
      enabled: false,
      maxEvents: 2,
      now: () => 123,
    });

    recorder.record("ws-message", { data: "secret" }, { sessionId: "s1" });
    expect(recorder.list()).toEqual([]);

    recorder.setEnabled(true);
    recorder.record("ws-message", { byteLength: 6 }, { sessionId: "s1" });
    recorder.record("pty-write", { dataLength: 6 }, { sessionId: "s1" });
    recorder.record("pty-refresh", {}, { sessionId: "s1" });

    expect(recorder.list()).toEqual([
      {
        seq: 2,
        timestamp: 123,
        type: "pty-write",
        sessionId: "s1",
        payload: { dataLength: 6 },
      },
      {
        seq: 3,
        timestamp: 123,
        type: "pty-refresh",
        sessionId: "s1",
        payload: {},
      },
    ]);
    expect(recorder.summary()).toMatchObject({
      enabled: true,
      eventCount: 2,
      firstSeq: 2,
      lastSeq: 3,
      byType: { "pty-write": 1, "pty-refresh": 1 },
    });
    expect(recorder.listSince(2)).toEqual([
      {
        seq: 3,
        timestamp: 123,
        type: "pty-refresh",
        sessionId: "s1",
        payload: {},
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  clearTerminalReplayCache,
  getTerminalReplayCache,
  getTerminalReplayCacheStats,
  setTerminalReplayCache,
} from "./terminal-replay-cache.js";

describe("terminal replay cache", () => {
  it("stores and returns raw replay data with its cursor", () => {
    clearTerminalReplayCache();

    setTerminalReplayCache("s1", {
      data: "snapshot",
      lastSeen: { generation: 3, seq: "9" },
    });

    expect(getTerminalReplayCache("s1")).toEqual(
      expect.objectContaining({
        data: "snapshot",
        lastSeen: { generation: 3, seq: "9" },
      }),
    );
  });

  it("drops empty and oversized entries", () => {
    clearTerminalReplayCache();

    setTerminalReplayCache("empty", {
      data: "",
      lastSeen: { generation: 1, seq: "0" },
    });
    setTerminalReplayCache("huge", {
      data: "x".repeat(4 * 1024 * 1024 + 1),
      lastSeen: { generation: 1, seq: "0" },
    });

    expect(getTerminalReplayCache("empty")).toBeNull();
    expect(getTerminalReplayCache("huge")).toBeNull();
    expect(getTerminalReplayCacheStats()).toEqual({
      entries: 0,
      totalChars: 0,
    });
  });

  it("evicts oldest entries when the total cap is exceeded", () => {
    clearTerminalReplayCache();
    const data = "x".repeat(3 * 1024 * 1024);

    for (let i = 0; i < 5; i++) {
      setTerminalReplayCache(`s${i}`, {
        data,
        lastSeen: { generation: 1, seq: String(i) },
      });
    }

    expect(getTerminalReplayCache("s0")).toBeNull();
    expect(getTerminalReplayCache("s1")).not.toBeNull();
    expect(getTerminalReplayCacheStats().totalChars).toBeLessThanOrEqual(
      12 * 1024 * 1024,
    );
  });

  it("clears one session or all sessions", () => {
    clearTerminalReplayCache();
    setTerminalReplayCache("s1", {
      data: "one",
      lastSeen: { generation: 1, seq: "1" },
    });
    setTerminalReplayCache("s2", {
      data: "two",
      lastSeen: { generation: 1, seq: "2" },
    });

    clearTerminalReplayCache("s1");
    expect(getTerminalReplayCache("s1")).toBeNull();
    expect(getTerminalReplayCache("s2")).not.toBeNull();

    clearTerminalReplayCache();
    expect(getTerminalReplayCacheStats()).toEqual({
      entries: 0,
      totalChars: 0,
    });
  });
});

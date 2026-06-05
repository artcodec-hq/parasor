import type { Session } from "@parasor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDetector } from "../../agent-detector/detector.js";
import type { PtyHost } from "../../pty/host.js";
import {
  HookAccessError,
  HookNotFoundError,
  HookRateLimitError,
  HookValidationError,
} from "./errors.js";
import { createHookNotifier, isLoopbackAddress } from "./hook-notify.js";

describe("isLoopbackAddress", () => {
  it("accepts IPv4, IPv6, and mapped loopback addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::ffff:7f00:0001")).toBe(true);
    expect(isLoopbackAddress("127.0.0.2")).toBe(true);
  });

  it("rejects non-loopback addresses", () => {
    expect(isLoopbackAddress("192.168.1.42")).toBe(false);
    expect(isLoopbackAddress("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("createHookNotifier", () => {
  let setExternalState: ReturnType<typeof vi.fn>;
  let notifier: ReturnType<typeof createHookNotifier>;

  beforeEach(() => {
    setExternalState = vi.fn();
    notifier = createHookNotifier({
      agentDetector: {
        setExternalState,
      } as unknown as AgentDetector,
      now: vi.fn(() => 1_000),
      ptyManager: {
        get: vi.fn((id: string): Session | undefined =>
          id === "valid-session"
            ? ({ id, projectId: "p1", state: "running" } as unknown as Session)
            : undefined,
        ),
      } as unknown as PtyHost,
    });
  });

  it("notifies agent state for valid events", () => {
    expect(
      notifier.notify("127.0.0.1", {
        sessionId: "valid-session",
        agent: "claude",
        event: "Stop",
      }),
    ).toEqual({
      ok: true,
      applied: true,
      lifecycle: "completed",
      source: "hook",
      confidence: "high",
    });
    expect(setExternalState).toHaveBeenCalledWith("valid-session", {
      lifecycle: "completed",
      source: "hook",
      confidence: "high",
    });
  });

  it("returns noop results without touching state", () => {
    expect(
      notifier.notify("127.0.0.1", {
        sessionId: "valid-session",
        agent: "claude",
        event: "SessionStart",
      }),
    ).toEqual({ ok: true, applied: false });
    expect(setExternalState).not.toHaveBeenCalled();
  });

  it("rejects non-loopback callers", () => {
    expect(() =>
      notifier.notify("192.168.1.42", {
        sessionId: "valid-session",
        agent: "claude",
        event: "Stop",
      }),
    ).toThrow(HookAccessError);
  });

  it("rejects invalid payloads", () => {
    expect(() => notifier.notify("127.0.0.1", null)).toThrow(
      HookValidationError,
    );
    expect(() =>
      notifier.notify("127.0.0.1", {
        sessionId: "valid-session",
        agent: "cursor",
        event: "Stop",
      }),
    ).toThrow(HookValidationError);
  });

  it("rejects missing sessions", () => {
    expect(() =>
      notifier.notify("127.0.0.1", {
        sessionId: "ghost",
        agent: "claude",
        event: "Stop",
      }),
    ).toThrow(HookNotFoundError);
  });

  it("rate limits after 100 events in the same window", () => {
    for (let i = 0; i < 100; i++) {
      notifier.notify("127.0.0.1", {
        sessionId: "valid-session",
        agent: "claude",
        event: "Stop",
      });
    }

    expect(() =>
      notifier.notify("127.0.0.1", {
        sessionId: "valid-session",
        agent: "claude",
        event: "Stop",
      }),
    ).toThrow(HookRateLimitError);
  });
});

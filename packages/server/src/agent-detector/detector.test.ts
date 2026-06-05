import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentObservation } from "./detector.js";
import { AgentDetector, sanitizeTerminalOutput } from "./detector.js";

function outputState(lifecycle: AgentObservation["lifecycle"]) {
  return {
    lifecycle,
    source: "output" as const,
    confidence: "medium" as const,
  };
}

function hookState(lifecycle: AgentObservation["lifecycle"]) {
  return {
    lifecycle,
    source: "hook" as const,
    confidence: "high" as const,
  };
}

describe("AgentDetector", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits running on the first non-waiting output", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "Some output...\n");
    expect(callback).toHaveBeenCalledWith({
      sessionId: "session-1",
      ...outputState("running"),
      detectedAt: 123,
    });
  });

  it("detects Claude Code waiting pattern", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "Press Enter to continue");
    expect(callback).toHaveBeenCalledWith({
      sessionId: "session-1",
      ...outputState("waiting"),
      detectedAt: 123,
    });
  });

  it("detects prompt return as completed", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "Done.\n❯ ");
    expect(callback).toHaveBeenCalledWith({
      sessionId: "session-1",
      ...outputState("completed"),
      detectedAt: 123,
    });
  });

  it("ignores non-agent shell output when observation is disabled", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "\n❯ ", { observeOutput: false });
    expect(callback).not.toHaveBeenCalled();
    expect(detector.getStates()).toEqual({});
  });

  it("ignores control-only output chunks", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "\u001b]0;Claude Code\u0007");
    expect(callback).not.toHaveBeenCalled();
    expect(detector.getStates()).toEqual({});
  });

  it("transitions back to running when output flows after a wait", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "\n❯ ");
    callback.mockClear();

    detector.feed("session-1", "Running command...\nmore output\n");
    expect(callback).toHaveBeenCalledWith({
      sessionId: "session-1",
      ...outputState("running"),
      detectedAt: 123,
    });
  });

  it("detects idle state after inactivity", () => {
    vi.useFakeTimers();
    const detector = new AgentDetector({
      idleTimeoutMs: 50,
      now: () => Date.now(),
    });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "done\n$ ");
    vi.advanceTimersByTime(100);

    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        ...outputState("idle"),
      }),
    );
    detector.dispose();
  });

  it("does not let control-only output keep a session running forever", () => {
    vi.useFakeTimers();
    const detector = new AgentDetector({
      idleTimeoutMs: 50,
      now: () => Date.now(),
    });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "Thinking...\n");
    vi.advanceTimersByTime(25);
    detector.feed("session-1", "\u001b]0;Claude Code\u0007");
    vi.advanceTimersByTime(30);

    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        ...outputState("idle"),
      }),
    );
    detector.dispose();
  });

  it("does not emit duplicate state changes", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "Press Enter");
    detector.feed("session-1", "Press Enter");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("removes session state on cleanup", () => {
    const detector = new AgentDetector({ now: () => 123 });
    detector.feed("session-1", "\n❯ ");
    detector.removeSession("session-1");
    expect(detector.getStates()).toEqual({});
  });

  it("upgrades matching lifecycle from output to hook metadata", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "work\n");
    detector.setExternalState("session-1", hookState("running"));

    expect(callback).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      ...hookState("running"),
      detectedAt: 123,
    });
  });

  it("setExternalState mutes weaker output observations", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.setExternalState("session-1", hookState("completed"));
    expect(callback).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      ...hookState("completed"),
      detectedAt: 123,
    });

    callback.mockClear();
    detector.feed("session-1", "More TUI output...\n");
    expect(callback).not.toHaveBeenCalled();
  });

  it("clears an output-managed state back to idle when observation is disabled", () => {
    const detector = new AgentDetector({ now: () => 123 });
    const callback = vi.fn();
    detector.onStateChange(callback);

    detector.feed("session-1", "agent output\n");
    callback.mockClear();

    detector.feed("session-1", "shell prompt\n", { observeOutput: false });
    expect(callback).toHaveBeenCalledWith({
      sessionId: "session-1",
      ...outputState("idle"),
      detectedAt: 123,
    });
  });

  it("removeSession clears precedence so feed resumes after restart", () => {
    const detector = new AgentDetector({ now: () => 123 });
    detector.setExternalState("session-1", hookState("running"));
    detector.removeSession("session-1");

    const callback = vi.fn();
    detector.onStateChange(callback);
    detector.feed("session-1", "fresh output\n");
    expect(callback).toHaveBeenCalledWith({
      sessionId: "session-1",
      ...outputState("running"),
      detectedAt: 123,
    });
  });

  it("restores hook-managed state so weaker output does not override it after restart", () => {
    const detector = new AgentDetector({ now: () => 123 });
    detector.restoreStates({
      "session-1": {
        sessionId: "session-1",
        ...hookState("waiting"),
        detectedAt: 100,
      },
    });

    const callback = vi.fn();
    detector.onStateChange(callback);
    detector.feed("session-1", "TUI repaint\n");

    expect(callback).not.toHaveBeenCalled();
    expect(detector.getStates()).toEqual({
      "session-1": {
        sessionId: "session-1",
        ...hookState("waiting"),
        detectedAt: 100,
      },
    });
  });

  it("restores output-managed idle timers with the remaining timeout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const detector = new AgentDetector({
      idleTimeoutMs: 50,
      now: () => Date.now(),
    });
    detector.restoreStates({
      "session-1": {
        sessionId: "session-1",
        ...outputState("running"),
        detectedAt: 980,
      },
    });

    const callback = vi.fn();
    detector.onStateChange(callback);
    vi.advanceTimersByTime(29);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        ...outputState("idle"),
      }),
    );
    detector.dispose();
  });

  it("restores expired output-managed states as idle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const detector = new AgentDetector({
      idleTimeoutMs: 50,
      now: () => Date.now(),
    });

    detector.restoreStates({
      "session-1": {
        sessionId: "session-1",
        ...outputState("running"),
        detectedAt: 900,
      },
    });

    expect(detector.getStates()).toEqual({
      "session-1": {
        sessionId: "session-1",
        ...outputState("idle"),
        detectedAt: 1_000,
      },
    });
    detector.dispose();
  });
});

describe("AgentDetector trace events", () => {
  it("emits feed-skip-source when output is blocked by a stronger hook state", () => {
    const traces: unknown[] = [];
    const detector = new AgentDetector({
      now: () => 1,
      onTrace: (event) => traces.push(event),
    });
    detector.setExternalState("session-1", hookState("running"));
    detector.feed("session-1", "tui repaint\n");

    expect(
      traces.find((t) => (t as { kind: string }).kind === "feed-skip-source"),
    ).toMatchObject({
      kind: "feed-skip-source",
      sessionId: "session-1",
      current: "hook",
      currentLifecycle: "running",
    });
  });

  it("emits feed-control-only for control-sequence-only chunks", () => {
    const traces: unknown[] = [];
    const detector = new AgentDetector({
      now: () => 1,
      onTrace: (event) => traces.push(event),
    });
    detector.feed("session-1", "]0;Title");

    expect(traces).toContainEqual({
      kind: "feed-control-only",
      sessionId: "session-1",
    });
  });

  it("emits feed-observed with lifecycle + sample tail on a meaningful chunk", () => {
    const traces: unknown[] = [];
    const detector = new AgentDetector({
      now: () => 1,
      onTrace: (event) => traces.push(event),
    });
    detector.feed("session-1", "Press Enter to continue");

    expect(traces).toContainEqual(
      expect.objectContaining({
        kind: "feed-observed",
        sessionId: "session-1",
        lifecycle: "waiting",
      }),
    );
  });

  it("does not emit feed-observed for ordinary running output chunks", () => {
    const traces: unknown[] = [];
    const detector = new AgentDetector({
      now: () => 1,
      onTrace: (event) => traces.push(event),
    });
    detector.feed("session-1", "installing dependencies\n");

    expect(
      traces.find((t) => (t as { kind: string }).kind === "feed-observed"),
    ).toBeUndefined();
  });

  it("emits applied-skip-source when setExternalState loses the priority race", () => {
    const traces: unknown[] = [];
    const detector = new AgentDetector({
      now: () => 1,
      onTrace: (event) => traces.push(event),
    });
    detector.setExternalState("session-1", hookState("running"));
    detector.setExternalState("session-1", {
      lifecycle: "waiting",
      source: "notify",
      confidence: "high",
    });

    expect(traces).toContainEqual(
      expect.objectContaining({
        kind: "applied-skip-source",
        sessionId: "session-1",
        incoming: "notify",
        incomingLifecycle: "waiting",
        current: "hook",
        currentLifecycle: "running",
      }),
    );
  });
});

describe("sanitizeTerminalOutput", () => {
  it("removes OSC and CSI sequences while preserving visible text", () => {
    expect(
      sanitizeTerminalOutput("\u001b]0;title\u0007\u001b[31mHello\u001b[0m\n"),
    ).toBe("Hello\n");
  });
});

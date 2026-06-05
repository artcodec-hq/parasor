import { describe, expect, it } from "vitest";
import { ManualAgentTracker } from "./manual-agent-tracker.js";

describe("ManualAgentTracker", () => {
  it("does not start observing immediately after an agent launch command", () => {
    const tracker = new ManualAgentTracker();
    tracker.observeInput("session-1", "claude\r");
    expect(tracker.shouldObserve("session-1")).toBe(false);
  });

  it("starts observing for codex after the first prompt submit even without alt-screen", () => {
    const tracker = new ManualAgentTracker();
    tracker.observeInput("session-1", "codex\n");
    expect(tracker.shouldObserve("session-1")).toBe(false);

    tracker.observeInput("session-1", "explain this repo\n");
    expect(tracker.shouldObserve("session-1")).toBe(true);
  });

  it("starts observing after alt-screen enter and a prompt submit", () => {
    const tracker = new ManualAgentTracker();
    tracker.observeInput(
      "session-1",
      "claude --dangerously-skip-permissions\n",
    );
    tracker.observeOutput("session-1", "\u001b[?1049h");
    expect(tracker.shouldObserve("session-1")).toBe(false);

    tracker.observeInput("session-1", "hello claude\n");
    expect(tracker.shouldObserve("session-1")).toBe(true);

    tracker.observeOutput("session-1", "\u001b[?1049l");
    expect(tracker.shouldObserve("session-1")).toBe(false);
  });

  it("stops observing after a turn-complete prompt and re-engages on next input", () => {
    const tracker = new ManualAgentTracker();
    tracker.observeInput("session-1", "claude\n");
    tracker.observeOutput("session-1", "\u001b[?1049h");
    tracker.observeInput("session-1", "hello\n");
    expect(tracker.shouldObserve("session-1")).toBe(true);

    tracker.observeOutput("session-1", "Done.\n\u001b[32m❯\u001b[0m ");
    expect(tracker.shouldObserve("session-1")).toBe(false);

    tracker.observeInput("session-1", "next turn\n");
    expect(tracker.shouldObserve("session-1")).toBe(true);
  });

  it("does not activate for ordinary shell commands", () => {
    const tracker = new ManualAgentTracker();
    tracker.observeInput("session-1", "ls -la\n");
    expect(tracker.shouldObserve("session-1")).toBe(false);
  });

  it("clears on ctrl-c", () => {
    const tracker = new ManualAgentTracker();
    tracker.observeInput("session-1", "claude\n");
    tracker.observeOutput("session-1", "\u001b[?1049h");
    tracker.observeInput("session-1", "hello\n");
    expect(tracker.shouldObserve("session-1")).toBe(true);

    tracker.observeInput("session-1", "\u0003");
    expect(tracker.shouldObserve("session-1")).toBe(false);
  });
});

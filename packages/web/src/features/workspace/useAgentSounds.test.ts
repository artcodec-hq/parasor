import type { AgentState } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { shouldPlayAgentSound } from "./useAgentSounds.js";

function makeState(
  overrides: Partial<AgentState> & Pick<AgentState, "lifecycle">,
): AgentState {
  return {
    sessionId: "session-1",
    lifecycle: overrides.lifecycle,
    source: overrides.source ?? "hook",
    confidence: overrides.confidence ?? "high",
    detectedAt: overrides.detectedAt ?? 1,
  };
}

describe("shouldPlayAgentSound", () => {
  it("plays attention sound only for high-confidence background waiting transitions", () => {
    expect(
      shouldPlayAgentSound({
        activeProjectId: "active",
        playAttentionSound: true,
        playCompletionSound: false,
        priorLifecycle: "running",
        projectId: "background",
        state: makeState({ lifecycle: "waiting" }),
      }),
    ).toBe("attention");
  });

  it("suppresses sound for the active project", () => {
    expect(
      shouldPlayAgentSound({
        activeProjectId: "project-1",
        playAttentionSound: true,
        playCompletionSound: true,
        priorLifecycle: "running",
        projectId: "project-1",
        state: makeState({ lifecycle: "waiting" }),
      }),
    ).toBeNull();
  });

  it("suppresses low-confidence waiting transitions", () => {
    expect(
      shouldPlayAgentSound({
        activeProjectId: "active",
        playAttentionSound: true,
        playCompletionSound: false,
        priorLifecycle: "running",
        projectId: "background",
        state: makeState({ lifecycle: "waiting", confidence: "medium" }),
      }),
    ).toBeNull();
  });

  it("plays completion sound when enabled", () => {
    expect(
      shouldPlayAgentSound({
        activeProjectId: null,
        playAttentionSound: false,
        playCompletionSound: true,
        priorLifecycle: "running",
        projectId: "background",
        state: makeState({ lifecycle: "completed" }),
      }),
    ).toBe("completion");
  });

  it("does not replay the same lifecycle transition", () => {
    expect(
      shouldPlayAgentSound({
        activeProjectId: null,
        playAttentionSound: true,
        playCompletionSound: true,
        priorLifecycle: "completed",
        projectId: "background",
        state: makeState({ lifecycle: "completed" }),
      }),
    ).toBeNull();
  });
});

import type { AgentState } from "@parasor/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  isAttentionDismissed,
  useAttentionDismissals,
} from "./useAttentionDismissals.js";

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    sessionId: overrides.sessionId ?? "s1",
    lifecycle: overrides.lifecycle ?? "waiting",
    source: overrides.source ?? "hook",
    confidence: overrides.confidence ?? "high",
    detectedAt: overrides.detectedAt ?? 1000,
  };
}

describe("isAttentionDismissed", () => {
  it("returns false when there is no agent state", () => {
    expect(isAttentionDismissed(undefined, { s1: 1000 })).toBe(false);
  });

  it("returns false when the lifecycle is not waiting", () => {
    expect(
      isAttentionDismissed(makeState({ lifecycle: "running" }), { s1: 1000 }),
    ).toBe(false);
  });

  it("returns false when no dismissal exists for the session", () => {
    expect(isAttentionDismissed(makeState(), {})).toBe(false);
  });

  it("returns true when a dismissal at the same detectedAt exists", () => {
    expect(
      isAttentionDismissed(makeState({ detectedAt: 1000 }), { s1: 1000 }),
    ).toBe(true);
  });

  it("returns true when an older dismissal still covers the current event", () => {
    // Stored timestamp >= state.detectedAt -- same waiting event still viewed.
    expect(
      isAttentionDismissed(makeState({ detectedAt: 1000 }), { s1: 1500 }),
    ).toBe(true);
  });

  it("returns false when the agent transitioned to a newer waiting event", () => {
    expect(
      isAttentionDismissed(makeState({ detectedAt: 2000 }), { s1: 1000 }),
    ).toBe(false);
  });
});

describe("useAttentionDismissals", () => {
  it("records the detectedAt for the focused session in waiting", () => {
    const states = { s1: makeState({ sessionId: "s1", detectedAt: 1000 }) };
    const { result } = renderHook(() =>
      useAttentionDismissals({
        focusedPaneId: "terminal:s1",
        agentStates: states,
      }),
    );
    expect(result.current).toEqual({ s1: 1000 });
  });

  it("prunes entries for sessions no longer in agentStates", () => {
    const initial: Record<string, AgentState> = {
      s1: makeState({ sessionId: "s1", detectedAt: 1000 }),
      s2: makeState({ sessionId: "s2", detectedAt: 1500 }),
    };
    const { result, rerender } = renderHook(
      ({ states, focused }) =>
        useAttentionDismissals({
          focusedPaneId: focused,
          agentStates: states,
        }),
      {
        initialProps: {
          states: initial,
          focused: "terminal:s1" as string | null,
        },
      },
    );
    expect(result.current.s1).toBe(1000);

    // Focus s2 to record it as well.
    rerender({ states: initial, focused: "terminal:s2" });
    expect(result.current).toEqual({ s1: 1000, s2: 1500 });

    // Server drops s1 (session deleted). Its dismissal should be pruned.
    act(() => {
      rerender({ states: { s2: initial.s2 }, focused: "terminal:s2" });
    });
    expect(result.current).toEqual({ s2: 1500 });
  });
});

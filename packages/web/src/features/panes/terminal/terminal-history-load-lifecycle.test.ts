import type { TerminalLastSeen } from "@parasor/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTerminalReplayCache,
  getTerminalReplayCache,
  setTerminalReplayCache,
} from "../../../lib/terminal-replay-cache.js";
import { useTerminalHistoryLoadLifecycle } from "./terminal-history-load-lifecycle.js";

function makeLastSeen(generation = 1): TerminalLastSeen {
  return {
    generation,
    seq: "10",
  };
}

function makeTerm(input?: {
  viewportY?: number;
  baseY?: number;
  cols?: number;
  rows?: number;
}) {
  return {
    cols: input?.cols ?? 80,
    rows: input?.rows ?? 24,
    buffer: {
      active: {
        viewportY: input?.viewportY ?? 0,
        baseY: input?.baseY ?? 0,
      },
    },
    scrollToBottom: vi.fn(),
    scrollToLine: vi.fn(),
  } as unknown as XTerm;
}

function renderHistoryHook(input?: {
  sessionId?: string;
  term?: XTerm | null;
  keyboardSettling?: boolean;
}) {
  const xtermRef = {
    current: input && "term" in input ? input.term : null,
  } as RefObject<XTerm | null>;
  return renderHook(
    ({ sessionId, keyboardSettling }) =>
      useTerminalHistoryLoadLifecycle({
        sessionId,
        xtermRef,
        keyboardSettling,
      }),
    {
      initialProps: {
        sessionId: input?.sessionId ?? "s1",
        keyboardSettling: input?.keyboardSettling ?? false,
      },
    },
  );
}

afterEach(() => {
  cleanup();
  clearTerminalReplayCache();
  vi.useRealTimers();
});

describe("useTerminalHistoryLoadLifecycle", () => {
  it("resolves initial lastSeen only when cached dimensions match", () => {
    const lastSeen = makeLastSeen();
    setTerminalReplayCache("s1", {
      data: "cached",
      lastSeen,
      cols: 80,
      rows: 24,
    });

    const { result } = renderHistoryHook({ sessionId: "s1" });

    expect(result.current.resolveInitialLastSeen({ cols: 80, rows: 24 })).toBe(
      lastSeen,
    );
    expect(
      result.current.resolveInitialLastSeen({ cols: 81, rows: 24 }),
    ).toBeNull();
  });

  it("tracks full replay restore state and stores the replay cache on completion", () => {
    const term = makeTerm({ viewportY: 7, baseY: 7 });
    const lastSeen = makeLastSeen(2);
    const onFullReplay = vi.fn();
    const { result } = renderHistoryHook({ sessionId: "s1", term });

    act(() => {
      result.current.startFullReplay(lastSeen, onFullReplay);
    });

    expect(onFullReplay).toHaveBeenCalledTimes(1);
    expect(result.current.isReplayRestoring).toBe(true);
    expect(result.current.replayRestoringRef.current).toBe(true);

    act(() => {
      result.current.handleReplayWriteComplete("replayed output", term);
    });

    expect(result.current.isReplayRestoring).toBe(false);
    expect(result.current.replayRestoringRef.current).toBe(false);
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(getTerminalReplayCache("s1")).toMatchObject({
      data: "replayed output",
      lastSeen,
      cols: 80,
      rows: 24,
    });
  });

  it("arms history load suppression when keyboard settling finishes", () => {
    const { result, rerender } = renderHistoryHook({
      keyboardSettling: true,
    });

    expect(result.current.keyboardHistoryLoadSuppressUntilRef.current).toBe(0);

    rerender({ sessionId: "s1", keyboardSettling: false });

    expect(
      result.current.keyboardHistoryLoadSuppressUntilRef.current,
    ).toBeGreaterThan(performance.now());
  });
});

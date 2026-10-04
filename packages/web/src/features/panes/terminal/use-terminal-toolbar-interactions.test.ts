import { act, cleanup, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import { useTerminalToolbarInteractions } from "./use-terminal-toolbar-interactions.js";

vi.mock("../../../lib/terminal-trace.js", () => ({
  traceTerminalEvent: vi.fn(),
}));

const mockTraceTerminalEvent = vi.mocked(traceTerminalEvent);

function renderToolbarHook(input?: {
  sessionId?: string;
  anchor?: { clientX: number; clientY: number } | null;
  setInputToolbarAnchor?: (anchor: null) => void;
}) {
  const inputToolbarAnchorRef = {
    current: input && "anchor" in input ? input.anchor : null,
  } as RefObject<{ clientX: number; clientY: number } | null>;
  return renderHook(() =>
    useTerminalToolbarInteractions({
      sessionId: input?.sessionId ?? "s1",
      inputToolbarAnchorRef,
      setInputToolbarAnchor: input?.setInputToolbarAnchor ?? vi.fn(),
    }),
  );
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  mockTraceTerminalEvent.mockReset();
});

describe("useTerminalToolbarInteractions", () => {
  it("traces toolbar actions and arms synthetic mouse suppression for non-deduped events", () => {
    const { result } = renderToolbarHook();

    act(() => {
      result.current.handleToolbarActionEvent({
        action: "copy",
        eventType: "pointerup",
        deduped: false,
      });
    });

    expect(
      result.current.toolbarSyntheticMouseSuppressUntilRef.current,
    ).toBeGreaterThan(performance.now());
    expect(mockTraceTerminalEvent).toHaveBeenCalledWith(
      "terminal-toolbar-action",
      {
        sessionId: "s1",
        surface: "copy",
        status: "pointerup",
        skipped: false,
      },
    );
  });

  it("does not arm synthetic mouse suppression for deduped events", () => {
    const { result } = renderToolbarHook();

    act(() => {
      result.current.handleToolbarActionEvent({
        action: "paste",
        eventType: "click",
        deduped: true,
      });
    });

    expect(result.current.toolbarSyntheticMouseSuppressUntilRef.current).toBe(
      0,
    );
    expect(mockTraceTerminalEvent).toHaveBeenCalledWith(
      "terminal-toolbar-action",
      {
        sessionId: "s1",
        surface: "paste",
        status: "click",
        skipped: true,
      },
    );
  });

  it("dismisses the toolbar through the shared dismiss lifecycle", () => {
    const setInputToolbarAnchor = vi.fn();
    renderToolbarHook({
      anchor: { clientX: 10, clientY: 20 },
      setInputToolbarAnchor,
    });

    act(() => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });

    expect(setInputToolbarAnchor).toHaveBeenCalledWith(null);
  });
});

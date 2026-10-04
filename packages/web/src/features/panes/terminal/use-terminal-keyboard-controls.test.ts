import { act, cleanup, renderHook } from "@testing-library/react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTerminalKeyboardControls } from "./use-terminal-keyboard-controls.js";

function makeTerminalRef() {
  const textarea = document.createElement("textarea");
  document.body.append(textarea);
  const term = {
    textarea,
    focus: vi.fn(() => textarea.focus()),
  } as unknown as XTerm;
  return {
    xtermRef: { current: term } as RefObject<XTerm | null>,
    textarea,
    term,
  };
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("useTerminalKeyboardControls", () => {
  it("keeps ctrl state mirrored to the sticky ref", () => {
    const { xtermRef } = makeTerminalRef();
    const { result } = renderHook(() =>
      useTerminalKeyboardControls({ kbHeight: 0, xtermRef }),
    );

    expect(result.current.ctrlActive).toBe(false);
    expect(result.current.ctrlStickyRef.current).toBe(false);

    act(() => {
      result.current.toggleCtrl();
    });

    expect(result.current.ctrlActive).toBe(true);
    expect(result.current.ctrlStickyRef.current).toBe(true);

    act(() => {
      result.current.setCtrl(false);
    });

    expect(result.current.ctrlActive).toBe(false);
    expect(result.current.ctrlStickyRef.current).toBe(false);
  });

  it("clears sticky ctrl when the keyboard closes", () => {
    const { xtermRef } = makeTerminalRef();
    const { result, rerender } = renderHook(
      ({ kbHeight }) => useTerminalKeyboardControls({ kbHeight, xtermRef }),
      { initialProps: { kbHeight: 320 } },
    );

    act(() => {
      result.current.setCtrl(true);
    });

    expect(result.current.ctrlStickyRef.current).toBe(true);

    rerender({ kbHeight: 0 });

    expect(result.current.ctrlActive).toBe(false);
    expect(result.current.ctrlStickyRef.current).toBe(false);
  });

  it("blurs focused textarea or focuses the terminal from the keyboard toggle", () => {
    const { xtermRef, textarea, term } = makeTerminalRef();
    const blur = vi.spyOn(textarea, "blur");
    const { result, rerender } = renderHook(
      ({ kbHeight }) => useTerminalKeyboardControls({ kbHeight, xtermRef }),
      { initialProps: { kbHeight: 0 } },
    );

    act(() => {
      result.current.handleKeyboardToggle();
    });

    expect(term.focus).toHaveBeenCalledTimes(1);

    textarea.focus();
    act(() => {
      result.current.handleKeyboardToggle();
    });

    expect(blur).toHaveBeenCalledTimes(1);

    rerender({ kbHeight: 320 });
    act(() => {
      result.current.handleKeyboardToggle();
    });

    expect(blur).toHaveBeenCalledTimes(2);
  });
});

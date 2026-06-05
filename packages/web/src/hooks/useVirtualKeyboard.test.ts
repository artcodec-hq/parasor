import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disableTerminalTrace,
  enableTerminalTrace,
} from "../lib/terminal-trace.js";
import { useVirtualKeyboard } from "./useVirtualKeyboard.js";

class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;

  fireResize(nextHeight: number, nextOffsetTop = 0) {
    this.height = nextHeight;
    this.offsetTop = nextOffsetTop;
    this.dispatchEvent(new Event("resize"));
  }

  fireScroll(nextHeight: number, nextOffsetTop = 0) {
    this.height = nextHeight;
    this.offsetTop = nextOffsetTop;
    this.dispatchEvent(new Event("scroll"));
  }

  silentlyUpdate(nextHeight: number, nextOffsetTop = 0) {
    this.height = nextHeight;
    this.offsetTop = nextOffsetTop;
  }
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
}

async function flushKeyboardFrame() {
  await act(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      }),
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
    writable: true,
  });
  setVisibility("visible");
  vi.stubGlobal("visualViewport", new FakeVisualViewport());
});

afterEach(() => {
  // Unmount any hooks rendered this test BEFORE restoring timers/globals.
  // Each renderHook spins up a React root; the effect cleanup cancels the
  // pending rAF (publish) and settle timeout. Without an explicit unmount a
  // queued React scheduler task can fire via setImmediate after the jsdom
  // window is torn down ("ReferenceError: window is not defined"). Most tests
  // here never call unmount(), so do it centrally and idempotently.
  cleanup();
  vi.useRealTimers();
  disableTerminalTrace();
  window.parasorTerminalTrace?.clear();
  vi.unstubAllGlobals();
});

describe("useVirtualKeyboard", () => {
  it("returns 0 when the virtual keyboard is closed", () => {
    const { result } = renderHook(() => useVirtualKeyboard());
    expect(result.current.height).toBe(0);
  });

  it("returns occluded height when visualViewport shrinks (keyboard opens)", async () => {
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const { result } = renderHook(() => useVirtualKeyboard());

    act(() => vv.fireResize(500, 0));
    await flushKeyboardFrame();
    // innerHeight(800) - vv.height(500) - offsetTop(0) = 300
    expect(result.current.height).toBe(300);
  });

  it("clamps tiny rounding deltas (<=1px) to 0", async () => {
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const { result } = renderHook(() => useVirtualKeyboard());

    // 800 - 799.5 - 0 = 0.5 -> treated as no keyboard
    act(() => vv.fireResize(799.5, 0));
    await flushKeyboardFrame();
    expect(result.current.height).toBe(0);
  });

  it("tracks offsetTop changes via scroll (iOS pan with keyboard open)", async () => {
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const { result } = renderHook(() => useVirtualKeyboard());

    // Keyboard visible, then user pans up so offsetTop grows.
    act(() => vv.fireResize(500, 0));
    await flushKeyboardFrame();
    expect(result.current.height).toBe(300);
    act(() => vv.fireScroll(500, 50));
    await flushKeyboardFrame();
    // 800 - 500 - 50 = 250
    expect(result.current.height).toBe(250);
  });

  it("coalesces multiple same-frame viewport events to the latest height", async () => {
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const { result } = renderHook(() => useVirtualKeyboard());

    act(() => {
      vv.fireResize(700, 0);
      vv.fireResize(600, 0);
      vv.fireScroll(500, 25);
    });
    await flushKeyboardFrame();

    // 800 - 500 - 25 = 275; intermediate heights must not publish.
    expect(result.current.height).toBe(275);
  });

  it("marks keyboard viewport changes as settling until the debounce expires", async () => {
    vi.useFakeTimers();
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const { result } = renderHook(() => useVirtualKeyboard());

    act(() => vv.fireResize(500, 0));
    expect(result.current.settling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(result.current.height).toBe(300);
    expect(result.current.settling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(103);
    });
    expect(result.current.settling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.settling).toBe(false);
    vi.useRealTimers();
  });

  it("extends keyboard settling when another viewport event arrives", () => {
    vi.useFakeTimers();
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const { result } = renderHook(() => useVirtualKeyboard());

    act(() => vv.fireResize(500, 0));
    act(() => {
      vi.advanceTimersByTime(80);
      vv.fireResize(450, 0);
      vi.advanceTimersByTime(119);
    });
    expect(result.current.settling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.settling).toBe(false);
    vi.useRealTimers();
  });

  it("records coalesced keyboard height trace metadata when tracing is enabled", async () => {
    enableTerminalTrace();
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    renderHook(() => useVirtualKeyboard());

    act(() => {
      vv.fireResize(650, 0);
      vv.fireResize(500, 0);
    });
    await flushKeyboardFrame();

    const trace = window.parasorTerminalTrace?.dump() ?? [];
    expect(trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "virtual-keyboard-viewport-event",
          height: 150,
          skipped: true,
        }),
        expect.objectContaining({
          type: "virtual-keyboard-height-change",
          height: 300,
          previousHeight: 0,
          durationMs: expect.any(Number),
        }),
      ]),
    );
  });

  it("re-reads occluded height on visibilitychange foreground (iOS stale-state)", async () => {
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const { result } = renderHook(() => useVirtualKeyboard());

    // Tab goes background; iOS may mutate vv silently while hidden.
    setVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    vv.silentlyUpdate(400, 0);
    // No resize event fired -- height should still be stale.
    expect(result.current.height).toBe(0);

    // Foreground return must force a fresh read even without resize.
    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushKeyboardFrame();
    expect(result.current.height).toBe(400);
  });

  it("ignores visibilitychange while still hidden", () => {
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const { result } = renderHook(() => useVirtualKeyboard());

    setVisibility("hidden");
    vv.silentlyUpdate(400, 0);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.height).toBe(0);
  });

  it("re-reads occluded height on window focus", async () => {
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const { result } = renderHook(() => useVirtualKeyboard());

    vv.silentlyUpdate(450, 0);
    expect(result.current.height).toBe(0);
    act(() => window.dispatchEvent(new Event("focus")));
    await flushKeyboardFrame();
    expect(result.current.height).toBe(350);
  });

  it("is a no-op when visualViewport is unavailable", () => {
    vi.stubGlobal("visualViewport", undefined);
    const { result } = renderHook(() => useVirtualKeyboard());
    expect(result.current.height).toBe(0);
  });

  it("removes all listeners on unmount", () => {
    const vv = window.visualViewport as unknown as FakeVisualViewport;
    const removeVvSpy = vi.spyOn(vv, "removeEventListener");
    const removeDocSpy = vi.spyOn(document, "removeEventListener");
    const removeWinSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useVirtualKeyboard());
    unmount();

    expect(removeVvSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeVvSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(removeDocSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(removeWinSpy).toHaveBeenCalledWith("focus", expect.any(Function));
  });
});

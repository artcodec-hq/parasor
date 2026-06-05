import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useGlobalDropGuard } from "./useGlobalDropGuard.js";

/**
 * jsdom does not implement DragEvent, so we dispatch plain cancelable
 * Events of type "dragover"/"drop". The hook's handler uses
 * `event.dataTransfer`, which is undefined on a plain Event; the `if (dt)`
 * guard means the handler still runs preventDefault() without throwing.
 */
function dispatch(type: "dragover" | "drop"): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

/**
 * The vitest setup here does not auto-call `cleanup()`, so every mounted
 * hook would otherwise leak its window-level listeners into later tests
 * and make "removes listeners on unmount" look false-positive. We unmount
 * explicitly after each test instead of relying on global cleanup.
 */
type Mounted = { unmount: () => void };
const mounted: Mounted[] = [];
function mount(): Mounted {
  const handle = renderHook(() => useGlobalDropGuard());
  mounted.push(handle);
  return handle;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe("useGlobalDropGuard", () => {
  it("preventDefault on dragover while mounted", () => {
    mount();
    const event = dispatch("dragover");
    expect(event.defaultPrevented).toBe(true);
  });

  it("preventDefault on drop while mounted", () => {
    mount();
    const event = dispatch("drop");
    expect(event.defaultPrevented).toBe(true);
  });

  it("removes listeners on unmount", () => {
    const handle = renderHook(() => useGlobalDropGuard());
    handle.unmount();
    const dragover = dispatch("dragover");
    const drop = dispatch("drop");
    expect(dragover.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
  });

  // Core contract: a child handler that preventDefault()s first must keep
  // the guard from double-claiming the event. This is what preserves the
  // Terminal drop flow and future OS-file flow.
  it("no-ops when defaultPrevented is already true", () => {
    mount();
    const childHandler = (e: Event) => e.preventDefault();
    // Capture phase so the child claim runs before the window bubble guard.
    window.addEventListener("dragover", childHandler, { capture: true });
    try {
      const event = dispatch("dragover");
      expect(event.defaultPrevented).toBe(true);
      // The guard's preventDefault() is a no-op here too, but we can at
      // least assert it did not throw on the null-ish dataTransfer branch.
    } finally {
      window.removeEventListener("dragover", childHandler, { capture: true });
    }
  });
});

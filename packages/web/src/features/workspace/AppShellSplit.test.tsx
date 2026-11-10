import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShellSplit } from "./AppShellSplit.js";

const STORAGE_KEY = "parasor:shell-ratio:workspace";

function resetStoredSplitRatio() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage may be unavailable in the test runtime. */
  }
}

beforeEach(() => {
  resetStoredSplitRatio();
});

afterEach(() => {
  cleanup();
  resetStoredSplitRatio();
});

function renderSplit() {
  render(<AppShellSplit navigation={<div>Nav</div>} main={<div>Main</div>} />);
  const handle = screen.getByRole("separator", {
    name: "Resize navigation pane",
  });
  const container = handle.parentElement?.parentElement as HTMLDivElement;
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    bottom: 500,
    height: 500,
    left: 0,
    right: 1000,
    toJSON: () => ({}),
    top: 0,
    width: 1000,
    x: 0,
    y: 0,
  });
  return handle;
}

describe("AppShellSplit", () => {
  it("supports pointer resizing with split-style handle", () => {
    const handle = renderSplit();

    expect(handle.parentElement?.className).toContain("w-px");
    expect(handle.className).toContain("absolute");
    expect(handle.className).toContain("w-2");
    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(handle, {
      buttons: 1,
      clientX: 400,
      pointerId: 1,
    });

    expect(handle.getAttribute("aria-valuenow")).toBe("40");
  });

  it("supports keyboard resizing", () => {
    const handle = renderSplit();

    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(handle.getAttribute("aria-valuenow")).toBe("25");
  });
});

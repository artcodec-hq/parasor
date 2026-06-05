import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Split2Col } from "./Split2Col.js";

afterEach(() => cleanup());

function renderSplit() {
  render(
    <Split2Col
      storageKey="test"
      defaultRatio={[50, 50]}
      primary={<div>Primary</div>}
      secondary={<div>Secondary</div>}
      isMobile={false}
    />,
  );
  const handle = screen.getByRole("separator");
  const container = handle.parentElement as HTMLDivElement;
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
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  return handle;
}

describe("Split2Col", () => {
  it("keeps split resize behavior while exposing a wider invisible hit area", () => {
    const handle = renderSplit();

    expect(handle.className).toContain("before:-inset-x-3");
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, {
      buttons: 1,
      clientX: 700,
      pointerId: 1,
    });

    expect(handle.getAttribute("aria-valuenow")).toBe("70");
  });
});

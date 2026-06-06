import { describe, expect, it } from "vitest";
import {
  resolveTuiSwipeScrollStep,
  tuiSwipeArrowKeyInput,
} from "./terminal-touch-gestures.js";

describe("resolveTuiSwipeScrollStep", () => {
  it("does not emit a step below one cell of movement", () => {
    expect(
      resolveTuiSwipeScrollStep({
        accumulatedDeltaY: 18,
        cellHeight: 20,
      }),
    ).toBeNull();
  });

  it("maps finger down to wheel up", () => {
    expect(
      resolveTuiSwipeScrollStep({
        accumulatedDeltaY: 45,
        cellHeight: 20,
      }),
    ).toEqual({ direction: "up", steps: 2, remainingDeltaY: 5 });
  });

  it("maps finger up to wheel down", () => {
    expect(
      resolveTuiSwipeScrollStep({
        accumulatedDeltaY: -45,
        cellHeight: 20,
      }),
    ).toEqual({ direction: "down", steps: 2, remainingDeltaY: -5 });
  });

  it("bounds the number of steps per touch event", () => {
    expect(
      resolveTuiSwipeScrollStep({
        accumulatedDeltaY: 1000,
        cellHeight: 20,
      })?.steps,
    ).toBe(8);
  });
});

describe("tuiSwipeArrowKeyInput", () => {
  it("maps upward TUI scroll to plain Up", () => {
    expect(
      tuiSwipeArrowKeyInput({
        direction: "up",
        steps: 2,
        applicationCursorKeysMode: false,
      }),
    ).toBe("\x1b[A\x1b[A");
  });

  it("maps downward TUI scroll to application-cursor Down", () => {
    expect(
      tuiSwipeArrowKeyInput({
        direction: "down",
        steps: 3,
        applicationCursorKeysMode: true,
      }),
    ).toBe("\x1bOB\x1bOB\x1bOB");
  });
});

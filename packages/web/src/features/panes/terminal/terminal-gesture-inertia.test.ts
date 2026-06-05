import { describe, expect, it } from "vitest";
import {
  shouldSuppressCoordinateLessGesture,
  XTERM_GESTURE_CHANGE_EVENT,
} from "./terminal-gesture-inertia.js";

function gestureEvent(coords?: {
  clientX?: unknown;
  clientY?: unknown;
}): Event {
  const event = new Event(XTERM_GESTURE_CHANGE_EVENT);
  if (coords) Object.assign(event, coords);
  return event;
}

describe("shouldSuppressCoordinateLessGesture", () => {
  it("does not suppress finite-coord events while tracking is active", () => {
    expect(
      shouldSuppressCoordinateLessGesture(
        gestureEvent({ clientX: 10, clientY: 20 }),
        "vt200",
      ),
    ).toBe(false);
  });

  it("suppresses coordinate-less events while tracking is active", () => {
    expect(shouldSuppressCoordinateLessGesture(gestureEvent(), "vt200")).toBe(
      true,
    );
  });

  it("does not suppress coordinate-less events when tracking is off", () => {
    expect(shouldSuppressCoordinateLessGesture(gestureEvent(), "none")).toBe(
      false,
    );
  });

  it("does not suppress finite-coord events when tracking is off", () => {
    expect(
      shouldSuppressCoordinateLessGesture(
        gestureEvent({ clientX: 10, clientY: 20 }),
        "none",
      ),
    ).toBe(false);
  });

  it("treats NaN / Infinity coords as coordinate-less", () => {
    expect(
      shouldSuppressCoordinateLessGesture(
        gestureEvent({ clientX: Number.NaN, clientY: 5 }),
        "any",
      ),
    ).toBe(true);
    expect(
      shouldSuppressCoordinateLessGesture(
        gestureEvent({ clientX: 5, clientY: Number.POSITIVE_INFINITY }),
        "any",
      ),
    ).toBe(true);
  });

  it("treats non-number coords as coordinate-less", () => {
    expect(
      shouldSuppressCoordinateLessGesture(
        gestureEvent({ clientX: "10", clientY: "20" }),
        "drag",
      ),
    ).toBe(true);
  });

  it("treats a missing single axis as coordinate-less", () => {
    expect(
      shouldSuppressCoordinateLessGesture(gestureEvent({ clientX: 10 }), "x10"),
    ).toBe(true);
  });
});

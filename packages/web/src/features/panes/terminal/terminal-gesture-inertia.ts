/**
 * xterm touch-inertia gesture suppression.
 *
 * xterm 6.1 beta drives touch-scroll inertia with internal
 * `-xterm-gesturechange` events whose ticks carry no client coords. In a
 * mouse-tracking app the mouse reporter would convert them into SGR pixel
 * reports with literal `NaN` coords, corrupting the PTY stream -- so they must
 * be stopped, but only while tracking is active. With tracking off the same
 * events are what drive the inertia and must pass through unchanged.
 */

export const XTERM_GESTURE_CHANGE_EVENT = "-xterm-gesturechange";

function hasFiniteClientCoords(event: Event): boolean {
  const e = event as Event & { clientX?: unknown; clientY?: unknown };
  return (
    typeof e.clientX === "number" &&
    typeof e.clientY === "number" &&
    Number.isFinite(e.clientX) &&
    Number.isFinite(e.clientY)
  );
}

/**
 * Whether a coordinate-less inertia gesture should be suppressed
 * (`stopImmediatePropagation`) before it reaches xterm's mouse reporter.
 *
 * Suppress only when the event lacks finite client coords AND mouse-tracking is
 * active; otherwise let it pass through to drive touch-scroll inertia.
 */
export function shouldSuppressCoordinateLessGesture(
  event: Event,
  mouseTrackingMode: string,
): boolean {
  return !hasFiniteClientCoords(event) && mouseTrackingMode !== "none";
}

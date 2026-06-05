import { useEffect } from "react";

const EDGE_PX = 16;
const MIN_DRAG_X_PX = 24;
const MAX_DRAG_Y_PX = 40;

/**
 * Edge-swipe back gesture. The leading 16px vertical stripe of the viewport
 * owns the gesture: a horizontal drag of ≥24px right (with vertical drift
 * ≤40px) commits a back navigation.
 *
 * Mirrors iOS interactive pop so users don't have to reach for the top-left
 * back chevron. No-op when `onBack` is null/undefined or when the user is
 * mid-multi-touch (system gestures take precedence).
 */
export function useEdgeSwipeBack(onBack: (() => void) | null | undefined) {
  useEffect(() => {
    if (!onBack) return;
    let start: { x: number; y: number } | null = null;
    let armed = false;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) {
        start = null;
        armed = false;
        return;
      }
      const t = e.touches[0];
      if (t.clientX > EDGE_PX) {
        start = null;
        armed = false;
        return;
      }
      start = { x: t.clientX, y: t.clientY };
      armed = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!armed || !start) return;
      // System gestures (pinch / two-finger) take precedence -- disarm so the
      // ensuing touchend cannot resolve as a back swipe.
      if (e.touches.length !== 1) {
        armed = false;
        start = null;
        return;
      }
      const t = e.touches[0];
      const dy = Math.abs(t.clientY - start.y);
      if (dy > MAX_DRAG_Y_PX) {
        armed = false;
        start = null;
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!armed || !start) {
        armed = false;
        start = null;
        return;
      }
      const t = e.changedTouches[0];
      const dx = t ? t.clientX - start.x : 0;
      const dy = t ? Math.abs(t.clientY - start.y) : 0;
      armed = false;
      start = null;
      if (dx >= MIN_DRAG_X_PX && dy <= MAX_DRAG_Y_PX) {
        onBack?.();
      }
    }

    function onTouchCancel() {
      armed = false;
      start = null;
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [onBack]);
}

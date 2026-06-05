import { useEffect, useRef, useState } from "react";
import { traceTerminalEvent } from "../lib/terminal-trace.js";

const KEYBOARD_SETTLE_DELAY_MS = 120;

/**
 * Tracks the on-screen (virtual) keyboard occlusion via `visualViewport`.
 * `height` is the number of CSS pixels the keyboard currently covers at the
 * bottom of the layout viewport -- zero when no keyboard is open. Used to
 * float mobile UI (key bar, toolbars) directly above the keyboard.
 *
 * iOS Safari: the layout viewport stays full-height and the visual viewport
 * shrinks from the bottom. Android Chrome behaves the same by default.
 * We also listen to `scroll` because iOS updates `offsetTop` while the
 * user pans with the keyboard open.
 */
export function useVirtualKeyboard(): {
  height: number;
  settling: boolean;
} {
  const [height, setHeight] = useState(0);
  const [settling, setSettling] = useState(false);
  const heightRef = useRef(0);
  const pendingHeightRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const frameScheduledAtRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const publish = () => {
      frameRef.current = null;
      const next = pendingHeightRef.current;
      const previous = heightRef.current;
      const durationMs = performance.now() - frameScheduledAtRef.current;
      if (next === previous) {
        traceTerminalEvent("virtual-keyboard-height-skip", {
          height: next,
          previousHeight: previous,
          durationMs,
          reason: "unchanged",
        });
        return;
      }
      heightRef.current = next;
      traceTerminalEvent("virtual-keyboard-height-change", {
        height: next,
        previousHeight: previous,
        durationMs,
      });
      setHeight(next);
    };

    const clearSettleTimer = () => {
      if (settleTimerRef.current === null) return;
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    };

    const scheduleSettle = () => {
      setSettling(true);
      clearSettleTimer();
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        if (typeof window === "undefined") return;
        setSettling(false);
        traceTerminalEvent("virtual-keyboard-settled", {
          height: heightRef.current,
          delayMs: KEYBOARD_SETTLE_DELAY_MS,
        });
      }, KEYBOARD_SETTLE_DELAY_MS);
    };

    const update = (settle: boolean) => {
      const occluded = window.innerHeight - vv.height - vv.offsetTop;
      const next = occluded > 1 ? Math.round(occluded) : 0;
      pendingHeightRef.current = next;
      if (settle) scheduleSettle();
      traceTerminalEvent("virtual-keyboard-viewport-event", {
        height: next,
        previousHeight: heightRef.current,
        settling: settle,
        skipped: frameRef.current !== null,
      });
      if (frameRef.current !== null) return;
      frameScheduledAtRef.current = performance.now();
      frameRef.current = window.requestAnimationFrame(publish);
    };

    update(false);
    const onViewportEvent = () => update(true);
    vv.addEventListener("resize", onViewportEvent);
    vv.addEventListener("scroll", onViewportEvent);
    /*
     * iOS Safari (especially in PWAs / iframes) does not always emit a
     * `visualViewport.resize` when the tab returns from background. The
     * occluded-height read can be left at a stale value from before the
     * background dip, so floating UI (key bar) lands in the wrong place
     * and `keyboardOpen` reports the wrong state until the next manual
     * focus toggle. Re-running `update()` on visibility/focus return
     * forces a fresh read so the layout settles in one frame.
     */
    const onForeground = () => {
      if (document.visibilityState !== "visible") return;
      update(true);
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      vv.removeEventListener("resize", onViewportEvent);
      vv.removeEventListener("scroll", onViewportEvent);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      clearSettleTimer();
    };
  }, []);

  return { height, settling };
}

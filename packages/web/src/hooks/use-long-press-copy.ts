import { useCallback, useEffect, useRef, useState } from "react";
import { showCopyToast } from "../lib/copy-toast.js";

const LONG_PRESS_MS = 350;
const MOVE_TOLERANCE_PX = 5;

export interface LongPressCopyHandlers {
  onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
  /** Whether the press has crossed the long-press threshold (visual ghost). */
  armed: boolean;
}

/**
 * Long-press to copy a monospace value.
 * After 350ms hold the element enters an "armed" state (caller dims via the
 * `armed` flag); on release the value is copied via the async clipboard API
 * and a one-line toast confirms via `showCopyToast`. Movement >5px cancels.
 *
 * Pure touch -- desktop hover/tooltip uses the native `title` attribute.
 */
export function useLongPressCopy(
  value: string | null | undefined,
  label?: string,
): LongPressCopyHandlers {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
    armedRef.current = false;
    setArmed(false);
  }, []);

  useEffect(() => () => reset(), [reset]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (!value) return;
      const t = e.touches[0];
      if (!t) return;
      // Multi-touch or rapid re-press would otherwise stack timers and arm
      // mid-pinch -- clear any pending arm timer before starting fresh.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (e.touches.length > 1) {
        startRef.current = null;
        armedRef.current = false;
        setArmed(false);
        return;
      }
      startRef.current = { x: t.clientX, y: t.clientY };
      armedRef.current = false;
      setArmed(false);
      timerRef.current = setTimeout(() => {
        armedRef.current = true;
        setArmed(true);
      }, LONG_PRESS_MS);
    },
    [value],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) reset();
    },
    [reset],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (!armedRef.current || !value) {
        reset();
        return;
      }
      e.preventDefault();
      reset();
      void copyValue(value, label);
    },
    [reset, value, label],
  );

  const onTouchCancel = useCallback(() => {
    reset();
  }, [reset]);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, armed };
}

async function copyValue(value: string, label?: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showCopyToast(label ? `Copied ${label}` : "Copied");
  } catch {
    showCopyToast("Copy failed");
  }
}

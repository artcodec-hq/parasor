import type { KeyboardEvent, PointerEvent } from "react";
import { useCallback, useRef } from "react";
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_MIN,
  sidebarWidthMax,
} from "../../lib/sidebar-width.js";

interface UseSidebarResizeOptions {
  resizable: boolean;
  width: number;
  onWidthChange?: (width: number) => void;
}

export function useSidebarResize({
  resizable,
  width,
  onWidthChange,
}: UseSidebarResizeOptions) {
  const asideRef = useRef<HTMLElement>(null);
  const resizingRef = useRef(false);
  const fixedWidth = Number.isFinite(width) ? Math.round(width) : 288;
  const effectiveWidth = resizable ? clampSidebarWidth(width) : fixedWidth;
  const effectiveMaxWidth = sidebarWidthMax();
  const showResizeHandle = resizable && Boolean(onWidthChange);

  const updateWidthFromClientX = useCallback(
    (clientX: number) => {
      const rect = asideRef.current?.getBoundingClientRect();
      if (!rect) return;
      onWidthChange?.(clampSidebarWidth(clientX - rect.left));
    },
    [onWidthChange],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLHRElement>) => {
      if (!onWidthChange) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      resizingRef.current = true;
      updateWidthFromClientX(event.clientX);
    },
    [onWidthChange, updateWidthFromClientX],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLHRElement>) => {
      if (!resizingRef.current) return;
      if (event.buttons === 0) {
        resizingRef.current = false;
        return;
      }
      updateWidthFromClientX(event.clientX);
    },
    [updateWidthFromClientX],
  );

  const onPointerUp = useCallback((event: PointerEvent<HTMLHRElement>) => {
    resizingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLHRElement>) => {
      if (!onWidthChange) return;
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      event.preventDefault();
      if (event.key === "Home") {
        onWidthChange(SIDEBAR_WIDTH_MIN);
        return;
      }
      if (event.key === "End") {
        onWidthChange(sidebarWidthMax());
        return;
      }
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const step = event.shiftKey ? 48 : 16;
      onWidthChange(clampSidebarWidth(effectiveWidth + direction * step));
    },
    [effectiveWidth, onWidthChange],
  );

  return {
    asideRef,
    effectiveMaxWidth,
    effectiveWidth,
    showResizeHandle,
    resizeHandleProps: {
      onKeyDown,
      onPointerCancel: onPointerUp,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
  };
}

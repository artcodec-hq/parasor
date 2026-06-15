import type { Terminal as XTerm } from "@xterm/xterm";
import { findFilePathHitAtBufferCell } from "./terminal-file-links.js";
import {
  shouldSuppressCoordinateLessGesture,
  XTERM_GESTURE_CHANGE_EVENT,
} from "./terminal-gesture-inertia.js";
import {
  applyTouchSelection,
  findTouchById,
  getSelectionPointFromTouch,
  isPointInsideSelection,
  isTerminalInputPoint,
  selectWordAt,
  type TouchSelectionPoint,
} from "./terminal-touch-selection.js";
import { type LinkCellHit, urlAtCell } from "./terminal-url-detect.js";

const TOUCH_SELECTION_LONG_PRESS_MS = 450;
const TOUCH_SELECTION_SLOP_PX = 10;
const TAP_MAX_GAP_MS = 300;
const TAP_MAX_DURATION_MS = 400;
const TAP_POSITION_SLOP_PX = 24;
const URL_TAP_HIGHLIGHT_MS = 650;
const TAP_MOVE_SLOP_PX = 10;
const MOUSE_TRACKING_TOUCH_WHEEL_SLOP_PX = 10;

export interface TerminalTapGestureOptions {
  term: XTerm;
  /** The terminal pane container that owns the tap-to-focus listeners. */
  container: HTMLElement;
  /** The `.xterm-screen` element the coordinate-less gesture guard attaches to. */
  screenElement: Element | null;
}

/**
 * Tap-to-focus and the coordinate-less xterm gesture guard, extracted verbatim
 * from the xterm mount effect. Tap-to-focus defers from touchstart to touchend
 * so scroll / pane-swipe gestures don't raise the soft keyboard mid-gesture; a
 * tap is promoted to focus only when single-finger, within slop, with no active
 * selection, and the tap lands on the live input row. Normal terminal output
 * taps stay read-only on mobile, including mouse-tracking TUIs, so browsing
 * history does not raise the soft keyboard. The gesture guard drops inertial
 * xterm scroll events that carry no coordinates while a mouse-tracking app owns
 * the screen. Returns a cleanup that removes both.
 */
export function attachTerminalTapGestures({
  term,
  container,
  screenElement,
}: TerminalTapGestureOptions): () => void {
  let tapState: {
    startX: number;
    startY: number;
    startedAt: number;
    moved: boolean;
    multi: boolean;
  } | null = null;
  const onTapTouchStart = (event: Event) => {
    const te = event as TouchEvent;
    if (te.touches.length > 1) {
      if (tapState) tapState.multi = true;
      return;
    }
    const t = te.touches[0];
    if (!t) return;
    tapState = {
      startX: t.clientX,
      startY: t.clientY,
      startedAt: performance.now(),
      moved: false,
      multi: false,
    };
  };
  const onTapTouchMove = (event: Event) => {
    if (!tapState || tapState.moved) return;
    const te = event as TouchEvent;
    const t = te.touches[0];
    if (!t) return;
    const dx = t.clientX - tapState.startX;
    const dy = t.clientY - tapState.startY;
    if (Math.hypot(dx, dy) > TAP_MOVE_SLOP_PX) tapState.moved = true;
  };
  const onTapTouchEnd = (event: Event) => {
    const state = tapState;
    tapState = null;
    if (!state || state.moved || state.multi) return;
    const te = event as TouchEvent;
    if (te.touches.length > 0) return;
    if (performance.now() - state.startedAt > TAP_MAX_DURATION_MS) return;
    if (term.hasSelection()) return;
    const touch = te.changedTouches[0];
    const point =
      touch && screenElement
        ? getSelectionPointFromTouch(term, screenElement, touch)
        : null;
    if (point && isTerminalInputPoint(term, point)) {
      term.focus();
    }
  };
  const onTapTouchCancel = () => {
    tapState = null;
  };
  container.addEventListener("touchstart", onTapTouchStart, {
    passive: true,
  });
  container.addEventListener("touchmove", onTapTouchMove, {
    passive: true,
  });
  container.addEventListener("touchend", onTapTouchEnd, { passive: true });
  container.addEventListener("touchcancel", onTapTouchCancel, {
    passive: true,
  });
  const onCoordinateLessXtermGesture = (event: Event) => {
    if (
      shouldSuppressCoordinateLessGesture(event, term.modes.mouseTrackingMode)
    ) {
      event.stopImmediatePropagation();
    }
  };
  screenElement?.addEventListener(
    XTERM_GESTURE_CHANGE_EVENT,
    onCoordinateLessXtermGesture,
    { capture: true },
  );

  return () => {
    container.removeEventListener("touchstart", onTapTouchStart);
    container.removeEventListener("touchmove", onTapTouchMove);
    container.removeEventListener("touchend", onTapTouchEnd);
    container.removeEventListener("touchcancel", onTapTouchCancel);
    screenElement?.removeEventListener(
      XTERM_GESTURE_CHANGE_EVENT,
      onCoordinateLessXtermGesture,
      { capture: true },
    );
  };
}

export interface TerminalTouchWheelOptions {
  term: XTerm;
  /** The `.xterm-screen` element that receives xterm mouse/wheel gestures. */
  screenElement: Element | null;
}

/**
 * Mobile browsers deliver swipes to xterm as touch gestures. When a full-screen
 * TUI owns mouse tracking, that path becomes drag/click reports, while
 * mouse-aware scroll regions expect wheel-style input. After a vertical swipe
 * crosses slop, stop the native touch move and let xterm's existing wheel
 * encoder emit the app's active mouse protocol.
 */
export function attachTerminalTouchWheel({
  term,
  screenElement,
}: TerminalTouchWheelOptions): () => void {
  let touchState: {
    id: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    active: boolean;
    cancelled: boolean;
  } | null = null;

  const reset = () => {
    touchState = null;
  };

  const isMouseTrackingActive = () => term.modes.mouseTrackingMode !== "none";

  const dispatchWheel = (touch: Touch, deltaX: number, deltaY: number) => {
    screenElement?.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaX,
        deltaY,
      }),
    );
  };

  const onTouchStart = (event: Event) => {
    if (!screenElement || !isMouseTrackingActive()) {
      reset();
      return;
    }
    const touchEvent = event as TouchEvent;
    if (touchEvent.touches.length !== 1) {
      reset();
      return;
    }
    const touch = touchEvent.touches[0];
    touchState = {
      id: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      active: false,
      cancelled: false,
    };
  };

  const onTouchMove = (event: Event) => {
    if (!screenElement || !touchState || touchState.cancelled) return;
    if (!isMouseTrackingActive()) {
      reset();
      return;
    }
    const touchEvent = event as TouchEvent;
    const touch = findTouchById(touchEvent.touches, touchState.id);
    if (!touch) {
      reset();
      return;
    }

    const totalDx = touch.clientX - touchState.startX;
    const totalDy = touch.clientY - touchState.startY;
    if (!touchState.active) {
      if (Math.hypot(totalDx, totalDy) <= MOUSE_TRACKING_TOUCH_WHEEL_SLOP_PX) {
        return;
      }
      if (Math.abs(totalDy) < Math.abs(totalDx)) {
        touchState.cancelled = true;
        return;
      }
      touchState.active = true;
    }

    const deltaX = touchState.lastX - touch.clientX;
    const deltaY = touchState.lastY - touch.clientY;
    touchState.lastX = touch.clientX;
    touchState.lastY = touch.clientY;
    if (deltaX === 0 && deltaY === 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    dispatchWheel(touch, deltaX, deltaY);
  };

  screenElement?.addEventListener("touchstart", onTouchStart, {
    capture: true,
    passive: true,
  });
  screenElement?.addEventListener("touchmove", onTouchMove, {
    capture: true,
    passive: false,
  });
  screenElement?.addEventListener("touchend", reset, {
    capture: true,
    passive: true,
  });
  screenElement?.addEventListener("touchcancel", reset, {
    capture: true,
    passive: true,
  });

  return () => {
    reset();
    screenElement?.removeEventListener("touchstart", onTouchStart, {
      capture: true,
    });
    screenElement?.removeEventListener("touchmove", onTouchMove, {
      capture: true,
    });
    screenElement?.removeEventListener("touchend", reset, {
      capture: true,
    });
    screenElement?.removeEventListener("touchcancel", reset, {
      capture: true,
    });
  };
}

export interface TerminalTouchSelectionOptions {
  term: XTerm;
  /** The `.xterm-screen` element gesture listeners attach to. */
  screenElement: Element | null;
  /** Open a tapped http(s) URL (loopback-aware routing lives in the caller). */
  openUrl: (url: string) => void;
  /** Open a tapped worktree-relative file path. */
  openFilePath: (filePath: string) => void;
  /** Latest worktree path, read lazily so the listener sees ref updates. */
  getWorktreePath: () => string | undefined;
  /** Called when a highlight auto-clears so the caller can drop its copy UI. */
  onSelectionCleared: () => void;
  /** Show a paste-only toolbar for the live terminal input row. */
  onInputToolbarRequest?: (input: { clientX: number; clientY: number }) => void;
  /** Commit a touch-owned terminal selection and show selection overlay. */
  onSelectionCommit?: (input: {
    clientX: number;
    clientY: number;
    showToolbar: boolean;
  }) => void;
}

/**
 * Touch text-selection + tap-to-open gestures for the terminal screen,
 * extracted verbatim from the xterm mount effect. Owns long-press drag-select,
 * 2/3-tap word/line selection, and single-tap URL/file-path opening (with the
 * one-shot synthetic-click suppressor that keeps a link tap from re-firing the
 * browser's mouse sequence). Returns a cleanup that removes every listener and
 * clears every pending timer.
 */
export function attachTerminalTouchSelection({
  term,
  screenElement,
  openUrl,
  openFilePath,
  getWorktreePath,
  onSelectionCleared,
  onInputToolbarRequest,
  onSelectionCommit,
}: TerminalTouchSelectionOptions): () => void {
  let selectionTimer: number | null = null;
  let selectionTouchId: number | null = null;
  let selectionStartTouch: { x: number; y: number } | null = null;
  let selectionAnchor: TouchSelectionPoint | null = null;
  let selectionStartedInsideSelection = false;
  let selectionStartedInInput = false;
  let selectionActive = false;
  let tapCount = 0;
  let lastTapTime = 0;
  let lastTapPoint: { x: number; y: number } | null = null;
  let activeSelectionDragListeners = false;
  let suppressTouchLinkClick = false;
  let suppressTouchLinkClickTimer: number | null = null;
  let selectionClearRefreshFrame: number | null = null;
  const passiveTouchOptions = { capture: true, passive: true } as const;
  const activeTouchOptions = { capture: true, passive: false } as const;

  function enableActiveSelectionDrag() {
    if (!screenElement || activeSelectionDragListeners) return;
    activeSelectionDragListeners = true;
    screenElement.addEventListener(
      "touchmove",
      onActiveSelectionTouchMove,
      activeTouchOptions,
    );
    screenElement.addEventListener(
      "touchend",
      onActiveSelectionTouchEnd,
      activeTouchOptions,
    );
    screenElement.addEventListener(
      "touchcancel",
      onActiveSelectionTouchEnd,
      activeTouchOptions,
    );
  }

  function disableActiveSelectionDrag() {
    if (!screenElement || !activeSelectionDragListeners) return;
    screenElement.removeEventListener(
      "touchmove",
      onActiveSelectionTouchMove,
      activeTouchOptions,
    );
    screenElement.removeEventListener(
      "touchend",
      onActiveSelectionTouchEnd,
      activeTouchOptions,
    );
    screenElement.removeEventListener(
      "touchcancel",
      onActiveSelectionTouchEnd,
      activeTouchOptions,
    );
    activeSelectionDragListeners = false;
  }
  let linkHighlightTimer: number | null = null;

  function armTouchLinkClickSuppressor() {
    suppressTouchLinkClick = true;
    if (suppressTouchLinkClickTimer !== null) {
      clearTimeout(suppressTouchLinkClickTimer);
    }
    suppressTouchLinkClickTimer = window.setTimeout(() => {
      suppressTouchLinkClick = false;
      suppressTouchLinkClickTimer = null;
    }, URL_TAP_HIGHLIGHT_MS);
  }

  const onTouchLinkSyntheticClick = (event: Event) => {
    if (!suppressTouchLinkClick) return;
    suppressTouchLinkClick = false;
    if (suppressTouchLinkClickTimer !== null) {
      clearTimeout(suppressTouchLinkClickTimer);
      suppressTouchLinkClickTimer = null;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const clearSelectionTimer = () => {
    if (selectionTimer !== null) {
      clearTimeout(selectionTimer);
      selectionTimer = null;
    }
  };
  const clearTerminalSelection = () => {
    term.clearSelection();
    if (selectionClearRefreshFrame !== null) {
      cancelAnimationFrame(selectionClearRefreshFrame);
    }
    selectionClearRefreshFrame = requestAnimationFrame(() => {
      selectionClearRefreshFrame = null;
      term.refresh(0, Math.max(0, term.rows - 1));
    });
    onSelectionCleared();
  };
  const resetTouchSelection = () => {
    clearSelectionTimer();
    selectionTouchId = null;
    selectionStartTouch = null;
    selectionAnchor = null;
    selectionStartedInsideSelection = false;
    selectionStartedInInput = false;
    selectionActive = false;
    disableActiveSelectionDrag();
  };
  const highlightLinkTap = (hit: LinkCellHit, row: number) => {
    if (linkHighlightTimer !== null) {
      clearTimeout(linkHighlightTimer);
      linkHighlightTimer = null;
    }
    term.select(hit.startCol, row, hit.length);
    linkHighlightTimer = window.setTimeout(() => {
      linkHighlightTimer = null;
      clearTerminalSelection();
    }, URL_TAP_HIGHLIGHT_MS);
  };
  const onSelectionTouchStart = (event: Event) => {
    if (!screenElement) return;
    if (term.modes.mouseTrackingMode !== "none") {
      resetTouchSelection();
      return;
    }
    const touchEvent = event as TouchEvent;
    if (touchEvent.touches.length !== 1) {
      resetTouchSelection();
      return;
    }
    const touch = touchEvent.touches[0];
    const point = getSelectionPointFromTouch(term, screenElement, touch);
    if (!point) return;
    selectionStartedInsideSelection =
      term.hasSelection() && isPointInsideSelection(term, point);
    selectionStartedInInput =
      !selectionStartedInsideSelection && isTerminalInputPoint(term, point);
    clearSelectionTimer();
    selectionTouchId = touch.identifier;
    selectionStartTouch = { x: touch.clientX, y: touch.clientY };
    selectionTimer = window.setTimeout(() => {
      selectionTimer = null;
      if (selectionStartedInsideSelection) {
        if (term.modes.mouseTrackingMode === "none") {
          onSelectionCommit?.({
            clientX: touch.clientX,
            clientY: touch.clientY,
            showToolbar: true,
          });
        }
        resetTouchSelection();
        return;
      }
      if (selectionStartedInInput) {
        if (term.hasSelection()) {
          clearTerminalSelection();
        }
        if (term.modes.mouseTrackingMode === "none") {
          onInputToolbarRequest?.({
            clientX: touch.clientX,
            clientY: touch.clientY,
          });
        }
        resetTouchSelection();
        return;
      }
      if (term.hasSelection()) {
        clearTerminalSelection();
      }
      selectionActive = true;
      selectionAnchor = point;
      term.select(point.col, point.row, 1);
      enableActiveSelectionDrag();
    }, TOUCH_SELECTION_LONG_PRESS_MS);
  };
  const onSelectionTouchMove = (event: Event) => {
    if (!screenElement) return;
    const touchEvent = event as TouchEvent;
    const touch = findTouchById(touchEvent.touches, selectionTouchId);
    if (!touch) return;

    if (!selectionActive) {
      if (!selectionStartTouch) return;
      const dx = touch.clientX - selectionStartTouch.x;
      const dy = touch.clientY - selectionStartTouch.y;
      if (Math.hypot(dx, dy) > TOUCH_SELECTION_SLOP_PX) {
        resetTouchSelection();
      }
      return;
    }

    // Active drag is handled by a temporary non-passive listener so the
    // ordinary swipe path can stay passive until long-press actually wins.
  };
  function onActiveSelectionTouchMove(event: Event) {
    if (!screenElement || !selectionActive) return;
    const touchEvent = event as TouchEvent;
    const touch = findTouchById(touchEvent.touches, selectionTouchId);
    if (!touch) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const focus = getSelectionPointFromTouch(term, screenElement, touch);
    if (!selectionAnchor || !focus) return;
    applyTouchSelection(term, selectionAnchor, focus);
  }
  function onActiveSelectionTouchEnd(event: Event) {
    if (!selectionActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const touchEvent = event as TouchEvent;
    const touch = touchEvent.changedTouches[0] ?? touchEvent.touches[0];
    if (
      touch &&
      term.modes.mouseTrackingMode === "none" &&
      term.getSelection().length > 0
    ) {
      onSelectionCommit?.({
        clientX: touch.clientX,
        clientY: touch.clientY,
        showToolbar: true,
      });
    }
    resetTouchSelection();
  }
  const onSelectionTouchEnd = (event: Event) => {
    if (selectionActive) return;
    if (selectionStartedInsideSelection) {
      resetTouchSelection();
      return;
    }
    if (selectionStartedInInput) {
      if (term.hasSelection()) {
        clearTerminalSelection();
      }
      if (screenElement && selectionStartTouch && selectionTimer !== null) {
        const touchEvent = event as TouchEvent;
        const touch = touchEvent.changedTouches[0];
        if (touch && term.modes.mouseTrackingMode === "none") {
          onInputToolbarRequest?.({
            clientX: touch.clientX,
            clientY: touch.clientY,
          });
        }
      }
      resetTouchSelection();
      return;
    }
    // Long-press did not fire and drag slop was not exceeded -> plain tap.
    if (screenElement && selectionStartTouch && selectionTimer !== null) {
      const touchEvent = event as TouchEvent;
      const touch = touchEvent.changedTouches[0];
      if (touch) {
        const point = getSelectionPointFromTouch(term, screenElement, touch);
        // A plain tap on a visible http(s) URL opens it -- the touch
        // counterpart of the mouse path's web-links click. It takes
        // priority over tap-to-focus and the soft keyboard:
        // `touchend` stays passive for scroll performance, so we arm a
        // one-shot capture-phase click suppressor to drop the browser's
        // synthetic mouse/click sequence (which would otherwise re-open
        // the link and raise the keyboard via xterm's MouseService).
        // `stopImmediatePropagation` still stops the container's
        // tap-to-focus handler. Skipped while a mouse-tracking app owns
        // the screen, where a tap belongs to the app, not link detection.
        if (point && term.modes.mouseTrackingMode === "none") {
          const line = term.buffer.active.getLine(point.row);
          const hit = line ? urlAtCell(line, point.col) : null;
          if (hit) {
            event.stopImmediatePropagation();
            armTouchLinkClickSuppressor();
            highlightLinkTap(hit, point.row);
            openUrl(hit.url);
            tapCount = 0;
            resetTouchSelection();
            return;
          }
          const worktreePath = getWorktreePath();
          const fileHit = worktreePath
            ? findFilePathHitAtBufferCell(
                (lineNumber) => term.buffer.active.getLine(lineNumber - 1),
                worktreePath,
                point.row + 1,
                point.col,
              )
            : null;
          if (fileHit) {
            event.stopImmediatePropagation();
            armTouchLinkClickSuppressor();
            highlightLinkTap(fileHit, point.row);
            openFilePath(fileHit.filePath);
            tapCount = 0;
            resetTouchSelection();
            return;
          }
        }
        // Not a URL -- count consecutive taps within gap/slop to promote
        // the tap to a word (2) / line (3) selection.
        const now = performance.now();
        const withinGap = now - lastTapTime <= TAP_MAX_GAP_MS;
        const withinPos =
          lastTapPoint !== null &&
          Math.hypot(
            touch.clientX - lastTapPoint.x,
            touch.clientY - lastTapPoint.y,
          ) <= TAP_POSITION_SLOP_PX;
        tapCount = withinGap && withinPos ? tapCount + 1 : 1;
        lastTapTime = now;
        lastTapPoint = { x: touch.clientX, y: touch.clientY };
        let committedTapSelection = false;
        if (point) {
          if (tapCount === 2) {
            if (selectWordAt(term, point)) {
              onSelectionCommit?.({
                clientX: touch.clientX,
                clientY: touch.clientY,
                showToolbar: true,
              });
              committedTapSelection = true;
            } else {
              tapCount = 0;
            }
          } else if (tapCount >= 3) {
            term.selectLines(point.row, point.row);
            onSelectionCommit?.({
              clientX: touch.clientX,
              clientY: touch.clientY,
              showToolbar: true,
            });
            tapCount = 0;
            committedTapSelection = true;
          }
        }
        if (!committedTapSelection && term.hasSelection()) {
          clearTerminalSelection();
          tapCount = 0;
        }
      }
    }
    resetTouchSelection();
  };
  screenElement?.addEventListener("touchstart", onSelectionTouchStart, {
    capture: true,
    passive: true,
  });
  screenElement?.addEventListener(
    "touchmove",
    onSelectionTouchMove,
    passiveTouchOptions,
  );
  screenElement?.addEventListener(
    "touchend",
    onSelectionTouchEnd,
    passiveTouchOptions,
  );
  screenElement?.addEventListener(
    "touchcancel",
    onSelectionTouchEnd,
    passiveTouchOptions,
  );
  screenElement?.addEventListener("click", onTouchLinkSyntheticClick, {
    capture: true,
  });

  return () => {
    resetTouchSelection();
    if (suppressTouchLinkClickTimer !== null) {
      clearTimeout(suppressTouchLinkClickTimer);
      suppressTouchLinkClickTimer = null;
    }
    screenElement?.removeEventListener(
      "touchstart",
      onSelectionTouchStart,
      passiveTouchOptions,
    );
    screenElement?.removeEventListener(
      "touchmove",
      onSelectionTouchMove,
      passiveTouchOptions,
    );
    screenElement?.removeEventListener(
      "touchend",
      onSelectionTouchEnd,
      passiveTouchOptions,
    );
    screenElement?.removeEventListener(
      "touchcancel",
      onSelectionTouchEnd,
      passiveTouchOptions,
    );
    screenElement?.removeEventListener("click", onTouchLinkSyntheticClick, {
      capture: true,
    });
    if (linkHighlightTimer !== null) {
      clearTimeout(linkHighlightTimer);
      linkHighlightTimer = null;
    }
    if (selectionClearRefreshFrame !== null) {
      cancelAnimationFrame(selectionClearRefreshFrame);
      selectionClearRefreshFrame = null;
    }
  };
}

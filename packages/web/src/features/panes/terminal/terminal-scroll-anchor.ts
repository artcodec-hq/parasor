/**
 * Single source of truth for terminal scroll-position restore. Before the scroll-anchor module
 * three call sites (resize, full-replay restore, history-load restore) each
 * inlined the same `baseAfter - baseBefore + viewportBefore` formula, so a fix
 * to one drifted from the others. They all funnel through here now.
 *
 * The formula assumes a row-count-preserving change (keyboard open/close, tab
 * switch). A column change reflows the scrollback and shifts `baseY`
 * non-linearly, so the anchor is an approximation there -- callers that reflow
 * still get a best-effort restore, never a silent jump to an unrelated line.
 */
export interface ScrollAnchor {
  viewportY: number;
  baseY: number;
  /** Viewport was pinned to the live tail when captured. */
  wasAtBottom: boolean;
}

/** Minimal xterm surface this module touches -- kept structural for testing. */
export interface ScrollableTerminal {
  buffer: { active: { viewportY: number; baseY: number } };
  scrollToBottom(): void;
  scrollToLine(line: number): void;
}

export type ScrollRestoreReason =
  | "was-at-bottom"
  | "anchor-changed"
  | "viewport-stable";

export interface ScrollRestoreResult {
  reason: ScrollRestoreReason;
  targetViewportY: number;
}

export function captureScrollAnchor(term: ScrollableTerminal): ScrollAnchor {
  const buffer = term.buffer.active;
  return {
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    wasAtBottom: buffer.viewportY === buffer.baseY,
  };
}

/**
 * The line the viewport should land on after the buffer changed, clamped to
 * the new scrollback range. Pure -- the scroll math lives here so it can be
 * unit-tested without an xterm instance.
 */
export function resolveAnchoredViewportY(
  anchor: Pick<ScrollAnchor, "viewportY" | "baseY">,
  baseAfter: number,
): number {
  return Math.max(
    0,
    Math.min(baseAfter, baseAfter - anchor.baseY + anchor.viewportY),
  );
}

/**
 * Re-pin the viewport after a buffer change. A tail-pinned anchor follows the
 * tail; otherwise the viewport is moved to the anchored line only when it
 * actually drifted (so a stable viewport is left untouched). Returns the
 * outcome so callers can emit their own trace event.
 */
export function restoreScrollAnchor(
  term: ScrollableTerminal,
  anchor: ScrollAnchor,
): ScrollRestoreResult {
  if (anchor.wasAtBottom) {
    term.scrollToBottom();
    return {
      reason: "was-at-bottom",
      targetViewportY: term.buffer.active.baseY,
    };
  }
  const targetViewportY = resolveAnchoredViewportY(
    anchor,
    term.buffer.active.baseY,
  );
  if (term.buffer.active.viewportY !== targetViewportY) {
    term.scrollToLine(targetViewportY);
    return { reason: "anchor-changed", targetViewportY };
  }
  return { reason: "viewport-stable", targetViewportY };
}

import type { Terminal as XTerm } from "@xterm/xterm";
import type {
  OverlayPoint,
  TerminalSelectionHandle,
} from "./TerminalSelectionOverlay.js";
import type { TerminalSelectionRange } from "./terminal-touch-selection.js";

export type SelectionOverlayState = {
  range: TerminalSelectionRange;
  toolbarAnchor: { clientX: number; clientY: number } | null;
  draggingHandle: TerminalSelectionHandle | null;
};

export type SelectionOverlayLayout = {
  startHandle: OverlayPoint | null;
  endHandle: OverlayPoint | null;
  toolbar: OverlayPoint | null;
};

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function pointToOverlayPosition(
  rangePoint: { col: number; row: number },
  term: XTerm,
  screenElement: Element,
  rootElement: HTMLElement,
): OverlayPoint | null {
  const screenRect = screenElement.getBoundingClientRect();
  const rootRect = rootElement.getBoundingClientRect();
  if (screenRect.width <= 0 || screenRect.height <= 0) return null;
  const cellWidth = screenRect.width / term.cols;
  const cellHeight = screenRect.height / term.rows;
  const viewportRow = rangePoint.row - term.buffer.active.viewportY;
  if (viewportRow < 0 || viewportRow >= term.rows) return null;
  const localLeft =
    screenRect.left - rootRect.left + rangePoint.col * cellWidth;
  const localTop =
    screenRect.top - rootRect.top + (viewportRow + 1) * cellHeight;
  return {
    left: clampNumber(localLeft, 0, rootRect.width),
    top: clampNumber(localTop, 0, rootRect.height),
  };
}

export function toolbarPositionFromAnchor(
  anchor: { clientX: number; clientY: number },
  rootElement: HTMLElement,
  toolbarWidth = 132,
): OverlayPoint {
  const rootRect = rootElement.getBoundingClientRect();
  const toolbarHeight = 40;
  const gap = 12;
  const padding = 8;
  const localX = anchor.clientX - rootRect.left;
  const localY = anchor.clientY - rootRect.top;
  const above = localY - toolbarHeight - gap;
  const below = localY + gap;

  return {
    left: clampNumber(
      localX - toolbarWidth / 2,
      padding,
      rootRect.width - toolbarWidth - padding,
    ),
    top: clampNumber(
      above >= padding ? above : below,
      padding,
      rootRect.height - toolbarHeight - padding,
    ),
  };
}

export function resolveSelectionOverlayLayout({
  term,
  rootElement,
  screenElement,
  overlay,
  hasSelection,
}: {
  term: XTerm | null;
  rootElement: HTMLElement | null;
  screenElement: Element | null;
  overlay: SelectionOverlayState | null;
  hasSelection: boolean;
}): SelectionOverlayLayout | null {
  if (!term || !rootElement || !screenElement || !overlay || !hasSelection) {
    return null;
  }
  return {
    startHandle: pointToOverlayPosition(
      overlay.range.start,
      term,
      screenElement,
      rootElement,
    ),
    endHandle: pointToOverlayPosition(
      overlay.range.end,
      term,
      screenElement,
      rootElement,
    ),
    toolbar:
      overlay.toolbarAnchor && !overlay.draggingHandle
        ? toolbarPositionFromAnchor(overlay.toolbarAnchor, rootElement, 72)
        : null,
  };
}

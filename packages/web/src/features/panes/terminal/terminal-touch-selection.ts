import type { IBufferLine, Terminal as XTerm } from "@xterm/xterm";

export interface TouchSelectionPoint {
  col: number;
  row: number;
}

export interface TerminalSelectionRange {
  start: TouchSelectionPoint;
  /**
   * Exclusive end boundary. This matches xterm's internal selection service:
   * selecting columns 0..4 reports start col 0 and end col 5.
   */
  end: TouchSelectionPoint;
}

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: "grapheme" | "word" | "sentence" },
) => {
  segment(input: string): Iterable<{
    segment: string;
    index: number;
    isWordLike?: boolean;
  }>;
};

type LineCellTextMap = {
  text: string;
  cellOffsets: number[];
  cellWidths: number[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Map a touch's viewport coordinates to a buffer cell ({@link TouchSelectionPoint}),
 * or `null` when the screen element has no layout box yet. The column is
 * clamped to `[0, cols]` and the row to the visible viewport, then offset by
 * `viewportY` so the point addresses the scrollback-absolute buffer row.
 */
export function getSelectionPointFromTouch(
  term: XTerm,
  screenElement: Element,
  touch: Pick<Touch, "clientX" | "clientY">,
): TouchSelectionPoint | null {
  const rect = screenElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const col = clamp(
    Math.floor(((touch.clientX - rect.left) / rect.width) * term.cols),
    0,
    term.cols,
  );
  const viewportRow = clamp(
    Math.floor(((touch.clientY - rect.top) / rect.height) * term.rows),
    0,
    Math.max(term.rows - 1, 0),
  );
  return {
    col,
    row: term.buffer.active.viewportY + viewportRow,
  };
}

export function getSelectionPointFromHandleDrag(
  term: XTerm,
  screenElement: Element,
  point: Pick<Touch, "clientX" | "clientY">,
): TouchSelectionPoint | null {
  const rect = screenElement.getBoundingClientRect();
  if (rect.height <= 0 || term.rows <= 0) return null;
  const cellHeight = rect.height / term.rows;
  return getSelectionPointFromTouch(term, screenElement, {
    clientX: point.clientX,
    clientY: point.clientY - cellHeight * 0.75,
  });
}

export function isTerminalInputPoint(
  term: XTerm,
  point: TouchSelectionPoint,
): boolean {
  if (!term.modes.showCursor) return false;
  const buffer = term.buffer.active;
  return point.row >= buffer.baseY + buffer.cursorY;
}

/**
 * Select the inclusive range between an anchor and focus cell, flattening the
 * two `(row, col)` points to linear indices so the selection stays correct
 * regardless of drag direction.
 */
export function applyTouchSelection(
  term: XTerm,
  anchor: TouchSelectionPoint,
  focus: TouchSelectionPoint,
): void {
  const cols = term.cols;
  const anchorIndex = anchor.row * cols + anchor.col;
  const focusIndex = focus.row * cols + focus.col;
  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);
  const startRow = Math.floor(startIndex / cols);
  const startCol = startIndex % cols;
  term.select(startCol, startRow, Math.max(1, endIndex - startIndex + 1));
}

function pointIndex(point: TouchSelectionPoint, cols: number): number {
  return point.row * cols + point.col;
}

function pointFromIndex(index: number, cols: number): TouchSelectionPoint {
  return {
    row: Math.floor(index / cols),
    col: index % cols,
  };
}

function buildLineCellTextMap(line: IBufferLine): LineCellTextMap | null {
  const getCell = line.getCell?.bind(line);
  if (getCell && typeof line.length === "number") {
    const cell = getCell(0);
    if (!cell) return null;
    let text = "";
    const cellOffsets = new Array<number>(line.length);
    const cellWidths = new Array<number>(line.length);
    for (let col = 0; col < line.length; col += 1) {
      getCell(col, cell);
      const width = cell.getWidth();
      cellWidths[col] = width;
      if (width === 0) {
        cellOffsets[col] = col > 0 ? cellOffsets[col - 1] : text.length;
        continue;
      }
      cellOffsets[col] = text.length;
      const chars = cell.getChars();
      text += chars.length > 0 ? chars : " ";
    }
    return { text, cellOffsets, cellWidths };
  }

  const text = line.translateToString(false);
  return {
    text,
    cellOffsets: Array.from({ length: text.length }, (_, index) => index),
    cellWidths: Array.from({ length: text.length }, () => 1),
  };
}

function getIntlWordSegment(text: string, offset: number) {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor })
    .Segmenter;
  if (!Segmenter) return null;
  const segmenter = new Segmenter(undefined, { granularity: "word" });
  for (const segment of segmenter.segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    if (offset < start || offset >= end) continue;
    if (segment.isWordLike === false || /^\s+$/u.test(segment.segment)) {
      return null;
    }
    return { startOffset: start, endOffset: end };
  }
  return null;
}

function getWhitespaceWordSegment(text: string, offset: number) {
  const isWord = (ch: string) => ch !== "" && !/\s/u.test(ch);
  if (!isWord(text[offset] ?? "")) return null;
  let startOffset = offset;
  let endOffset = offset + 1;
  while (startOffset > 0 && isWord(text[startOffset - 1] ?? "")) {
    startOffset -= 1;
  }
  while (endOffset < text.length && isWord(text[endOffset] ?? "")) {
    endOffset += 1;
  }
  return { startOffset, endOffset };
}

function segmentOffsetsToCellRange(
  map: LineCellTextMap,
  startOffset: number,
  endOffset: number,
): { startCol: number; length: number } | null {
  let startCol = -1;
  let endExclusiveCol = -1;
  for (let col = 0; col < map.cellOffsets.length; col += 1) {
    const width = map.cellWidths[col] ?? 1;
    if (width === 0) continue;
    const offset = map.cellOffsets[col];
    if (startCol === -1 && offset >= startOffset) {
      startCol = col;
    }
    if (offset < endOffset) {
      endExclusiveCol = col + Math.max(1, width);
    }
  }
  if (startCol === -1 || endExclusiveCol <= startCol) return null;
  return { startCol, length: endExclusiveCol - startCol };
}

function normalizeBoundaryRange(
  cols: number,
  anchor: TouchSelectionPoint,
  focus: TouchSelectionPoint,
): TerminalSelectionRange {
  const anchorIndex = pointIndex(anchor, cols);
  const focusIndex = pointIndex(focus, cols);
  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);
  if (startIndex === endIndex) {
    return {
      start: pointFromIndex(startIndex, cols),
      end: pointFromIndex(startIndex + 1, cols),
    };
  }
  return {
    start: pointFromIndex(startIndex, cols),
    end: pointFromIndex(endIndex, cols),
  };
}

/**
 * Apply a selection using boundary points, returning the normalized range that
 * was requested. This is used by draggable selection handles, where the fixed
 * endpoint and moving endpoint are both caret-like boundaries.
 */
export function applyBoundarySelection(
  term: XTerm,
  anchor: TouchSelectionPoint,
  focus: TouchSelectionPoint,
): TerminalSelectionRange {
  const range = normalizeBoundaryRange(term.cols, anchor, focus);
  const startIndex = pointIndex(range.start, term.cols);
  const endIndex = pointIndex(range.end, term.cols);
  term.select(
    range.start.col,
    range.start.row,
    Math.max(1, endIndex - startIndex),
  );
  return range;
}

export function getTerminalSelectionRange(
  term: XTerm,
): TerminalSelectionRange | null {
  const range = term.getSelectionPosition();
  if (!range) return null;
  return normalizeBoundaryRange(
    term.cols,
    { col: range.start.x, row: range.start.y },
    { col: range.end.x, row: range.end.y },
  );
}

/**
 * Check whether a buffer cell point lands inside xterm's current selection.
 */
export function isPointInsideSelection(
  term: XTerm,
  point: TouchSelectionPoint,
): boolean {
  const range = getTerminalSelectionRange(term);
  if (!range) return false;
  const cols = term.cols;
  const index = pointIndex(point, cols);
  return (
    index >= pointIndex(range.start, cols) &&
    index < pointIndex(range.end, cols)
  );
}

/**
 * Word-select the text under `point`, returning `false` when the tapped cell is
 * blank or off-buffer. Prefer the browser's word segmenter so Japanese/CJK
 * boundaries can follow platform language rules; fall back to a cell-aware
 * non-whitespace run when `Intl.Segmenter` is unavailable.
 */
export function selectWordAt(term: XTerm, point: TouchSelectionPoint): boolean {
  const line = term.buffer.active.getLine(point.row);
  if (!line) return false;
  const map = buildLineCellTextMap(line);
  if (!map) return false;
  const offset = map.cellOffsets[point.col];
  if (offset === undefined || offset < 0 || offset >= map.text.length) {
    return false;
  }
  const segment =
    getIntlWordSegment(map.text, offset) ??
    getWhitespaceWordSegment(map.text, offset);
  if (!segment) return false;
  const cellRange = segmentOffsetsToCellRange(
    map,
    segment.startOffset,
    segment.endOffset,
  );
  if (!cellRange) return false;
  term.select(cellRange.startCol, point.row, cellRange.length);
  return true;
}

/**
 * Find the active selection touch by identifier across a multi-touch
 * `TouchList`, falling back to the first touch when no id is tracked yet.
 */
export function findTouchById(
  touches: TouchList,
  id: number | null,
): Touch | null {
  if (id === null) return touches[0] ?? null;
  for (let i = 0; i < touches.length; i++) {
    const touch = touches.item(i);
    if (touch?.identifier === id) return touch;
  }
  return null;
}

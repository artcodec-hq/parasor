import type { IBufferCell, Terminal as XTerm } from "@xterm/xterm";

export type TerminalCellAttributeTrace = {
  fgMode: number;
  fg: number;
  bgMode: number;
  bg: number;
  bold: boolean;
  italic: boolean;
  dim: boolean;
  underline: boolean;
  inverse: boolean;
};

export type TerminalCellAttributeRunTrace = {
  start: number;
  end: number;
  attrs: TerminalCellAttributeTrace;
};

export type TerminalRowTrace = {
  line: number;
  viewportRow: number;
  isWrapped: boolean;
  text: string;
  attrRuns: TerminalCellAttributeRunTrace[];
};

export type TerminalRendererTrace = {
  requestedWebgl: boolean;
  effectiveRenderer: "webgl" | "dom";
  webglStatus: "pending" | "attached" | "disabled" | "failed" | "context-lost";
  webglFailureReason?: string;
  contextLossCount: number;
  fontLoadingDoneCount: number;
  atlasRebuildCount: number;
  iosFontPrefetchStatus: "not-ios" | "pending" | "loaded" | "failed";
  unicodeVersion: string;
  isTouch: boolean;
  isIos: boolean;
  fontFamily: string;
  fontSize: number;
};

export type TerminalBottomRowsTrace = {
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
  viewportY: number;
  baseY: number;
  bufferType: string;
  rowCount: number;
  rowsSampled: TerminalRowTrace[];
  renderer?: TerminalRendererTrace;
};

export function terminalBufferTrace(term: XTerm): Record<string, unknown> {
  const buffer = term.buffer.active;
  return {
    cols: term.cols,
    rows: term.rows,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    bufferType: buffer.type,
  };
}

function cellAttributes(cell: IBufferCell): TerminalCellAttributeTrace {
  return {
    fgMode: cell.getFgColorMode(),
    fg: cell.getFgColor(),
    bgMode: cell.getBgColorMode(),
    bg: cell.getBgColor(),
    bold: Boolean(cell.isBold()),
    italic: Boolean(cell.isItalic()),
    dim: Boolean(cell.isDim()),
    underline: Boolean(cell.isUnderline()),
    inverse: Boolean(cell.isInverse()),
  };
}

function sameCellAttributes(
  a: TerminalCellAttributeTrace,
  b: TerminalCellAttributeTrace,
): boolean {
  return (
    a.fgMode === b.fgMode &&
    a.fg === b.fg &&
    a.bgMode === b.bgMode &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.dim === b.dim &&
    a.underline === b.underline &&
    a.inverse === b.inverse
  );
}

export function terminalBottomRowsTrace(
  term: XTerm,
  requestedRowCount = 8,
  renderer?: TerminalRendererTrace,
): TerminalBottomRowsTrace {
  const buffer = term.buffer.active;
  const safeRequestedRowCount = Number.isFinite(requestedRowCount)
    ? requestedRowCount
    : 8;
  const rowCount = Math.max(
    1,
    Math.min(term.rows, Math.floor(safeRequestedRowCount)),
  );
  const startViewportRow = Math.max(0, term.rows - rowCount);
  const rowsSampled: TerminalRowTrace[] = [];

  for (
    let viewportRow = startViewportRow;
    viewportRow < term.rows;
    viewportRow++
  ) {
    const lineNumber = buffer.viewportY + viewportRow;
    const line = buffer.getLine(lineNumber);
    if (!line) {
      rowsSampled.push({
        line: lineNumber,
        viewportRow,
        isWrapped: false,
        text: "",
        attrRuns: [],
      });
      continue;
    }

    const attrRuns: TerminalCellAttributeRunTrace[] = [];
    for (let col = 0; col < term.cols; col++) {
      const cell = line.getCell(col);
      if (!cell) continue;
      const attrs = cellAttributes(cell);
      const previous = attrRuns.at(-1);
      if (previous && sameCellAttributes(previous.attrs, attrs)) {
        previous.end = col + 1;
      } else {
        attrRuns.push({ start: col, end: col + 1, attrs });
      }
    }

    rowsSampled.push({
      line: lineNumber,
      viewportRow,
      isWrapped: line.isWrapped,
      text: line.translateToString(false, 0, term.cols),
      attrRuns,
    });
  }

  const snapshot: TerminalBottomRowsTrace = {
    cols: term.cols,
    rows: term.rows,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    bufferType: buffer.type,
    rowCount,
    rowsSampled,
  };
  if (renderer) snapshot.renderer = { ...renderer };
  return snapshot;
}

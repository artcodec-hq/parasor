import { describe, expect, it, vi } from "vitest";
import {
  applyBoundarySelection,
  applyTouchSelection,
  findTouchById,
  getSelectionPointFromHandleDrag,
  getSelectionPointFromTouch,
  getTerminalSelectionRange,
  isPointInsideSelection,
  isTerminalInputPoint,
  selectWordAt,
} from "./terminal-touch-selection.js";

// A 800x480 screen mapping to an 80x24 grid -> 10px per column, 20px per row.
function makeScreen(
  rect: Partial<DOMRect> = { left: 0, top: 0, width: 800, height: 480 },
): unknown {
  return { getBoundingClientRect: () => rect };
}

type MockCellSpec = { chars: string; width: number };

function cellsFromText(text: string): MockCellSpec[] {
  return Array.from(text).map((chars) => ({ chars, width: 1 }));
}

function makeBufferLine(cells: MockCellSpec[]): unknown {
  return {
    length: cells.length,
    getCell(x: number, cell?: Record<string, unknown>) {
      const spec = cells[x];
      if (!spec) return undefined;
      const target = cell ?? {};
      target.getChars = () => spec.chars;
      target.getWidth = () => spec.width;
      return target;
    },
    translateToString: () => cells.map((cell) => cell.chars).join(""),
  };
}

function makeTerm(opts: {
  cols?: number;
  rows?: number;
  viewportY?: number;
  baseY?: number;
  cursorY?: number;
  showCursor?: boolean;
  line?: string | null | unknown;
  select?: ReturnType<typeof vi.fn>;
  selectionPosition?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
}): unknown {
  const {
    cols = 80,
    rows = 24,
    viewportY = 0,
    baseY = viewportY,
    cursorY = 0,
    showCursor = true,
    line,
    select = vi.fn(),
    selectionPosition,
  } = opts;
  return {
    cols,
    rows,
    select,
    getSelectionPosition: () => selectionPosition,
    buffer: {
      active: {
        viewportY,
        baseY,
        cursorY,
        getLine: (_row: number) => {
          if (line == null) return undefined;
          if (typeof line === "string") {
            return { translateToString: () => line };
          }
          return line;
        },
      },
    },
    modes: { showCursor },
  };
}

function makeTouchList(touches: Partial<Touch>[]): TouchList {
  const list: Record<string | number, unknown> = {
    length: touches.length,
    item: (i: number) => (touches[i] ?? null) as Touch | null,
  };
  touches.forEach((touch, i) => {
    list[i] = touch;
  });
  return list as unknown as TouchList;
}

describe("getSelectionPointFromTouch", () => {
  it("maps a touch to a viewportY-offset buffer cell", () => {
    const term = makeTerm({ cols: 80, rows: 24, viewportY: 100 });
    const point = getSelectionPointFromTouch(
      term as never,
      makeScreen() as never,
      { clientX: 105, clientY: 45 },
    );
    expect(point).toEqual({ col: 10, row: 102 });
  });

  it("returns null when the screen element has no layout box", () => {
    const term = makeTerm({});
    expect(
      getSelectionPointFromTouch(
        term as never,
        makeScreen({ left: 0, top: 0, width: 0, height: 0 }) as never,
        { clientX: 10, clientY: 10 },
      ),
    ).toBeNull();
  });

  it("clamps coordinates past the grid edges", () => {
    const term = makeTerm({ cols: 80, rows: 24, viewportY: 5 });
    expect(
      getSelectionPointFromTouch(term as never, makeScreen() as never, {
        clientX: 100000,
        clientY: 100000,
      }),
    ).toEqual({ col: 80, row: 5 + 23 });
    expect(
      getSelectionPointFromTouch(term as never, makeScreen() as never, {
        clientX: -50,
        clientY: -50,
      }),
    ).toEqual({ col: 0, row: 5 });
  });
});

describe("getSelectionPointFromHandleDrag", () => {
  it("biases handle drags upward so the handle center still maps to its text row", () => {
    const term = makeTerm({ cols: 80, rows: 24, viewportY: 5 });
    const point = getSelectionPointFromHandleDrag(
      term as never,
      makeScreen({ left: 0, top: 0, width: 800, height: 240 }) as never,
      { clientX: 160, clientY: 34 },
    );

    expect(point).toEqual({ col: 16, row: 7 });
  });
});

describe("isTerminalInputPoint", () => {
  it("treats the cursor row and rows below it as terminal input space", () => {
    const term = makeTerm({ baseY: 5, cursorY: 2 });

    expect(isTerminalInputPoint(term as never, { row: 6, col: 0 })).toBe(false);
    expect(isTerminalInputPoint(term as never, { row: 7, col: 0 })).toBe(true);
    expect(isTerminalInputPoint(term as never, { row: 8, col: 0 })).toBe(true);
  });

  it("does not expose input space when the terminal cursor is hidden", () => {
    const term = makeTerm({ baseY: 5, cursorY: 2, showCursor: false });

    expect(isTerminalInputPoint(term as never, { row: 7, col: 0 })).toBe(false);
  });
});

describe("applyTouchSelection", () => {
  it("selects the inclusive range between anchor and focus", () => {
    const select = vi.fn();
    const term = makeTerm({ cols: 80, select });
    applyTouchSelection(term as never, { row: 2, col: 5 }, { row: 2, col: 10 });
    expect(select).toHaveBeenCalledWith(5, 2, 6);
  });

  it("is independent of drag direction", () => {
    const select = vi.fn();
    const term = makeTerm({ cols: 80, select });
    applyTouchSelection(term as never, { row: 2, col: 10 }, { row: 2, col: 5 });
    expect(select).toHaveBeenCalledWith(5, 2, 6);
  });

  it("selects a single cell when anchor equals focus", () => {
    const select = vi.fn();
    const term = makeTerm({ cols: 80, select });
    applyTouchSelection(term as never, { row: 3, col: 7 }, { row: 3, col: 7 });
    expect(select).toHaveBeenCalledWith(7, 3, 1);
  });

  it("spans a row boundary", () => {
    const select = vi.fn();
    const term = makeTerm({ cols: 80, select });
    applyTouchSelection(term as never, { row: 0, col: 79 }, { row: 1, col: 0 });
    expect(select).toHaveBeenCalledWith(79, 0, 2);
  });
});

describe("applyBoundarySelection", () => {
  it("selects the half-open range between boundary handles", () => {
    const select = vi.fn();
    const term = makeTerm({ cols: 80, select });
    const range = applyBoundarySelection(
      term as never,
      { row: 2, col: 5 },
      { row: 2, col: 10 },
    );

    expect(range).toEqual({
      start: { row: 2, col: 5 },
      end: { row: 2, col: 10 },
    });
    expect(select).toHaveBeenCalledWith(5, 2, 5);
  });

  it("keeps a one-cell selection when both handles meet", () => {
    const select = vi.fn();
    const term = makeTerm({ cols: 80, select });
    const range = applyBoundarySelection(
      term as never,
      { row: 2, col: 5 },
      { row: 2, col: 5 },
    );

    expect(range).toEqual({
      start: { row: 2, col: 5 },
      end: { row: 2, col: 6 },
    });
    expect(select).toHaveBeenCalledWith(5, 2, 1);
  });
});

describe("getTerminalSelectionRange", () => {
  it("normalizes xterm's zero-based selection boundaries", () => {
    const term = makeTerm({
      cols: 80,
      selectionPosition: {
        start: { x: 12, y: 8 },
        end: { x: 5, y: 8 },
      },
    });

    expect(getTerminalSelectionRange(term as never)).toEqual({
      start: { row: 8, col: 5 },
      end: { row: 8, col: 12 },
    });
  });
});

describe("isPointInsideSelection", () => {
  it("checks points against xterm's zero-based half-open selection range", () => {
    const term = makeTerm({
      cols: 80,
      selectionPosition: {
        start: { x: 4, y: 7 },
        end: { x: 12, y: 8 },
      },
    });

    expect(isPointInsideSelection(term as never, { row: 7, col: 4 })).toBe(
      true,
    );
    expect(isPointInsideSelection(term as never, { row: 8, col: 11 })).toBe(
      true,
    );
    expect(isPointInsideSelection(term as never, { row: 8, col: 12 })).toBe(
      false,
    );
  });

  it("handles reversed ranges", () => {
    const term = makeTerm({
      cols: 80,
      selectionPosition: {
        start: { x: 12, y: 8 },
        end: { x: 5, y: 8 },
      },
    });

    expect(isPointInsideSelection(term as never, { row: 8, col: 7 })).toBe(
      true,
    );
  });

  it("returns false without an active selection range", () => {
    const term = makeTerm({});
    expect(isPointInsideSelection(term as never, { row: 0, col: 0 })).toBe(
      false,
    );
  });
});

describe("selectWordAt", () => {
  it("selects the word under the tapped cell", () => {
    const select = vi.fn();
    const term = makeTerm({ line: "hello world", select });
    expect(selectWordAt(term as never, { row: 4, col: 2 })).toBe(true);
    expect(select).toHaveBeenCalledWith(0, 4, 5);
  });

  it("selects a word that ends the line", () => {
    const select = vi.fn();
    const term = makeTerm({ line: "hi there", select });
    expect(selectWordAt(term as never, { row: 0, col: 7 })).toBe(true);
    expect(select).toHaveBeenCalledWith(3, 0, 5);
  });

  it("uses Intl.Segmenter and xterm cell widths for Japanese word selection", () => {
    const select = vi.fn();
    const term = makeTerm({
      line: makeBufferLine([
        { chars: "日", width: 2 },
        { chars: "", width: 0 },
        { chars: "本", width: 2 },
        { chars: "", width: 0 },
        { chars: "語", width: 2 },
        { chars: "", width: 0 },
        { chars: "入", width: 2 },
        { chars: "", width: 0 },
        { chars: "力", width: 2 },
        { chars: "", width: 0 },
        { chars: "で", width: 2 },
        { chars: "", width: 0 },
        { chars: "す", width: 2 },
        { chars: "", width: 0 },
      ]),
      select,
    });

    expect(selectWordAt(term as never, { row: 3, col: 7 })).toBe(true);
    expect(select).toHaveBeenCalledWith(6, 3, 4);
  });

  it("falls back to a cell-aware non-whitespace run without Intl.Segmenter", () => {
    const originalSegmenter = (Intl as typeof Intl & { Segmenter?: unknown })
      .Segmenter;
    Object.defineProperty(Intl, "Segmenter", {
      configurable: true,
      value: undefined,
    });
    try {
      const select = vi.fn();
      const term = makeTerm({
        line: makeBufferLine([
          { chars: "あ", width: 2 },
          { chars: "", width: 0 },
          ...cellsFromText("abc"),
          { chars: " ", width: 1 },
          ...cellsFromText("def"),
        ]),
        select,
      });

      expect(selectWordAt(term as never, { row: 1, col: 2 })).toBe(true);
      expect(select).toHaveBeenCalledWith(0, 1, 5);
    } finally {
      Object.defineProperty(Intl, "Segmenter", {
        configurable: true,
        value: originalSegmenter,
      });
    }
  });

  it("returns false and selects nothing on a blank cell", () => {
    const select = vi.fn();
    const term = makeTerm({ line: "hello world", select });
    expect(selectWordAt(term as never, { row: 0, col: 5 })).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it("returns false when the row is off-buffer", () => {
    const select = vi.fn();
    const term = makeTerm({ line: null, select });
    expect(selectWordAt(term as never, { row: 9, col: 0 })).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });
});

describe("findTouchById", () => {
  it("returns the first touch when no id is tracked", () => {
    const list = makeTouchList([{ identifier: 7 }, { identifier: 8 }]);
    expect(findTouchById(list, null)?.identifier).toBe(7);
  });

  it("finds the touch matching the tracked id", () => {
    const list = makeTouchList([{ identifier: 7 }, { identifier: 8 }]);
    expect(findTouchById(list, 8)?.identifier).toBe(8);
  });

  it("returns null when the tracked id is gone", () => {
    const list = makeTouchList([{ identifier: 7 }]);
    expect(findTouchById(list, 99)).toBeNull();
  });

  it("returns null for an empty list with no tracked id", () => {
    expect(findTouchById(makeTouchList([]), null)).toBeNull();
  });
});

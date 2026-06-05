import type { Terminal as XTerm } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { terminalBottomRowsTrace } from "./terminal-trace-snapshot.js";

type CellInput = {
  chars?: string;
  fgMode?: number;
  fg?: number;
  bgMode?: number;
  bg?: number;
  bold?: boolean;
};

function cell(input: CellInput = {}) {
  return {
    getChars: () => input.chars ?? " ",
    getWidth: () => 1,
    getCode: () => (input.chars ?? " ").codePointAt(0) ?? 32,
    getFgColorMode: () => input.fgMode ?? 0,
    getFgColor: () => input.fg ?? 0,
    getBgColorMode: () => input.bgMode ?? 0,
    getBgColor: () => input.bg ?? 0,
    isBold: () => (input.bold ? 1 : 0),
    isItalic: () => 0,
    isDim: () => 0,
    isUnderline: () => 0,
    isBlink: () => 0,
    isInverse: () => 0,
    isInvisible: () => 0,
    isStrikethrough: () => 0,
    isOverline: () => 0,
    isFgRGB: () => false,
    isBgRGB: () => false,
    isFgPalette: () => false,
    isBgPalette: () => false,
    isFgDefault: () => true,
    isBgDefault: () => true,
    isAttributeDefault: () => false,
    getUnderlineStyle: () => 0,
    getUnderlineColor: () => 0,
    getUnderlineColorMode: () => 0,
    isUnderlineColorRGB: () => false,
    isUnderlineColorPalette: () => false,
    isUnderlineColorDefault: () => true,
    attributesEquals: () => false,
  };
}

function line(cells: CellInput[], isWrapped = false) {
  return {
    isWrapped,
    length: cells.length,
    getCell: (index: number) => {
      const input = cells[index];
      return input ? cell(input) : undefined;
    },
    translateToString: (
      _trimRight?: boolean,
      startColumn = 0,
      endColumn = cells.length,
    ) =>
      cells
        .slice(startColumn, endColumn)
        .map((input) => input.chars ?? " ")
        .join(""),
  };
}

function term(lines: Map<number, ReturnType<typeof line>>) {
  return {
    cols: 4,
    rows: 3,
    buffer: {
      active: {
        cursorX: 2,
        cursorY: 1,
        viewportY: 10,
        baseY: 12,
        type: "normal",
        getLine: (index: number) => lines.get(index),
      },
    },
  } as unknown as XTerm;
}

describe("terminalBottomRowsTrace", () => {
  it("captures bottom visible rows with text and compact attribute runs", () => {
    const snapshot = terminalBottomRowsTrace(
      term(
        new Map([
          [
            11,
            line(
              [
                { chars: "a", bgMode: 1, bg: 8 },
                { chars: "b", bgMode: 1, bg: 8 },
                { chars: "c", bgMode: 2, bg: 0x112233, bold: true },
                { chars: "d", bgMode: 2, bg: 0x112233, bold: true },
              ],
              true,
            ),
          ],
          [
            12,
            line([
              { chars: "w" },
              { chars: "x" },
              { chars: "y" },
              { chars: "z" },
            ]),
          ],
        ]),
      ),
      2,
    );

    expect(snapshot).toMatchObject({
      cols: 4,
      rows: 3,
      cursorX: 2,
      cursorY: 1,
      viewportY: 10,
      baseY: 12,
      bufferType: "normal",
      rowCount: 2,
      rowsSampled: [
        {
          line: 11,
          viewportRow: 1,
          isWrapped: true,
          text: "abcd",
          attrRuns: [
            { start: 0, end: 2, attrs: { bgMode: 1, bg: 8, bold: false } },
            {
              start: 2,
              end: 4,
              attrs: { bgMode: 2, bg: 0x112233, bold: true },
            },
          ],
        },
        {
          line: 12,
          viewportRow: 2,
          isWrapped: false,
          text: "wxyz",
        },
      ],
    });
  });

  it("records missing bottom buffer lines without throwing", () => {
    const snapshot = terminalBottomRowsTrace(term(new Map()), 2);

    expect(snapshot.rowsSampled).toEqual([
      { line: 11, viewportRow: 1, isWrapped: false, text: "", attrRuns: [] },
      { line: 12, viewportRow: 2, isWrapped: false, text: "", attrRuns: [] },
    ]);
  });

  it("includes focused renderer diagnostics when provided", () => {
    const snapshot = terminalBottomRowsTrace(term(new Map()), 1, {
      requestedWebgl: true,
      effectiveRenderer: "webgl",
      webglStatus: "attached",
      contextLossCount: 0,
      fontLoadingDoneCount: 1,
      atlasRebuildCount: 1,
      iosFontPrefetchStatus: "not-ios",
      unicodeVersion: "11",
      isTouch: false,
      isIos: false,
      fontFamily: "SF Mono, monospace",
      fontSize: 13,
    });

    expect(snapshot.renderer).toEqual({
      requestedWebgl: true,
      effectiveRenderer: "webgl",
      webglStatus: "attached",
      contextLossCount: 0,
      fontLoadingDoneCount: 1,
      atlasRebuildCount: 1,
      iosFontPrefetchStatus: "not-ios",
      unicodeVersion: "11",
      isTouch: false,
      isIos: false,
      fontFamily: "SF Mono, monospace",
      fontSize: 13,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  isValidHttpUrlCandidate,
  urlAtBufferCell,
  urlAtCell,
} from "./terminal-url-detect.js";

type MockCellSpec = { chars: string; width: number };

function cellsFromText(text: string): MockCellSpec[] {
  return Array.from(text).map((chars) => ({ chars, width: 1 }));
}

function makeBufferLine(cells: MockCellSpec[], isWrapped = false): unknown {
  return {
    length: cells.length,
    isWrapped,
    getCell(x: number, cell?: Record<string, unknown>) {
      const spec = cells[x];
      if (!spec) return undefined;
      const target = cell ?? {};
      target.getChars = () => spec.chars;
      target.getWidth = () => spec.width;
      return target;
    },
  };
}

function getLine(
  lines: Map<number, unknown>,
): (lineNumber: number) => ReturnType<typeof makeBufferLine> | undefined {
  return (lineNumber) =>
    lines.get(lineNumber) as ReturnType<typeof makeBufferLine> | undefined;
}

describe("isValidHttpUrlCandidate", () => {
  it("accepts plain http and https URLs", () => {
    expect(isValidHttpUrlCandidate("http://example.com")).toBe(true);
    expect(isValidHttpUrlCandidate("https://example.com/path")).toBe(true);
  });

  it("accepts URLs carrying userinfo", () => {
    expect(isValidHttpUrlCandidate("https://user@host.com/p")).toBe(true);
    expect(isValidHttpUrlCandidate("https://user:pass@host.com/p")).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isValidHttpUrlCandidate("ftp://example.com")).toBe(false);
  });

  it("rejects strings the URL parser cannot parse", () => {
    expect(isValidHttpUrlCandidate("not a url")).toBe(false);
    expect(isValidHttpUrlCandidate("http://[a")).toBe(false);
  });
});

describe("urlAtCell", () => {
  it("returns the URL whose span contains the tapped cell", () => {
    const line = makeBufferLine(cellsFromText("tap https://example.com here"));
    expect(urlAtCell(line as never, 10)).toEqual({
      url: "https://example.com",
      startCol: 4,
      length: 19,
    });
  });

  it("returns null when the tap is left of the URL", () => {
    const line = makeBufferLine(cellsFromText("tap https://example.com here"));
    expect(urlAtCell(line as never, 0)).toBeNull();
  });

  it("returns null when the tap is right of the URL", () => {
    const line = makeBufferLine(cellsFromText("tap https://example.com here"));
    // Column 23 is the space immediately after the URL.
    expect(urlAtCell(line as never, 23)).toBeNull();
  });

  it("returns null on a row with no URL", () => {
    const line = makeBufferLine(cellsFromText("just some plain text"));
    expect(urlAtCell(line as never, 5)).toBeNull();
  });

  it("maps columns past a wide glyph to the right URL span", () => {
    const line = makeBufferLine([
      { chars: "あ", width: 2 },
      { chars: "", width: 0 },
      ...cellsFromText("https://example.com"),
    ]);
    // The URL starts at cell 2 because the wide glyph occupies two cells.
    expect(urlAtCell(line as never, 2)).toEqual({
      url: "https://example.com",
      startCol: 2,
      length: 19,
    });
  });

  it("selects the URL containing the tap when a row has several", () => {
    const line = makeBufferLine(cellsFromText("https://a.com https://b.com"));
    expect(urlAtCell(line as never, 0)?.url).toBe("https://a.com");
    expect(urlAtCell(line as never, 14)?.url).toBe("https://b.com");
  });

  it("returns null for out-of-range columns", () => {
    const line = makeBufferLine(cellsFromText("https://example.com"));
    expect(urlAtCell(line as never, -1)).toBeNull();
    expect(urlAtCell(line as never, 999)).toBeNull();
  });

  it("skips a regex-shaped candidate the URL parser rejects", () => {
    const line = makeBufferLine(cellsFromText("http://[a"));
    expect(urlAtCell(line as never, 2)).toBeNull();
  });
});

describe("urlAtBufferCell", () => {
  const url = "https://example.com/path";
  const lines = new Map<number, unknown>([
    [1, makeBufferLine(cellsFromText("https://exa"))],
    [2, makeBufferLine(cellsFromText("mple.com/"), true)],
    [3, makeBufferLine(cellsFromText("path"), true)],
  ]);

  it.each([
    [1, 2, { startCol: 0, length: 11 }],
    [2, 3, { startCol: 0, length: 9 }],
    [3, 1, { startCol: 0, length: 4 }],
  ])("returns the full URL from wrapped row %i", (lineNumber, col, range) => {
    expect(urlAtBufferCell(getLine(lines) as never, lineNumber, col)).toEqual({
      url,
      ...range,
    });
  });

  it("does not open a truncated URL beyond the wrapped scan limit", () => {
    const longLines = new Map<number, unknown>([
      [1, makeBufferLine(cellsFromText("https://a.co/"))],
      [2, makeBufferLine(cellsFromText("x".repeat(2048)), true)],
      [3, makeBufferLine(cellsFromText("/tail"), true)],
    ]);
    expect(urlAtBufferCell(getLine(longLines) as never, 1, 2)).toBeNull();
  });

  it("never joins a hard-newline row", () => {
    const hardLines = new Map<number, unknown>([
      [1, makeBufferLine(cellsFromText("https://"))],
      [2, makeBufferLine(cellsFromText("example.com"))],
    ]);

    expect(urlAtBufferCell(getLine(hardLines) as never, 1, 2)).toBeNull();
    expect(urlAtBufferCell(getLine(hardLines) as never, 2, 2)).toBeNull();
  });

  it("keeps wide-cell offsets correct across a wrapped URL", () => {
    const wideLines = new Map<number, unknown>([
      [
        1,
        makeBufferLine([
          { chars: "あ", width: 2 },
          { chars: "", width: 0 },
          ...cellsFromText("https://exa"),
        ]),
      ],
      [2, makeBufferLine(cellsFromText("mple.com"), true)],
    ]);

    expect(urlAtBufferCell(getLine(wideLines) as never, 2, 3)).toEqual({
      url: "https://example.com",
      startCol: 0,
      length: 8,
    });
  });

  it("joins an early-wrapped wide glyph without inserting the empty margin cell", () => {
    const wideLines = new Map<number, unknown>([
      [
        1,
        makeBufferLine([
          ...cellsFromText("https://a.co/"),
          { chars: "", width: 1 },
        ]),
      ],
      [
        2,
        makeBufferLine(
          [
            { chars: "あ", width: 2 },
            { chars: "", width: 0 },
            ...cellsFromText("/page"),
          ],
          true,
        ),
      ],
    ]);

    expect(urlAtBufferCell(getLine(wideLines) as never, 1, 2)?.url).toBe(
      "https://a.co/あ/page",
    );
    expect(urlAtBufferCell(getLine(wideLines) as never, 2, 1)).toEqual({
      url: "https://a.co/あ/page",
      startCol: 0,
      length: 7,
    });
    expect(urlAtBufferCell(getLine(wideLines) as never, 1, 13)).toBeNull();
  });

  it("preserves an actual trailing space as a URL delimiter", () => {
    const spacedLines = new Map<number, unknown>([
      [1, makeBufferLine(cellsFromText("https://a.co/ "))],
      [2, makeBufferLine(cellsFromText("unrelated"), true)],
    ]);

    expect(urlAtBufferCell(getLine(spacedLines) as never, 1, 2)?.url).toBe(
      "https://a.co/",
    );
    expect(urlAtBufferCell(getLine(spacedLines) as never, 2, 2)).toBeNull();
  });

  it("returns null for missing lines, out-of-range cells, and invalid URLs", () => {
    const invalidLines = new Map<number, unknown>([
      [1, makeBufferLine(cellsFromText("http://[a"))],
      [2, makeBufferLine(cellsFromText("bc"), true)],
    ]);

    expect(urlAtBufferCell(getLine(invalidLines) as never, 0, 0)).toBeNull();
    expect(urlAtBufferCell(getLine(invalidLines) as never, 1, -1)).toBeNull();
    expect(urlAtBufferCell(getLine(invalidLines) as never, 1, 99)).toBeNull();
    expect(urlAtBufferCell(getLine(invalidLines) as never, 1, 2)).toBeNull();
  });
});

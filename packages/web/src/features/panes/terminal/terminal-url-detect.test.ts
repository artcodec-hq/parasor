import { describe, expect, it } from "vitest";
import { isValidHttpUrlCandidate, urlAtCell } from "./terminal-url-detect.js";

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
  };
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

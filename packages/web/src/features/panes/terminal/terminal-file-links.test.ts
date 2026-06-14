import { describe, expect, it } from "vitest";
import {
  createTerminalFileLinkProvider,
  findFilePathHitsInLine,
  resolveTerminalFilePath,
} from "./terminal-file-links.js";

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

describe("terminal file path links", () => {
  it("resolves relative paths with line suffixes", () => {
    expect(
      resolveTerminalFilePath("packages/web/src/App.tsx:12:3", "/repo"),
    ).toBe("packages/web/src/App.tsx");
  });

  it("resolves absolute paths under the worktree", () => {
    expect(
      resolveTerminalFilePath("/repo/packages/web/src/App.tsx:12", "/repo"),
    ).toBe("packages/web/src/App.tsx");
  });

  it("rejects URLs and absolute paths outside the worktree", () => {
    expect(resolveTerminalFilePath("https://example.com/a.ts", "/repo")).toBe(
      null,
    );
    expect(resolveTerminalFilePath("/tmp/other/src/App.tsx", "/repo")).toBe(
      null,
    );
  });

  it("maps file path hits through wide cells", () => {
    const line = makeBufferLine([
      { chars: "あ", width: 2 },
      { chars: "", width: 0 },
      ...cellsFromText(" packages/web/src/App.tsx:12"),
    ]);

    const hits = findFilePathHitsInLine(line as never, "/repo");

    expect(hits).toEqual([
      {
        text: "packages/web/src/App.tsx:12",
        filePath: "packages/web/src/App.tsx",
        startCol: 3,
        length: 27,
      },
    ]);
  });

  it("links paths that wrap across terminal buffer lines", () => {
    const opened: string[] = [];
    const lines = new Map<number, unknown>([
      [1, makeBufferLine(cellsFromText("packages/web/src/"))],
      [2, makeBufferLine(cellsFromText("features/App.tsx:12"), true)],
    ]);
    const provider = createTerminalFileLinkProvider(
      (lineNumber) => lines.get(lineNumber) as never,
      () => "/repo",
      (filePath) => opened.push(filePath),
    );

    let firstLineLinks: unknown[] | undefined;
    provider.provideLinks(1, (links) => {
      firstLineLinks = links as unknown[] | undefined;
    });
    let secondLineLinks: unknown[] | undefined;
    provider.provideLinks(2, (links) => {
      secondLineLinks = links as unknown[] | undefined;
    });

    expect(firstLineLinks).toHaveLength(1);
    expect(secondLineLinks).toHaveLength(1);
    const first = firstLineLinks?.[0] as {
      range: {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      activate: () => void;
    };
    const second = secondLineLinks?.[0] as {
      range: {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      activate: () => void;
    };

    expect(first.range).toEqual({
      start: { x: 1, y: 1 },
      end: { x: 17, y: 1 },
    });
    expect(second.range).toEqual({
      start: { x: 1, y: 2 },
      end: { x: 19, y: 2 },
    });

    second.activate();
    expect(opened).toEqual(["packages/web/src/features/App.tsx"]);
  });
});

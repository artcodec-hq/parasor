import { describe, expect, it } from "vitest";
import {
  createTerminalFileLinkProvider,
  findFilePathHitAtBufferCell,
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

  it("resolves relative paths containing Japanese characters", () => {
    expect(
      resolveTerminalFilePath("src/日本語/設定.test.ts:12:3", "/repo"),
    ).toBe("src/日本語/設定.test.ts");
  });

  it("resolves absolute paths containing Japanese characters", () => {
    expect(
      resolveTerminalFilePath("/repo/src/日本語/設定.test.ts:12:3", "/repo"),
    ).toBe("src/日本語/設定.test.ts");
  });

  it("rejects URLs and non-temporary absolute paths outside the worktree", () => {
    expect(resolveTerminalFilePath("https://example.com/a.ts", "/repo")).toBe(
      null,
    );
    expect(resolveTerminalFilePath("/var/other/src/App.tsx", "/repo")).toBe(
      null,
    );
  });

  it("resolves temporary media paths outside the worktree", () => {
    expect(resolveTerminalFilePath("/tmp/preview/result.png", "/repo")).toBe(
      "/tmp/preview/result.png",
    );
    expect(
      resolveTerminalFilePath("/private/tmp/preview/result.webp", "/repo"),
    ).toBe("/private/tmp/preview/result.webp");
  });

  it("rejects temporary non-media paths and parent traversal", () => {
    expect(resolveTerminalFilePath("/tmp/preview/result.txt", "/repo")).toBe(
      null,
    );
    expect(resolveTerminalFilePath("/tmp/../etc/passwd.png", "/repo")).toBe(
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

  it("links file path hits containing Japanese wide cells", () => {
    const line = makeBufferLine([
      ...cellsFromText("see "),
      ...Array.from("src/日本語/設定.test.ts:12").flatMap((chars) =>
        /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(chars)
          ? [
              { chars, width: 2 },
              { chars: "", width: 0 },
            ]
          : [{ chars, width: 1 }],
      ),
    ]);

    const hits = findFilePathHitsInLine(line as never, "/repo");

    expect(hits).toEqual([
      {
        text: "src/日本語/設定.test.ts:12",
        filePath: "src/日本語/設定.test.ts",
        startCol: 4,
        length: 26,
      },
    ]);
  });

  it("provides clickable links for paths containing Japanese characters", () => {
    const opened: string[] = [];
    const lines = new Map<number, unknown>([
      [1, makeBufferLine(cellsFromText("see src/日本語/設定.test.ts:12:3"))],
    ]);
    const provider = createTerminalFileLinkProvider(
      (lineNumber) => lines.get(lineNumber) as never,
      () => "/repo",
      (filePath) => opened.push(filePath),
    );

    let links: unknown[] | undefined;
    provider.provideLinks(1, (provided) => {
      links = provided as unknown[] | undefined;
    });
    const link = links?.[0] as
      | {
          text: string;
          activate: () => void;
        }
      | undefined;

    expect(link?.text).toBe("src/日本語/設定.test.ts:12:3");
    link?.activate();
    expect(opened).toEqual(["src/日本語/設定.test.ts"]);
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

  it("hit-tests cells in paths that wrap across terminal buffer lines", () => {
    const lines = new Map<number, unknown>([
      [1, makeBufferLine(cellsFromText("packages/web/src/"))],
      [2, makeBufferLine(cellsFromText("features/App.tsx:12"), true)],
    ]);

    const hit = findFilePathHitAtBufferCell(
      (lineNumber) => lines.get(lineNumber) as never,
      "/repo",
      2,
      4,
    );

    expect(hit).toEqual({
      text: "packages/web/src/features/App.tsx:12",
      filePath: "packages/web/src/features/App.tsx",
      startCol: 0,
      length: 19,
    });
  });

  it("links paths that a TUI splits across non-wrapped terminal lines", () => {
    const opened: string[] = [];
    const lines = new Map<number, unknown>([
      [
        1,
        makeBufferLine(cellsFromText("  dist/assets/parasor-campaign-demo-")),
      ],
      [
        2,
        makeBufferLine(cellsFromText("  BAEvbAkV.png                      ")),
      ],
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
      start: { x: 3, y: 1 },
      end: { x: 36, y: 1 },
    });
    expect(second.range).toEqual({
      start: { x: 3, y: 2 },
      end: { x: 14, y: 2 },
    });

    second.activate();
    expect(opened).toEqual(["dist/assets/parasor-campaign-demo-BAEvbAkV.png"]);
  });

  it("hit-tests cells in paths that a TUI splits across non-wrapped lines", () => {
    const lines = new Map<number, unknown>([
      [
        1,
        makeBufferLine(cellsFromText("  dist/assets/parasor-campaign-demo-")),
      ],
      [
        2,
        makeBufferLine(cellsFromText("  BAEvbAkV.png                      ")),
      ],
    ]);

    const hit = findFilePathHitAtBufferCell(
      (lineNumber) => lines.get(lineNumber) as never,
      "/repo",
      2,
      4,
    );

    expect(hit).toEqual({
      text: "dist/assets/parasor-campaign-demo-BAEvbAkV.png",
      filePath: "dist/assets/parasor-campaign-demo-BAEvbAkV.png",
      startCol: 2,
      length: 12,
    });
  });

  it("does not join ordinary short adjacent path-looking lines", () => {
    const lines = new Map<number, unknown>([
      [1, makeBufferLine(cellsFromText("see dist/assets/               "))],
      [2, makeBufferLine(cellsFromText("parasor-campaign-demo.png       "))],
    ]);
    const provider = createTerminalFileLinkProvider(
      (lineNumber) => lines.get(lineNumber) as never,
      () => "/repo",
      () => undefined,
    );

    let firstLineLinks: unknown[] | undefined;
    provider.provideLinks(1, (links) => {
      firstLineLinks = links as unknown[] | undefined;
    });
    let secondLineLinks: unknown[] | undefined;
    provider.provideLinks(2, (links) => {
      secondLineLinks = links as unknown[] | undefined;
    });

    expect(firstLineLinks).toBeUndefined();
    expect(secondLineLinks).toBeUndefined();
  });
});

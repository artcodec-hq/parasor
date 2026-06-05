import * as xtermHeadless from "@xterm/headless";
import { describe, expect, it } from "vitest";
import {
  buildHeadlessReplaySnapshot,
  HeadlessTerminalState,
} from "./headless-replay-snapshot.js";

function resolveTerminalCtor(): typeof import("@xterm/headless").Terminal {
  const ctor =
    (
      xtermHeadless as unknown as {
        Terminal?: typeof import("@xterm/headless").Terminal;
        default?: { Terminal?: typeof import("@xterm/headless").Terminal };
      }
    ).Terminal ??
    (
      xtermHeadless as unknown as {
        default?: { Terminal?: typeof import("@xterm/headless").Terminal };
      }
    ).default?.Terminal;
  if (!ctor) {
    throw new Error("@xterm/headless Terminal constructor unavailable");
  }
  return ctor;
}

const TerminalCtor = resolveTerminalCtor();

function writeTerminal(term: import("@xterm/headless").Terminal, data: string) {
  return new Promise<void>((resolve) => {
    term.write(data, resolve);
  });
}

async function replayIntoTerminal(
  data: string,
  options: { cols: number; rows: number },
) {
  const term = new TerminalCtor({
    ...options,
    scrollback: 100,
    allowProposedApi: true,
  });
  await writeTerminal(term, data);
  return term;
}

function cellAttrs(
  term: import("@xterm/headless").Terminal,
  row: number,
  col: number,
) {
  const cell = term.buffer.active.getLine(row)?.getCell(col);
  if (!cell) throw new Error(`missing cell ${row}:${col}`);
  return {
    chars: cell.getChars(),
    bgMode: cell.getBgColorMode(),
    bg: cell.getBgColor(),
  };
}

describe("buildHeadlessReplaySnapshot", () => {
  it("renders terminal output into a bounded text snapshot", async () => {
    const snapshot = await buildHeadlessReplaySnapshot(
      "one\r\ntwo\r\nthree\r\nfour",
      { cols: 20, rows: 1, scrollbackLines: 2, maxBytes: 1024 },
    );

    expect(snapshot.text).toBe("two\r\nthree\r\nfour");
    expect(snapshot.emittedLines).toBe(3);
    expect(snapshot.rawBytes).toBeGreaterThan(snapshot.snapshotBytes);
  });

  it("normalizes ANSI color attributes into the rendered snapshot", async () => {
    const snapshot = await buildHeadlessReplaySnapshot(
      "plain \x1b[31mred\x1b[0m\r\n",
      { cols: 80, rows: 24, scrollbackLines: 10, maxBytes: 1024 },
    );

    expect(snapshot.text).toContain("plain \x1b[31mred\x1b[0m");
  });

  it("preserves styled composer text and trailing styled blank cells", async () => {
    const snapshot = await buildHeadlessReplaySnapshot(
      "\x1b[H\x1b[48;5;240m\x1b[2Kcomposer\x1b[0m",
      { cols: 20, rows: 4, scrollbackLines: 10, maxBytes: 1024 },
    );
    const replayed = await replayIntoTerminal(snapshot.text, {
      cols: 20,
      rows: 4,
    });

    expect(snapshot.text).toBe("\x1b[48;5;240mcomposer            \x1b[0m");
    expect(cellAttrs(replayed, 0, 0)).toMatchObject({
      chars: "c",
      bg: 240,
    });
    expect(cellAttrs(replayed, 0, 10)).toMatchObject({
      chars: " ",
      bg: 240,
    });
  });

  it("preserves styled blank panel rows below the cursor", async () => {
    const raw = [
      "\x1b[2J\x1b[H",
      "\x1b[48;5;240m",
      "\x1b[5;1H",
      "\x1b[2K",
      "\x1b[6;1H",
      "\x1b[2K",
      "  gpt-5.5 high",
      "\x1b[7;1H",
      "\x1b[2K",
      "\x1b[8;1H",
      "\x1b[2K",
      "\x1b[6;3H",
      "\x1b[0m",
    ].join("");
    const snapshot = await buildHeadlessReplaySnapshot(raw, {
      cols: 20,
      rows: 8,
      scrollbackLines: 20,
      maxBytes: 4096,
    });
    const replayed = await replayIntoTerminal(snapshot.text, {
      cols: 20,
      rows: 8,
    });

    expect(cellAttrs(replayed, 4, 10)).toMatchObject({
      chars: " ",
      bg: 240,
    });
    expect(cellAttrs(replayed, 6, 10)).toMatchObject({
      chars: " ",
      bg: 240,
    });
    expect(cellAttrs(replayed, 7, 10)).toMatchObject({
      chars: " ",
      bg: 240,
    });
  });

  it("trims default trailing blank cells from serialized rows", async () => {
    const snapshot = await buildHeadlessReplaySnapshot("composer", {
      cols: 20,
      rows: 4,
      scrollbackLines: 10,
      maxBytes: 1024,
    });
    const replayed = await replayIntoTerminal(snapshot.text, {
      cols: 20,
      rows: 4,
    });

    expect(snapshot.text).toBe("composer");
    expect(cellAttrs(replayed, 0, 10)).toMatchObject({
      chars: "",
      bgMode: 0,
      bg: -1,
    });
  });

  it("preserves full-width Japanese text when serializing rows", async () => {
    const text =
      "\u65e5\u672c\u8a9e\u306e\u6587\u304c\u884c\u4e2d\u3067\u5207\u308c\u308b";
    const snapshot = await buildHeadlessReplaySnapshot(`${text}\r\n`, {
      cols: 80,
      rows: 24,
      scrollbackLines: 10,
      maxBytes: 1024,
    });

    expect(snapshot.text).toContain(text);
  });

  it("respects the output byte cap on UTF-8 boundaries", async () => {
    const snapshot = await buildHeadlessReplaySnapshot(
      "日本語\r\n".repeat(20),
      {
        cols: 80,
        rows: 24,
        scrollbackLines: 100,
        maxBytes: 17,
      },
    );

    expect(Buffer.byteLength(snapshot.text, "utf8")).toBeLessThanOrEqual(17);
    expect(snapshot.text).not.toContain("\uFFFD");
  });

  it("applies the byte cap while preserving the newest terminal tail", async () => {
    const snapshot = await buildHeadlessReplaySnapshot(
      Array.from(
        { length: 120 },
        (_, i) => `line-${i.toString().padStart(3, "0")}`,
      ).join("\r\n"),
      {
        cols: 80,
        rows: 1,
        scrollbackLines: 200,
        maxBytes: 64,
      },
    );

    expect(Buffer.byteLength(snapshot.text, "utf8")).toBeLessThanOrEqual(64);
    expect(snapshot.text).toContain("line-119");
    expect(snapshot.text).not.toContain("line-000");
    expect(snapshot.emittedLines).toBeLessThan(120);
  });

  it("restores the cursor position when replay text ends on a later row", async () => {
    const raw = [
      "\x1b[2J\x1b[H",
      "first row",
      "\x1b[2;1H",
      "codex input prompt",
      "\x1b[5;1H",
      "status footer",
      "\x1b[2;7H",
    ].join("");
    const original = await replayIntoTerminal(raw, { cols: 40, rows: 5 });
    const snapshot = await buildHeadlessReplaySnapshot(raw, {
      cols: 40,
      rows: 5,
      scrollbackLines: 20,
      maxBytes: 1024,
    });
    const replayed = await replayIntoTerminal(snapshot.text, {
      cols: 40,
      rows: 5,
    });

    expect(snapshot.text).toContain("status footer\x1b[2;7H");
    expect(replayed.buffer.active.cursorY).toBe(original.buffer.active.cursorY);
    expect(replayed.buffer.active.cursorX).toBe(original.buffer.active.cursorX);
  });

  it("maintains incremental terminal state for cheap snapshots", async () => {
    const state = new HeadlessTerminalState({
      cols: 20,
      rows: 2,
      scrollbackLines: 10,
      maxBytes: 1024,
    });

    await state.write("plain \x1b[31mred\x1b[0m\r\n");
    await state.write("latest prompt\n");
    const snapshot = await state.snapshot();

    expect(snapshot.text).toContain("plain \x1b[31mred\x1b[0m");
    expect(snapshot.text).toContain("latest prompt");
    expect(snapshot.rawBytes).toBe(
      Buffer.byteLength("plain \x1b[31mred\x1b[0m\r\nlatest prompt\n", "utf8"),
    );
  });
});

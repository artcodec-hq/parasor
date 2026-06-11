import { Buffer } from "node:buffer";
import * as xtermHeadless from "@xterm/headless";

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

export interface HeadlessReplaySnapshotOptions {
  cols: number;
  rows: number;
  scrollbackLines: number;
  maxBytes: number;
}

export interface HeadlessReplaySnapshot {
  text: string;
  rawBytes: number;
  snapshotBytes: number;
  bufferLines: number;
  emittedLines: number;
  durationMs: number;
}

type HeadlessBufferCell = NonNullable<
  ReturnType<
    NonNullable<
      ReturnType<
        import("@xterm/headless").Terminal["buffer"]["active"]["getLine"]
      >
    >["getCell"]
  >
>;

type HeadlessBufferLine = NonNullable<
  ReturnType<import("@xterm/headless").Terminal["buffer"]["active"]["getLine"]>
>;

function clampPositiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function utf8Tail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  const slice = buf.subarray(buf.length - maxBytes);
  let start = 0;
  while (start < slice.length && start < 3 && (slice[start] & 0xc0) === 0x80) {
    start++;
  }
  return slice.subarray(start).toString("utf8");
}

function writeTerminal(term: import("@xterm/headless").Terminal, data: string) {
  return new Promise<void>((resolve) => {
    term.write(data, resolve);
  });
}

function colorSgr(mode: number, color: number, foreground: boolean): string[] {
  if (mode === 0 || color < 0) return [];
  const base = foreground ? 30 : 40;
  if (mode === 0x01_00_00_00) {
    return [String(color < 8 ? base + color : base + 60 + (color - 8))];
  }
  if (mode === 0x02_00_00_00) {
    return [foreground ? "38" : "48", "5", String(color)];
  }
  if (mode === 0x03_00_00_00) {
    return [
      foreground ? "38" : "48",
      "2",
      String((color >> 16) & 0xff),
      String((color >> 8) & 0xff),
      String(color & 0xff),
    ];
  }
  return [];
}

function cellSgr(cell: HeadlessBufferCell): string {
  const codes = [
    ...(cell.isBold() ? ["1"] : []),
    ...(cell.isItalic() ? ["3"] : []),
    ...(cell.isUnderline() ? ["4"] : []),
    ...colorSgr(cell.getFgColorMode(), cell.getFgColor(), true),
    ...colorSgr(cell.getBgColorMode(), cell.getBgColor(), false),
  ];
  return codes.length === 0 ? "" : `\x1b[${codes.join(";")}m`;
}

function cellHasSerializedAttrs(cell: HeadlessBufferCell): boolean {
  return Boolean(
    cell.isBold() ||
      cell.isItalic() ||
      cell.isUnderline() ||
      cell.getFgColorMode() !== 0 ||
      cell.getBgColorMode() !== 0,
  );
}

function sameCellAttrs(
  left: HeadlessBufferCell | null,
  right: HeadlessBufferCell,
): boolean {
  return (
    left !== null &&
    left.isBold() === right.isBold() &&
    left.isItalic() === right.isItalic() &&
    left.isUnderline() === right.isUnderline() &&
    left.getFgColorMode() === right.getFgColorMode() &&
    left.getFgColor() === right.getFgColor() &&
    left.getBgColorMode() === right.getBgColorMode() &&
    left.getBgColor() === right.getBgColor()
  );
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type HeadlessTerminalModes = import("@xterm/headless").Terminal["modes"];

interface HeadlessMouseStateService {
  activeEncoding?: unknown;
}

function mouseProtocolSequence(mode: HeadlessTerminalModes): string {
  switch (mode.mouseTrackingMode) {
    case "x10":
      return "\x1b[?9h";
    case "vt200":
      return "\x1b[?1000h";
    case "drag":
      return "\x1b[?1002h";
    case "any":
      return "\x1b[?1003h";
    case "none":
      return "";
  }
}

function mouseEncodingSequence(
  term: import("@xterm/headless").Terminal,
): string {
  const mouseState = (
    term as unknown as {
      _core?: { mouseStateService?: HeadlessMouseStateService };
    }
  )._core?.mouseStateService;
  switch (mouseState?.activeEncoding) {
    case "SGR":
      return "\x1b[?1006h";
    case "SGR_PIXELS":
      return "\x1b[?1016h";
    default:
      return "";
  }
}

function terminalModePrologue(
  term: import("@xterm/headless").Terminal,
): string {
  return `${mouseProtocolSequence(term.modes)}${mouseEncodingSequence(term)}`;
}

function lineCursorEndColumn(line: HeadlessBufferLine | undefined): number {
  if (!line) return 0;
  let lastColumn = -1;
  let lastWidth = 1;
  for (let column = line.length - 1; column >= 0; column -= 1) {
    const cell = line.getCell(column);
    if (!cell || cell.getWidth() === 0) continue;
    if ((cell.getChars() || " ") === " ") continue;
    lastColumn = column;
    lastWidth = Math.max(1, cell.getWidth());
    break;
  }
  return lastColumn < 0 ? 0 : Math.min(line.length - 1, lastColumn + lastWidth);
}

function lineHasSerializedContent(
  line: HeadlessBufferLine | undefined,
): boolean {
  if (!line) return false;
  for (let column = line.length - 1; column >= 0; column -= 1) {
    const cell = line.getCell(column);
    if (!cell || cell.getWidth() === 0) continue;
    if ((cell.getChars() || " ") !== " ") return true;
    if (cellHasSerializedAttrs(cell)) return true;
  }
  return false;
}

function serializeLine(
  line:
    | NonNullable<
        ReturnType<
          import("@xterm/headless").Terminal["buffer"]["active"]["getLine"]
        >
      >
    | undefined,
): string {
  if (!line) return "";
  let lastColumn = -1;
  for (let column = line.length - 1; column >= 0; column -= 1) {
    const cell = line.getCell(column);
    if (!cell || cell.getWidth() === 0) continue;
    if ((cell.getChars() || " ") === " " && !cellHasSerializedAttrs(cell)) {
      continue;
    }
    lastColumn = column;
    break;
  }
  if (lastColumn < 0) return "";
  let serialized = "";
  let previousCell: HeadlessBufferCell | null = null;
  let hasAttrs = false;
  for (let column = 0; column <= lastColumn; column++) {
    const cell = line.getCell(column);
    if (!cell) continue;
    const width = cell.getWidth();
    if (width === 0) continue;
    const chars = cell.getChars() || " ";
    if (!sameCellAttrs(previousCell, cell)) {
      if (hasAttrs) serialized += "\x1b[0m";
      const sgr = cellSgr(cell);
      if (sgr !== "") {
        serialized += sgr;
        hasAttrs = true;
      } else {
        hasAttrs = false;
      }
      previousCell = cell;
    }
    serialized += chars;
  }
  return hasAttrs ? `${serialized}\x1b[0m` : serialized;
}

function snapshotTerminal(
  term: import("@xterm/headless").Terminal,
  options: { scrollbackLines: number; rows: number; maxBytes: number },
) {
  const prologue = terminalModePrologue(term);
  const prologueBytes = Buffer.byteLength(prologue, "utf8");
  const includePrologue =
    prologueBytes > 0 && prologueBytes <= options.maxBytes;
  const contentMaxBytes = includePrologue
    ? options.maxBytes - prologueBytes
    : options.maxBytes;
  const buffer = term.buffer.active;
  const cursorAbsY = buffer.baseY + buffer.cursorY;
  const cursorX = clampInteger(buffer.cursorX, 0, Math.max(0, term.cols - 1));
  const start = Math.max(
    0,
    buffer.length - (options.scrollbackLines + options.rows),
  );
  let end = buffer.length;
  // Trailing blank lines may only be trimmed when the whole buffer fits inside
  // the viewport (baseY == 0, content is top-anchored). Once scrollback exists
  // the viewport is pinned to the buffer's bottom row, so a trailing blank line
  // is the bottom of the live screen. Trimming it re-anchors the replayed
  // viewport upward and shifts a full-screen TUI's absolutely-positioned UI
  // (e.g. the codex composer) up by the trimmed-row count -- the reconnect
  // desync. Keep the full viewport in that case so the bottom anchor survives.
  const bottomAnchored = buffer.length > options.rows;
  if (!bottomAnchored) {
    while (end > start) {
      if (end - 1 <= cursorAbsY) break;
      if (lineHasSerializedContent(buffer.getLine(end - 1))) break;
      end -= 1;
    }
  }

  const reversedLines: Array<{
    bufferIndex: number;
    text: string;
    complete: boolean;
  }> = [];
  let snapshotBytes = 0;
  for (let i = end - 1; i >= start; i -= 1) {
    const line = serializeLine(buffer.getLine(i));
    const separatorBytes = reversedLines.length === 0 ? 0 : 2;
    const lineBytes = Buffer.byteLength(line, "utf8");
    const nextBytes = snapshotBytes + separatorBytes + lineBytes;
    if (nextBytes > contentMaxBytes) {
      const remainingBytes = contentMaxBytes - snapshotBytes - separatorBytes;
      if (remainingBytes > 0) {
        const partialLine = utf8Tail(line, remainingBytes);
        if (partialLine.length > 0) {
          reversedLines.push({
            bufferIndex: i,
            text: partialLine,
            complete: false,
          });
        }
      }
      break;
    }
    reversedLines.push({ bufferIndex: i, text: line, complete: true });
    snapshotBytes = nextBytes;
  }

  const rows = reversedLines.reverse();
  const lines = rows.map((row) => row.text);
  let text = lines.join("\r\n");
  const firstBufferIndex = rows[0]?.bufferIndex;
  const lastBufferIndex = rows.at(-1)?.bufferIndex;
  if (firstBufferIndex !== undefined && lastBufferIndex !== undefined) {
    const cursorRowInSnapshot = cursorAbsY - firstBufferIndex;
    const visibleStartInSnapshot = Math.max(0, lines.length - options.rows);
    const visibleCursorRow = cursorRowInSnapshot - visibleStartInSnapshot;
    const naturalCursorRow = Math.min(lines.length - 1, options.rows - 1);
    const naturalCursorX = lineCursorEndColumn(buffer.getLine(lastBufferIndex));
    const cursorRowComplete =
      rows.find((row) => row.bufferIndex === cursorAbsY)?.complete ?? false;
    const cursorIsVisible =
      cursorRowComplete &&
      cursorAbsY >= firstBufferIndex &&
      cursorAbsY <= lastBufferIndex &&
      visibleCursorRow >= 0 &&
      visibleCursorRow < options.rows;
    const cursorNeedsRestore =
      cursorIsVisible &&
      (visibleCursorRow !== naturalCursorRow || cursorX !== naturalCursorX);
    if (cursorNeedsRestore) {
      const restore = `\x1b[${visibleCursorRow + 1};${cursorX + 1}H`;
      if (Buffer.byteLength(text + restore, "utf8") <= contentMaxBytes) {
        text += restore;
      }
    }
  }
  if (includePrologue) {
    text = prologue + text;
  }
  return {
    text,
    snapshotBytes: Buffer.byteLength(text, "utf8"),
    bufferLines: buffer.length,
    emittedLines: lines.length,
  };
}

export class HeadlessTerminalState {
  private readonly term: import("@xterm/headless").Terminal;
  private readonly cols: number;
  private readonly rows: number;
  private readonly scrollbackLines: number;
  private readonly maxBytes: number;
  private rawBytes = 0;
  private pendingWrite = Promise.resolve();

  constructor(options: HeadlessReplaySnapshotOptions) {
    this.cols = clampPositiveInteger(options.cols, 80);
    this.rows = clampPositiveInteger(options.rows, 24);
    this.scrollbackLines = clampPositiveInteger(
      options.scrollbackLines,
      10_000,
    );
    this.maxBytes = clampPositiveInteger(options.maxBytes, 1024 * 1024);
    this.term = new TerminalCtor({
      cols: this.cols,
      rows: this.rows,
      scrollback: this.scrollbackLines,
      allowProposedApi: true,
    });
  }

  write(data: string): Promise<void> {
    this.rawBytes += Buffer.byteLength(data, "utf8");
    this.pendingWrite = this.pendingWrite.then(() =>
      writeTerminal(this.term, data),
    );
    return this.pendingWrite;
  }

  async snapshot(): Promise<HeadlessReplaySnapshot> {
    const startedAt = performance.now();
    await this.pendingWrite;
    return {
      ...snapshotTerminal(this.term, {
        scrollbackLines: this.scrollbackLines,
        rows: this.rows,
        maxBytes: this.maxBytes,
      }),
      rawBytes: this.rawBytes,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    };
  }
}

export async function buildHeadlessReplaySnapshot(
  raw: string,
  options: HeadlessReplaySnapshotOptions,
): Promise<HeadlessReplaySnapshot> {
  const startedAt = performance.now();
  const cols = clampPositiveInteger(options.cols, 80);
  const rows = clampPositiveInteger(options.rows, 24);
  const scrollbackLines = clampPositiveInteger(options.scrollbackLines, 10_000);
  const maxBytes = clampPositiveInteger(options.maxBytes, 1024 * 1024);
  const term = new TerminalCtor({
    cols,
    rows,
    scrollback: scrollbackLines,
    allowProposedApi: true,
  });

  await writeTerminal(term, raw);
  return {
    ...snapshotTerminal(term, { scrollbackLines, rows, maxBytes }),
    rawBytes: Buffer.byteLength(raw, "utf8"),
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  };
}

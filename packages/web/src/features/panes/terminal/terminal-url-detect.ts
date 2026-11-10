import type { IBufferLine } from "@xterm/xterm";

// Strict `http(s)://` matcher, mirroring `@xterm/addon-web-links`'s internal
// `strictUrlRegex` (the mouse path detects links with the same one on hover) so
// the touch tap-to-open path recognizes exactly the same URLs. `g` flag: it is
// scanned with `exec` in a loop against a buffer row's text.
const STRICT_URL_REGEX =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;
const MAX_WRAPPED_URL_CONTENT = 2048;

export interface LinkCellHit {
  startCol: number;
  length: number;
}

export interface UrlCellHit extends LinkCellHit {
  url: string;
}

export type BufferLineGetter = (lineNumber: number) => IBufferLine | undefined;

interface LineText {
  text: string;
  cellOffsets: number[];
  cellWidths: number[];
}

export function isValidHttpUrlCandidate(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const parsedBase =
      url.password && url.username
        ? `${url.protocol}//${url.username}:${url.password}@${url.host}`
        : url.username
          ? `${url.protocol}//${url.username}@${url.host}`
          : `${url.protocol}//${url.host}`;
    return urlString.toLowerCase().startsWith(parsedBase.toLowerCase());
  } catch {
    return false;
  }
}

function getLineText(line: IBufferLine): LineText | null {
  const cell = line.getCell(0);
  if (!cell) return null;
  let text = "";
  let contentLength = 0;
  const cellOffsets = new Array<number>(line.length);
  const cellWidths = new Array<number>(line.length);
  for (let c = 0; c < line.length; c++) {
    line.getCell(c, cell);
    const width = cell.getWidth();
    cellWidths[c] = width;
    if (width === 0) {
      // Trailing half of a wide glyph -- same logical char as the cell before.
      cellOffsets[c] = c > 0 ? cellOffsets[c - 1] : text.length;
      continue;
    }
    cellOffsets[c] = text.length;
    const chars = cell.getChars();
    text += chars.length > 0 ? chars : " ";
    if (chars.length > 0) contentLength = text.length;
  }
  // Empty right-margin cells can precede an early-wrapped wide glyph.
  // Keep actual spaces: unlike padding, they delimit URLs.
  return { text: text.slice(0, contentLength), cellOffsets, cellWidths };
}

function mapStringRangeToCells(
  lineText: LineText,
  startOffset: number,
  endOffset: number,
): LinkCellHit | null {
  let startCol = -1;
  let endCol = -1;
  for (let c = 0; c < lineText.cellOffsets.length; c++) {
    const width = lineText.cellWidths[c];
    if (width === 0) continue;
    const cellStart = lineText.cellOffsets[c];
    const charsLength =
      c + 1 < lineText.cellOffsets.length
        ? lineText.cellOffsets[c + 1] - cellStart
        : lineText.text.length - cellStart;
    const cellEnd = cellStart + Math.max(charsLength, 1);
    if (cellEnd <= startOffset || cellStart >= endOffset) continue;
    if (startCol === -1) startCol = c;
    endCol = c + width - 1;
  }
  if (startCol === -1 || endCol < startCol) return null;
  return { startCol, length: endCol - startCol + 1 };
}

/**
 * Hit-test a buffer cell against visible `http(s)://` URLs. Contiguous xterm
 * soft-wrap rows are joined like the web-links addon; hard newline rows are
 * never joined. The returned range is limited to the tapped row so the
 * temporary touch highlight remains a single-row selection.
 */
export function urlAtBufferCell(
  getLine: BufferLineGetter,
  lineNumber: number,
  col: number,
): UrlCellHit | null {
  const targetLine = getLine(lineNumber);
  if (!targetLine) return null;
  const target = getLineText(targetLine);
  if (!target || col < 0 || col >= target.cellOffsets.length) return null;
  if (target.cellOffsets[col] >= target.text.length) return null;

  const before: LineText[] = [];
  let previousLine = targetLine;
  let previousLineNumber = lineNumber;
  let beforeLength = 0;
  if (targetLine.isWrapped && !target.text.startsWith(" ")) {
    while (previousLine.isWrapped && beforeLength < MAX_WRAPPED_URL_CONTENT) {
      const line = getLine(previousLineNumber - 1);
      if (!line) break;
      const lineText = getLineText(line);
      if (!lineText) break;
      before.unshift(lineText);
      beforeLength += lineText.text.length;
      if (!line.isWrapped || lineText.text.includes(" ")) break;
      previousLine = line;
      previousLineNumber--;
    }
  }

  const after: LineText[] = [];
  let nextLineNumber = lineNumber;
  let afterLength = 0;
  while (afterLength < MAX_WRAPPED_URL_CONTENT) {
    const line = getLine(nextLineNumber + 1);
    if (!line?.isWrapped) break;
    const lineText = getLineText(line);
    if (!lineText) break;
    after.push(lineText);
    afterLength += lineText.text.length;
    if (lineText.text.includes(" ")) break;
    nextLineNumber++;
  }

  const prefixLength = before.reduce(
    (length, line) => length + line.text.length,
    0,
  );
  const text = [...before, target, ...after].map((line) => line.text).join("");
  const offset = prefixLength + target.cellOffsets[col];
  STRICT_URL_REGEX.lastIndex = 0;
  for (
    let m = STRICT_URL_REGEX.exec(text);
    m;
    m = STRICT_URL_REGEX.exec(text)
  ) {
    const url = m[0];
    if (!isValidHttpUrlCandidate(url)) continue;
    const startOffset = m.index;
    const endOffset = startOffset + url.length;
    if (offset < startOffset || offset >= endOffset) continue;
    // Do not open a truncated URL when the bounded scan ends mid-wrap.
    if (endOffset === text.length && getLine(nextLineNumber + 1)?.isWrapped)
      continue;
    const targetStart = prefixLength;
    const hit = mapStringRangeToCells(
      target,
      Math.max(startOffset, targetStart) - targetStart,
      Math.min(endOffset, targetStart + target.text.length) - targetStart,
    );
    return hit ? { ...hit, url } : null;
  }
  return null;
}

/** Hit-test one non-wrapped row, preserved for existing call sites/tests. */
export function urlAtCell(line: IBufferLine, col: number): UrlCellHit | null {
  return urlAtBufferCell(
    (lineNumber) => (lineNumber === 1 ? line : undefined),
    1,
    col,
  );
}

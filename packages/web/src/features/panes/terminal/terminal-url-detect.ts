import type { IBufferLine } from "@xterm/xterm";

// Strict `http(s)://` matcher, mirroring `@xterm/addon-web-links`'s internal
// `strictUrlRegex` (the mouse path detects links with the same one on hover) so
// the touch tap-to-open path recognizes exactly the same URLs. `g` flag: it is
// scanned with `exec` in a loop against a buffer row's text.
const STRICT_URL_REGEX =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;

export interface LinkCellHit {
  startCol: number;
  length: number;
}

export interface UrlCellHit extends LinkCellHit {
  url: string;
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

/**
 * Hit-test a tapped cell against the visible `http(s)://` URLs on one buffer
 * row, returning the URL/range whose span contains the tap, or `null`.
 *
 * The mouse path gets link detection for free from the web-links addon on
 * hover; touch has no hover, so the same scan runs at tap time. The row's
 * logical string is rebuilt cell-by-cell (`getChars()`, blanks -> space, the
 * trailing half of a wide glyph skipped) the way `translateToString` does,
 * while recording each cell column's offset into that string -- Unicode 11
 * widening makes a naive `string[col]` index drift once any CJK/emoji char
 * precedes the URL.
 *
 * Scope: a single, non-wrapped row and visible `http(s)` URLs only. OSC 8
 * hyperlinks and URLs wrapped across rows are out of scope here (the mouse
 * path still handles them via the addon's own link providers).
 */
export function urlAtCell(line: IBufferLine, col: number): UrlCellHit | null {
  const cell = line.getCell(0);
  if (!cell) return null;
  let str = "";
  const cellOffsets = new Array<number>(line.length);
  const cellWidths = new Array<number>(line.length);
  for (let c = 0; c < line.length; c++) {
    line.getCell(c, cell);
    const width = cell.getWidth();
    cellWidths[c] = width;
    if (width === 0) {
      // Trailing half of a wide glyph -- same logical char as the cell before.
      cellOffsets[c] = c > 0 ? cellOffsets[c - 1] : str.length;
      continue;
    }
    cellOffsets[c] = str.length;
    const chars = cell.getChars();
    str += chars.length > 0 ? chars : " ";
  }
  if (col < 0 || col >= cellOffsets.length) return null;
  const offset = cellOffsets[col];
  STRICT_URL_REGEX.lastIndex = 0;
  for (let m = STRICT_URL_REGEX.exec(str); m; m = STRICT_URL_REGEX.exec(str)) {
    const url = m[0];
    if (!isValidHttpUrlCandidate(url)) continue;
    const startOffset = m.index;
    const endOffset = startOffset + url.length;
    if (offset < startOffset || offset >= endOffset) continue;
    let startCol = -1;
    let endCol = -1;
    for (let c = 0; c < cellOffsets.length; c++) {
      if (cellWidths[c] === 0) continue;
      if (startCol === -1 && cellOffsets[c] >= startOffset) {
        startCol = c;
      }
      if (cellOffsets[c] < endOffset) endCol = c;
    }
    if (startCol === -1 || endCol < startCol) return null;
    return { url, startCol, length: endCol - startCol + 1 };
  }
  return null;
}

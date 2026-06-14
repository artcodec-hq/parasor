import type { IBufferLine, ILink, ILinkProvider } from "@xterm/xterm";

export interface TerminalFilePathHit {
  text: string;
  filePath: string;
  startCol: number;
  length: number;
}

interface LineScan {
  text: string;
  cellOffsets: number[];
  cellWidths: number[];
}

interface WrappedLineScan {
  text: string;
  lineNumber: number;
  startOffset: number;
  length: number;
  cellOffsets: number[];
  cellWidths: number[];
}

interface CachedLineLinks {
  line: IBufferLine;
  lineLength: number;
  isWrapped: boolean;
  worktreePath: string;
  links: ILink[];
}

const FILE_PATH_REGEX =
  /(?:\/[A-Za-z0-9._@%+=:,~-]+(?:\/[A-Za-z0-9._@%+=:,~-]+)+|(?:\.\/|[A-Za-z0-9._@%+=,~-]+\/)[A-Za-z0-9._@%+=:,~/-]+)(?::\d+(?::\d+)?)?/g;
const MAX_WRAPPED_LINK_LINES = 8;
const LINK_CACHE_TTL_MS = 250;

function scanLine(line: IBufferLine): LineScan | null {
  const cell = line.getCell(0);
  if (!cell) return null;
  let text = "";
  const cellOffsets = new Array<number>(line.length);
  const cellWidths = new Array<number>(line.length);
  for (let c = 0; c < line.length; c++) {
    line.getCell(c, cell);
    const width = cell.getWidth();
    cellWidths[c] = width;
    if (width === 0) {
      cellOffsets[c] = c > 0 ? cellOffsets[c - 1] : text.length;
      continue;
    }
    cellOffsets[c] = text.length;
    const chars = cell.getChars();
    text += chars.length > 0 ? chars : " ";
  }
  return { text, cellOffsets, cellWidths };
}

function lineIsWrapped(line: IBufferLine): boolean {
  return (line as { isWrapped?: boolean }).isWrapped === true;
}

function scanWrappedLine(
  getLine: (bufferLineNumber: number) => IBufferLine | undefined,
  bufferLineNumber: number,
): WrappedLineScan[] {
  const lines: Array<{ lineNumber: number; line: IBufferLine }> = [];
  let firstLineNumber = bufferLineNumber;
  let linesBefore = 0;
  while (firstLineNumber > 1) {
    const line = getLine(firstLineNumber);
    if (!line || !lineIsWrapped(line)) break;
    if (linesBefore >= MAX_WRAPPED_LINK_LINES - 1) break;
    firstLineNumber -= 1;
    linesBefore += 1;
  }

  for (let lineNumber = firstLineNumber; ; lineNumber++) {
    const line = getLine(lineNumber);
    if (!line) break;
    lines.push({ lineNumber, line });
    if (lines.length >= MAX_WRAPPED_LINK_LINES) break;
    const nextLine = getLine(lineNumber + 1);
    if (!nextLine || !lineIsWrapped(nextLine)) break;
  }

  const scans: WrappedLineScan[] = [];
  let offset = 0;
  for (const { lineNumber, line } of lines) {
    const scan = scanLine(line);
    if (!scan) continue;
    scans.push({
      text: scan.text,
      lineNumber,
      startOffset: offset,
      length: scan.text.length,
      cellOffsets: scan.cellOffsets,
      cellWidths: scan.cellWidths,
    });
    offset += scan.text.length;
  }
  return scans;
}

function normalizeWorktreePath(path: string): string {
  return path.replace(/\/+$/, "");
}

function stripLocationSuffix(candidate: string): string {
  return candidate.replace(/:\d+(?::\d+)?$/, "");
}

function trimTrailingPunctuation(candidate: string): string {
  return candidate.replace(/[.,;!?]+$/, "");
}

function hasParentTraversal(path: string): boolean {
  return path === ".." || path.startsWith("../") || path.includes("/../");
}

function hasFileLikeBasename(path: string): boolean {
  const basename = path.split("/").filter(Boolean).pop() ?? "";
  return basename.includes(".");
}

export function resolveTerminalFilePath(
  candidate: string,
  worktreePath: string,
): string | null {
  const trimmed = trimTrailingPunctuation(stripLocationSuffix(candidate));
  if (!trimmed || /[\r\n\0]/.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;

  const root = normalizeWorktreePath(worktreePath);
  let relativePath: string;
  if (trimmed.startsWith("/")) {
    if (!root || trimmed === root) return null;
    if (!trimmed.startsWith(`${root}/`)) return null;
    relativePath = trimmed.slice(root.length + 1);
  } else {
    relativePath = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
  }

  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    hasParentTraversal(relativePath)
  ) {
    return null;
  }
  if (!relativePath.includes("/") || !hasFileLikeBasename(relativePath)) {
    return null;
  }
  return relativePath;
}

export function findFilePathHitsInLine(
  line: IBufferLine,
  worktreePath: string,
): TerminalFilePathHit[] {
  const scan = scanLine(line);
  if (!scan) return [];
  const hits: TerminalFilePathHit[] = [];
  FILE_PATH_REGEX.lastIndex = 0;
  for (
    let match = FILE_PATH_REGEX.exec(scan.text);
    match;
    match = FILE_PATH_REGEX.exec(scan.text)
  ) {
    const text = trimTrailingPunctuation(match[0]);
    const filePath = resolveTerminalFilePath(text, worktreePath);
    if (!filePath) continue;
    const startOffset = match.index;
    const endOffset = startOffset + text.length;
    let startCol = -1;
    let endCol = -1;
    for (let c = 0; c < scan.cellOffsets.length; c++) {
      if (scan.cellWidths[c] === 0) continue;
      if (startCol === -1 && scan.cellOffsets[c] >= startOffset) {
        startCol = c;
      }
      if (scan.cellOffsets[c] < endOffset) endCol = c;
    }
    if (startCol === -1 || endCol < startCol) continue;
    hits.push({
      text,
      filePath,
      startCol,
      length: endCol - startCol + 1,
    });
  }
  return hits;
}

export function findFilePathHitAtCell(
  line: IBufferLine,
  worktreePath: string,
  col: number,
): TerminalFilePathHit | null {
  return (
    findFilePathHitsInLine(line, worktreePath).find(
      (hit) => col >= hit.startCol && col < hit.startCol + hit.length,
    ) ?? null
  );
}

export function createTerminalFileLinkProvider(
  getLine: (bufferLineNumber: number) => IBufferLine | undefined,
  getWorktreePath: () => string | undefined,
  openFilePath: (filePath: string) => void,
): ILinkProvider {
  const cache = new Map<number, CachedLineLinks>();
  let clearCacheTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleCacheClear = () => {
    if (clearCacheTimer !== null) clearTimeout(clearCacheTimer);
    clearCacheTimer = setTimeout(() => {
      clearCacheTimer = null;
      cache.clear();
    }, LINK_CACHE_TTL_MS);
  };

  return {
    provideLinks(bufferLineNumber, callback) {
      const worktreePath = getWorktreePath();
      const line = getLine(bufferLineNumber);
      if (!worktreePath || !line) {
        callback(undefined);
        return;
      }
      const cached = cache.get(bufferLineNumber);
      if (
        cached &&
        cached.line === line &&
        cached.lineLength === line.length &&
        cached.isWrapped === lineIsWrapped(line) &&
        cached.worktreePath === worktreePath
      ) {
        scheduleCacheClear();
        callback(cached.links.length > 0 ? cached.links : undefined);
        return;
      }

      const scans = scanWrappedLine(getLine, bufferLineNumber);
      const scan = scans.find((candidate) => {
        return candidate.lineNumber === bufferLineNumber;
      });
      if (!scan) {
        callback(undefined);
        return;
      }
      const text = scans.map((candidate) => candidate.text).join("");
      const linksByLine = new Map<number, ILink[]>();
      for (const candidate of scans) linksByLine.set(candidate.lineNumber, []);
      FILE_PATH_REGEX.lastIndex = 0;
      for (
        let match = FILE_PATH_REGEX.exec(text);
        match;
        match = FILE_PATH_REGEX.exec(text)
      ) {
        const matchedText = trimTrailingPunctuation(match[0]);
        const filePath = resolveTerminalFilePath(matchedText, worktreePath);
        if (!filePath) continue;
        const startOffset = match.index;
        const endOffset = startOffset + matchedText.length;
        for (const candidate of scans) {
          const lineStart = candidate.startOffset;
          const lineEnd = lineStart + candidate.length;
          if (endOffset <= lineStart || startOffset >= lineEnd) continue;

          const startCol = findColForOffset(
            candidate,
            Math.max(startOffset - lineStart, 0),
          );
          const endCol = findEndColForOffset(
            candidate,
            Math.min(endOffset - lineStart, candidate.length),
          );
          if (startCol === null || endCol === null || endCol < startCol) {
            continue;
          }
          linksByLine.get(candidate.lineNumber)?.push({
            range: {
              start: { x: startCol + 1, y: candidate.lineNumber },
              end: { x: endCol + 1, y: candidate.lineNumber },
            },
            text: matchedText,
            decorations: { pointerCursor: true, underline: true },
            activate: () => openFilePath(filePath),
          });
        }
      }
      for (const candidate of scans) {
        const scannedLine = getLine(candidate.lineNumber);
        if (!scannedLine) continue;
        cache.set(candidate.lineNumber, {
          line: scannedLine,
          lineLength: scannedLine.length,
          isWrapped: lineIsWrapped(scannedLine),
          worktreePath,
          links: linksByLine.get(candidate.lineNumber) ?? [],
        });
      }
      scheduleCacheClear();
      const links = linksByLine.get(bufferLineNumber) ?? [];
      callback(links.length > 0 ? links : undefined);
    },
  };
}

function findColForOffset(
  scan: WrappedLineScan,
  offset: number,
): number | null {
  for (let c = 0; c < scan.cellOffsets.length; c++) {
    if (scan.cellWidths[c] === 0) continue;
    if (scan.cellOffsets[c] >= offset) return c;
  }
  return null;
}

function findEndColForOffset(
  scan: WrappedLineScan,
  offset: number,
): number | null {
  let endCol: number | null = null;
  for (let c = 0; c < scan.cellOffsets.length; c++) {
    if (scan.cellWidths[c] === 0) continue;
    if (scan.cellOffsets[c] < offset) endCol = c;
  }
  return endCol;
}

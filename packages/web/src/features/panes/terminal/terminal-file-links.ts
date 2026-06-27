import type { IBufferLine, ILink, ILinkProvider } from "@xterm/xterm";
import { getMediaKindFromName } from "../../../lib/media-types.js";

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
  sourceStartOffset: number;
  cellOffsets: number[];
  cellWidths: number[];
}

interface LineFilePathHit extends TerminalFilePathHit {
  lineNumber: number;
}

interface CachedLineLinks {
  line: IBufferLine;
  lineLength: number;
  isWrapped: boolean;
  worktreePath: string;
  links: ILink[];
}

const FILE_PATH_REGEX =
  /(?:\/[\p{L}\p{N}\p{M}._@%+=:,~-]+(?:\/[\p{L}\p{N}\p{M}._@%+=:,~-]+)+|(?:\.\/|[\p{L}\p{N}\p{M}._@%+=,~-]+\/)[\p{L}\p{N}\p{M}._@%+=:,~/-]+)(?::\d+(?::\d+)?)?/gu;
const FILE_PATH_CHAR_REGEX = /[\p{L}\p{N}\p{M}._@%+=:,~/-]/u;
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
      sourceStartOffset: 0,
      cellOffsets: scan.cellOffsets,
      cellWidths: scan.cellWidths,
    });
    offset += scan.text.length;
  }
  return scans;
}

function scanSoftSplitLine(
  getLine: (bufferLineNumber: number) => IBufferLine | undefined,
  bufferLineNumber: number,
): WrappedLineScan[] {
  const getScan = (lineNumber: number): LineScan | null => {
    const line = getLine(lineNumber);
    if (!line) return null;
    return scanLine(line);
  };

  let firstLineNumber = bufferLineNumber;
  let currentScan = getScan(firstLineNumber);
  if (!currentScan) return [];

  let linesBefore = 0;
  while (firstLineNumber > 1 && linesBefore < MAX_WRAPPED_LINK_LINES - 1) {
    const previousScan = getScan(firstLineNumber - 1);
    if (!previousScan || !canSoftContinue(previousScan, currentScan)) break;
    firstLineNumber -= 1;
    currentScan = previousScan;
    linesBefore += 1;
  }

  const scans: WrappedLineScan[] = [];
  let offset = 0;
  for (let lineNumber = firstLineNumber; ; lineNumber++) {
    const scan = getScan(lineNumber);
    if (!scan) break;
    const isFirst = lineNumber === firstLineNumber;
    const sourceStartOffset = isFirst ? 0 : firstNonWhitespaceOffset(scan.text);
    const sourceEndOffset = lastNonWhitespaceOffset(scan.text);
    const text =
      sourceEndOffset > sourceStartOffset
        ? scan.text.slice(sourceStartOffset, sourceEndOffset)
        : "";
    scans.push({
      text,
      lineNumber,
      startOffset: offset,
      length: text.length,
      sourceStartOffset,
      cellOffsets: scan.cellOffsets,
      cellWidths: scan.cellWidths,
    });
    offset += text.length;
    if (scans.length >= MAX_WRAPPED_LINK_LINES) break;
    const nextScan = getScan(lineNumber + 1);
    if (!nextScan || !canSoftContinue(scan, nextScan)) break;
  }
  return scans;
}

function scanFilePathGroups(
  getLine: (bufferLineNumber: number) => IBufferLine | undefined,
  bufferLineNumber: number,
): WrappedLineScan[][] {
  const groups = [scanWrappedLine(getLine, bufferLineNumber)];
  const softScans = scanSoftSplitLine(getLine, bufferLineNumber);
  if (!sameLineNumbers(groups[0], softScans)) groups.push(softScans);
  return groups.filter((group) =>
    group.some((candidate) => candidate.lineNumber === bufferLineNumber),
  );
}

function canSoftContinue(previous: LineScan, next: LineScan): boolean {
  const previousText = previous.text.trimEnd();
  const nextText = next.text.trimStart();
  if (!previousText || !nextText) return false;
  if (lastNonWhitespaceOffset(previous.text) !== previous.text.length) {
    return false;
  }
  return (
    FILE_PATH_CHAR_REGEX.test(previousText.at(-1) ?? "") &&
    FILE_PATH_CHAR_REGEX.test(nextText[0] ?? "")
  );
}

function firstNonWhitespaceOffset(text: string): number {
  const offset = text.search(/\S/);
  return offset === -1 ? 0 : offset;
}

function lastNonWhitespaceOffset(text: string): number {
  const match = /\S\s*$/.exec(text);
  return match ? match.index + 1 : 0;
}

function sameLineNumbers(a: WrappedLineScan[], b: WrappedLineScan[]): boolean {
  return (
    a.length === b.length &&
    a.every((candidate, index) => candidate.lineNumber === b[index]?.lineNumber)
  );
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

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}

function isAllowedTemporaryMediaPath(path: string): boolean {
  if (hasParentTraversal(path)) return false;
  if (!path.startsWith("/tmp/") && !path.startsWith("/private/tmp/")) {
    return false;
  }
  return getMediaKindFromName(basename(path)) !== null;
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
    if (!trimmed.startsWith(`${root}/`)) {
      return isAllowedTemporaryMediaPath(trimmed) ? trimmed : null;
    }
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
  return findFilePathHitsInScans(
    [
      {
        ...scan,
        lineNumber: 1,
        startOffset: 0,
        length: scan.text.length,
        sourceStartOffset: 0,
      },
    ],
    worktreePath,
  ).map(({ lineNumber: _lineNumber, ...hit }) => hit);
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

export function findFilePathHitAtBufferCell(
  getLine: (bufferLineNumber: number) => IBufferLine | undefined,
  worktreePath: string,
  bufferLineNumber: number,
  col: number,
): TerminalFilePathHit | null {
  const hit =
    scanFilePathGroups(getLine, bufferLineNumber)
      .flatMap((scans) => findFilePathHitsInScans(scans, worktreePath))
      .find(
        (candidate) =>
          candidate.lineNumber === bufferLineNumber &&
          col >= candidate.startCol &&
          col < candidate.startCol + candidate.length,
      ) ?? null;
  if (!hit) return null;
  const { lineNumber: _lineNumber, ...publicHit } = hit;
  return publicHit;
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

      const scanGroups = scanFilePathGroups(getLine, bufferLineNumber);
      if (scanGroups.length === 0) {
        callback(undefined);
        return;
      }
      const scans = uniqueScansByLineNumber(scanGroups.flat());
      const linksByLine = new Map<number, ILink[]>();
      for (const candidate of scans) linksByLine.set(candidate.lineNumber, []);
      const seenLinks = new Set<string>();
      for (const hit of scanGroups.flatMap((group) =>
        findFilePathHitsInScans(group, worktreePath),
      )) {
        const key = `${hit.lineNumber}:${hit.startCol}:${hit.length}:${hit.filePath}`;
        if (seenLinks.has(key)) continue;
        seenLinks.add(key);
        linksByLine.get(hit.lineNumber)?.push({
          range: {
            start: { x: hit.startCol + 1, y: hit.lineNumber },
            end: { x: hit.startCol + hit.length, y: hit.lineNumber },
          },
          text: hit.text,
          decorations: { pointerCursor: true, underline: true },
          activate: () => openFilePath(hit.filePath),
        });
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

function uniqueScansByLineNumber(scans: WrappedLineScan[]): WrappedLineScan[] {
  const result: WrappedLineScan[] = [];
  const seen = new Set<number>();
  for (const scan of scans) {
    if (seen.has(scan.lineNumber)) continue;
    seen.add(scan.lineNumber);
    result.push(scan);
  }
  return result;
}

function findFilePathHitsInScans(
  scans: WrappedLineScan[],
  worktreePath: string,
): LineFilePathHit[] {
  const text = scans.map((candidate) => candidate.text).join("");
  const hits: LineFilePathHit[] = [];
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
      if (startCol === null || endCol === null || endCol < startCol) continue;
      hits.push({
        text: matchedText,
        filePath,
        lineNumber: candidate.lineNumber,
        startCol,
        length: endCol - startCol + 1,
      });
    }
  }
  return hits;
}

function findColForOffset(
  scan: WrappedLineScan,
  offset: number,
): number | null {
  const sourceOffset = scan.sourceStartOffset + offset;
  for (let c = 0; c < scan.cellOffsets.length; c++) {
    if (scan.cellWidths[c] === 0) continue;
    if (scan.cellOffsets[c] >= sourceOffset) return c;
  }
  return null;
}

function findEndColForOffset(
  scan: WrappedLineScan,
  offset: number,
): number | null {
  const sourceOffset = scan.sourceStartOffset + offset;
  let endCol: number | null = null;
  for (let c = 0; c < scan.cellOffsets.length; c++) {
    if (scan.cellWidths[c] === 0) continue;
    if (scan.cellOffsets[c] < sourceOffset) endCol = c;
  }
  return endCol;
}

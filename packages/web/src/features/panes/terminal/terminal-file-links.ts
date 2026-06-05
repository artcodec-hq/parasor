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

const FILE_PATH_REGEX =
  /(?:\/[A-Za-z0-9._@%+=:,~-]+(?:\/[A-Za-z0-9._@%+=:,~-]+)+|(?:\.\/|[A-Za-z0-9._@%+=,~-]+\/)[A-Za-z0-9._@%+=:,~/-]+)(?::\d+(?::\d+)?)?/g;

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
  return {
    provideLinks(bufferLineNumber, callback) {
      const worktreePath = getWorktreePath();
      const line = getLine(bufferLineNumber);
      if (!worktreePath || !line) {
        callback(undefined);
        return;
      }
      const links: ILink[] = findFilePathHitsInLine(line, worktreePath).map(
        (hit) => ({
          range: {
            start: { x: hit.startCol + 1, y: bufferLineNumber },
            end: { x: hit.startCol + hit.length, y: bufferLineNumber },
          },
          text: hit.text,
          decorations: { pointerCursor: true, underline: true },
          activate: () => openFilePath(hit.filePath),
        }),
      );
      callback(links.length > 0 ? links : undefined);
    },
  };
}

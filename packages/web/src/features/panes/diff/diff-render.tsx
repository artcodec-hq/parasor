import { Fragment } from "react";

export type DiffLineType = "ctx" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  oldNum?: number;
  newNum?: number;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export type DiffFileStatus = "Modified" | "Added" | "Removed" | "Renamed";

export interface DiffFile {
  status: DiffFileStatus;
  path: string;
  oldPath?: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

export function statusColor(status: DiffFileStatus): string {
  switch (status) {
    case "Added":
      return "text-success";
    case "Modified":
      return "text-[var(--theme-git-modified)]";
    case "Removed":
      return "text-danger";
    case "Renamed":
      return "text-accent";
  }
}

/**
 * Strip the `a/` or `b/` prefix from a `--- ` / `+++ ` header path.
 * Handles git's quoted form for paths with spaces or non-ASCII chars
 * (`"a/foo bar"`), `/dev/null` for add/remove diffs, and an optional
 * trailing tab+timestamp some tools emit.
 */
function parseDiffHeaderPath(rest: string, prefix: "a/" | "b/"): string | null {
  if (rest === "/dev/null") return null;
  let p = rest;
  const tabIdx = p.indexOf("\t");
  if (tabIdx >= 0) p = p.slice(0, tabIdx);
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    p = p.slice(1, -1);
  }
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  return p;
}

export function parseDiff(raw: string): DiffFile[] {
  if (!raw) return [];
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let curHunk: DiffHunk | null = null;
  let oldNum = 0;
  let newNum = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // Path comes from the authoritative `+++ b/...` (or `--- a/...` for
      // removals) header below -- `diff --git` paths break on quoted forms.
      cur = {
        status: "Modified",
        path: "",
        hunks: [],
        added: 0,
        removed: 0,
      };
      files.push(cur);
      curHunk = null;
      continue;
    }
    if (!cur) continue;

    if (line.startsWith("new file mode")) {
      cur.status = "Added";
    } else if (line.startsWith("deleted file mode")) {
      cur.status = "Removed";
    } else if (line.startsWith("rename from ")) {
      cur.status = "Renamed";
      cur.oldPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      cur.path = line.slice("rename to ".length);
    } else if (!curHunk && line.startsWith("--- ")) {
      const p = parseDiffHeaderPath(line.slice(4), "a/");
      if (p && !cur.path) cur.path = p;
    } else if (!curHunk && line.startsWith("+++ ")) {
      const p = parseDiffHeaderPath(line.slice(4), "b/");
      if (p) cur.path = p;
    } else if (line.startsWith("@@ ")) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldNum = parseInt(m[1], 10);
        newNum = parseInt(m[2], 10);
        curHunk = { oldStart: oldNum, newStart: newNum, lines: [] };
        cur.hunks.push(curHunk);
      }
    } else if (curHunk) {
      if (line.startsWith("\\")) {
        // "\ No newline at end of file" -- skip
      } else if (line.startsWith("+++") || line.startsWith("---")) {
        // file header lines under a hunk shouldn't appear, but guard anyway
      } else if (line.startsWith("+")) {
        curHunk.lines.push({ type: "add", newNum, text: line.slice(1) });
        newNum += 1;
        cur.added += 1;
      } else if (line.startsWith("-")) {
        curHunk.lines.push({ type: "del", oldNum, text: line.slice(1) });
        oldNum += 1;
        cur.removed += 1;
      } else {
        const text = line.startsWith(" ") ? line.slice(1) : line;
        curHunk.lines.push({ type: "ctx", oldNum, newNum, text });
        oldNum += 1;
        newNum += 1;
      }
    }
  }
  return files;
}

/**
 * Per-file diff block: status label + path + summary header + body.
 * Used at the top level in DiffPane.
 */
export function DiffFileBlock({
  file,
  onOpenFilePath,
}: {
  file: DiffFile;
  onOpenFilePath?: (filePath: string) => void;
}) {
  const openPath = file.status === "Removed" ? null : file.path;
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="px-3 pt-3">
        <div className="flex items-baseline gap-2 text-sm">
          <span className={statusColor(file.status)}>{file.status}</span>
          {onOpenFilePath && openPath ? (
            <button
              type="button"
              onClick={() => onOpenFilePath(openPath)}
              className="cm-mono min-w-0 break-all text-left text-text-primary underline decoration-transparent underline-offset-2 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
            </button>
          ) : (
            <span className="cm-mono min-w-0 break-all text-text-primary">
              {file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-text-secondary">
          Added <span className="font-semibold text-success">{file.added}</span>{" "}
          {file.added === 1 ? "line" : "lines"}, removed{" "}
          <span className="font-semibold text-danger">{file.removed}</span>{" "}
          {file.removed === 1 ? "line" : "lines"}
        </div>
      </div>
      <div className="mt-2">
        <DiffHunkBody hunks={file.hunks} />
      </div>
    </div>
  );
}

/**
 * Hunks body only (no file header). Used inline by UncommittedPane when
 * a file row is expanded -- the row already shows the path/status, so we
 * just need the per-line gutter+marker+text rendering.
 */
export function DiffHunkBody({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <div className="cm-mono text-xs leading-[1.55]">
      {hunks.map((hunk, hunkIndex) => (
        <Fragment key={`${hunk.oldStart}:${hunk.newStart}`}>
          {hunkIndex > 0 && <div className="h-px bg-border/60" />}
          {hunk.lines.map((line) => (
            <DiffLineRow
              key={`${line.type}:${line.oldNum ?? ""}:${line.newNum ?? ""}:${line.text}`}
              line={line}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const bg =
    line.type === "add"
      ? "bg-diff-added-bg"
      : line.type === "del"
        ? "bg-diff-deleted-bg"
        : "";
  const markerColor =
    line.type === "add"
      ? "text-success"
      : line.type === "del"
        ? "text-danger"
        : "text-text-secondary/40";
  const marker = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";
  const num = line.type === "add" ? line.newNum : line.oldNum;
  return (
    <div className={`flex ${bg}`}>
      <span className="w-12 shrink-0 select-none px-2 text-right text-text-secondary/50">
        {num ?? ""}
      </span>
      <span className={`w-4 shrink-0 select-none text-center ${markerColor}`}>
        {marker}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3">
        {line.text}
      </span>
    </div>
  );
}

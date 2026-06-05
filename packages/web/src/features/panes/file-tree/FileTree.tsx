import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFileTreeDrop } from "../../../hooks/useFileTreeDrop.js";
import { FILE_DRAG_MIME } from "../../../hooks/useOsFileDrop.js";
import {
  getFileIconComponent,
  getFolderIconComponent,
} from "../../../lib/file-icons.js";
import { copyFile, listDir } from "../../../lib/files-api.js";
import { getDirStatus, getStatusColor } from "../../../lib/git-status.js";
import { nextDuplicateName } from "./duplicate-name.js";
import { FileContextMenu } from "./FileContextMenu.js";
import { FileTreeUploadConflictDialog } from "./FileTreeUploadConflictDialog.js";

export { FILE_DRAG_MIME };

/*
 * Tree expand chevrons. Editor file explorers use chevron-right (collapsed)
 * and chevron-down (expanded) at 16×16 in descriptionForeground. These
 * inline SVGs match that shape -- much more legible than the U+25B8 / U+25BE
 * triangle characters which were rendering at ~10px because of font scaling.
 */
function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M5.7 4.3a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4l-3 3a1 1 0 0 1-1.4-1.4L8 8 5.7 5.7a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}
function ChevronDown() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M3.3 5.7a1 1 0 0 1 1.4 0L8 9l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  isGitignored?: boolean;
  isHidden?: boolean;
}

export interface FileTreeProps {
  projectId: string;
  projectPath?: string;
  /**
   * Absolute path of the worktree root the listing should be scoped to.
   * Forwarded as `worktreePath=` to the server so each worktree shows its
   * own files independent of the project main checkout. `undefined` falls
   * back to project root (legacy single-tree behavior).
   */
  worktreePath?: string;
  expandedPaths: string[];
  onToggleExpand: (path: string, expanded: boolean) => void;
  onSelectFile?: (path: string) => void;
  /** Currently-open file path; renders a persistent row highlight. */
  selectedFilePath?: string | null;
  fileChangeSeq?: number;
  /**
   * Bumped by the parent on user-initiated refresh. Triggers an immediate
   * re-fetch of every loaded directory (no debounce, unlike `fileChangeSeq`
   * which is the throttled file-watcher pulse).
   */
  manualRefreshSeq?: number;
  gitFileStatuses?: Record<string, string>;
  /** Emits the visible top-level entry count whenever the root listing changes. */
  onRootCountChange?: (count: number) => void;
}

export function FileTree({
  projectId,
  projectPath,
  worktreePath,
  expandedPaths,
  onToggleExpand,
  onSelectFile,
  selectedFilePath,
  fileChangeSeq,
  manualRefreshSeq,
  gitFileStatuses,
  onRootCountChange,
}: FileTreeProps) {
  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const [entries, setEntries] = useState<Map<string, FileEntry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const fetchDir = useCallback(
    async (path: string, force?: boolean) => {
      if (!force && entriesRef.current.has(path)) return;

      setLoading((prev) => new Set(prev).add(path));

      try {
        const entries = await listDir({ projectId, path, worktreePath });
        if (!entries) return;
        setEntries((prev) => new Map(prev).set(path, entries));
      } catch {
        // ignore
      } finally {
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [projectId, worktreePath],
  );

  // Cache-bypassing list fetch: lets duplicate read a collapsed parent without auto-expanding it.
  const fetchDirRaw = useCallback(
    async (path: string): Promise<FileEntry[] | null> => {
      try {
        return await listDir({ projectId, path, worktreePath });
      } catch {
        return null;
      }
    },
    [projectId, worktreePath],
  );

  /*
   * Reset cache when the project OR the worktree root changes. Worktree
   * switch = entire tree must reload from a different root, so we treat it
   * the same as a project switch (sync-clear + force re-fetch). Without
   * this the cached "." entry from worktree A would short-circuit B's load.
   *
   * React 19 StrictMode re-runs passive effects after sibling pane reorders;
   * a bare `setEntries(new Map())` in the no-change path would wipe the
   * already-loaded tree, leaving the pane blank until the root re-fetch.
   */
  const prevRootRef = useRef(`${projectId}|${worktreePath ?? ""}`);
  useEffect(() => {
    const currentRoot = `${projectId}|${worktreePath ?? ""}`;
    const rootChanged = prevRootRef.current !== currentRoot;
    if (rootChanged) {
      prevRootRef.current = currentRoot;
      setEntries(new Map());
      entriesRef.current = new Map();
    }
    fetchDir(".", rootChanged);
  }, [projectId, worktreePath, fetchDir]);

  useEffect(() => {
    for (const path of expandedPaths) {
      if (!entriesRef.current.has(path)) {
        fetchDir(path);
      }
    }
  }, [expandedPaths, fetchDir]);

  useEffect(() => {
    if (fileChangeSeq === undefined || fileChangeSeq === 0) return;
    const timer = setTimeout(() => {
      // Re-fetch all loaded paths without clearing (avoids flicker)
      const loadedPaths = [...entriesRef.current.keys()];
      for (const path of loadedPaths) {
        fetchDir(path, true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [fileChangeSeq, fetchDir]);

  // User-initiated refresh: re-fetch all loaded paths immediately. The
  // initial render (manualRefreshSeq=0 or undefined) is intentionally
  // skipped so the mount-time root fetch is not duplicated.
  useEffect(() => {
    if (!manualRefreshSeq) return;
    const loadedPaths = [...entriesRef.current.keys()];
    for (const path of loadedPaths) {
      void fetchDir(path, true);
    }
  }, [manualRefreshSeq, fetchDir]);

  const root = entries.get(".");
  useEffect(() => {
    if (!onRootCountChange) return;
    onRootCountChange(root?.length ?? 0);
  }, [root, onRootCountChange]);

  const handleToggle = (entry: FileEntry) => {
    if (entry.type !== "directory") {
      onSelectFile?.(entry.path);
      return;
    }
    const isExpanded = expandedSet.has(entry.path);
    onToggleExpand(entry.path, !isExpanded);
    if (!isExpanded && !entries.has(entry.path)) {
      fetchDir(entry.path);
    }
  };

  const handleDuplicate = useCallback(
    async (entry: FileEntry) => {
      const lastSlash = entry.path.lastIndexOf("/");
      const parentPath =
        lastSlash === -1 ? "." : entry.path.slice(0, lastSlash);
      const cached = entriesRef.current.get(parentPath);
      const siblings = cached ?? (await fetchDirRaw(parentPath));
      if (!siblings) {
        window.alert("Failed to duplicate: cannot read parent directory.");
        return;
      }
      const destName = nextDuplicateName(
        entry.name,
        entry.type,
        siblings.map((s) => s.name),
      );
      const destPath =
        parentPath === "." ? destName : `${parentPath}/${destName}`;
      const res = await copyFile({
        projectId,
        srcPath: entry.path,
        destPath,
        ...(worktreePath ? { worktreePath } : {}),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        window.alert(`Failed to duplicate${detail ? `: ${detail}` : ""}`);
        return;
      }
      // Refresh the parent dir (and all loaded paths) so the new entry shows.
      const loadedPaths = [...entriesRef.current.keys()];
      if (!loadedPaths.includes(parentPath)) loadedPaths.push(parentPath);
      for (const path of loadedPaths) {
        void fetchDir(path, true);
      }
    },
    [projectId, worktreePath, fetchDir, fetchDirRaw],
  );

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);

  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  // Any finger movement beyond this slop cancels the long-press before the
  // timer fires -- the user is scrolling or swiping panes, not pressing to
  // open a context menu.
  const LONG_PRESS_SLOP_PX = 10;

  const cancelLongPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    longPressStartRef.current = null;
  };

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const handleTouchStart = (entry: FileEntry, e: React.TouchEvent) => {
    // Two or more fingers == pane-swipe gesture, never a context-menu press.
    // Cancel any long-press already in flight and bail.
    if (e.touches.length > 1) {
      cancelLongPress();
      return;
    }
    const touch = e.touches[0];
    longPressStartRef.current = { x: touch.clientX, y: touch.clientY };
    longPressRef.current = setTimeout(() => {
      setContextMenu({ x: touch.clientX, y: touch.clientY, entry });
      longPressStartRef.current = null;
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 1) {
      cancelLongPress();
      return;
    }
    const start = longPressStartRef.current;
    if (!start || !longPressRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    if (
      Math.hypot(touch.clientX - start.x, touch.clientY - start.y) >
      LONG_PRESS_SLOP_PX
    ) {
      cancelLongPress();
    }
  };

  const handleTouchEnd = () => {
    cancelLongPress();
  };

  const handleDragStart = (entry: FileEntry, e: React.DragEvent) => {
    if (!projectPath) {
      e.preventDefault();
      return;
    }
    const absolute = `${projectPath.replace(/\/+$/, "")}/${entry.path}`;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(FILE_DRAG_MIME, JSON.stringify([absolute]));
    e.dataTransfer.setData("text/plain", absolute);
  };

  const [refreshTick, setRefreshTick] = useState(0);
  const drop = useFileTreeDrop({
    projectId,
    expandedPaths: expandedSet,
    resolveTargetForRow: (entry) => {
      if (!entry) return ".";
      if (entry.isDirectory) return entry.path;
      const lastSlash = entry.path.lastIndexOf("/");
      return lastSlash > 0 ? entry.path.slice(0, lastSlash) : ".";
    },
    onAutoExpand: (path) => {
      if (!expandedSet.has(path)) {
        onToggleExpand(path, true);
      }
    },
    onUploaded: () => setRefreshTick((n) => n + 1),
  });

  // After a successful upload, re-fetch every loaded directory so the
  // newly written files appear without the user having to navigate. We
  // deliberately re-use the same fetchDir entrypoint that the file-watcher
  // pulse uses; on small trees this costs a single round-trip per node.
  useEffect(() => {
    if (refreshTick === 0) return;
    const loadedPaths = [...entriesRef.current.keys()];
    for (const path of loadedPaths) {
      void fetchDir(path, true);
    }
  }, [refreshTick, fetchDir]);

  // Auto-dismiss inline status banner after 4s.
  useEffect(() => {
    if (!drop.message) return;
    const t = setTimeout(() => drop.dismissMessage(), 4000);
    return () => clearTimeout(t);
  }, [drop.message, drop.dismissMessage]);

  const renderEntries = (dirPath: string, depth: number) => {
    const dirEntries = entries.get(dirPath);
    if (!dirEntries) {
      return loading.has(dirPath) ? (
        <div
          className="py-0.5 text-sm text-text-secondary"
          style={{ paddingLeft: depth * 16 + 8 }}
        >
          Loading…
        </div>
      ) : null;
    }

    return dirEntries.map((entry) => {
      const isExpanded = expandedSet.has(entry.path);
      const isDir = entry.type === "directory";
      const isSelected = !isDir && selectedFilePath === entry.path;
      const Icon = isDir
        ? getFolderIconComponent(entry.name, isExpanded)
        : getFileIconComponent(entry.name);
      const dropTarget = isDir
        ? drop.hoveredRowPath === entry.path
        : drop.hoveredRowPath === entry.path;
      const rowHandlers = drop.getRowHandlers({
        path: entry.path,
        isDirectory: isDir,
        isExpanded,
      });

      return (
        <div key={entry.path}>
          <button
            type="button"
            draggable={Boolean(projectPath)}
            aria-current={isSelected ? "page" : undefined}
            className={`
              flex w-full items-center gap-2 py-1 text-left text-sm leading-tight hover:bg-bg-primary/50 active:bg-row-active-bg h-6 max-md:h-6.5
              ${entry.isGitignored ? "opacity-40" : ""}
              ${
                isSelected
                  ? "bg-row-selected-bg text-row-active-fg"
                  : entry.isHidden
                    ? "text-text-secondary"
                    : "text-text-primary"
              }
              ${dropTarget ? "ring-1 ring-accent ring-inset bg-accent/10" : ""}
            `}
            style={{ paddingLeft: depth * 16 + 8 }}
            onClick={() => handleToggle(entry)}
            onContextMenu={(e) => handleContextMenu(e, entry)}
            onDragStart={(e) => handleDragStart(entry, e)}
            onDragEnter={rowHandlers.onDragEnter}
            onDragLeave={rowHandlers.onDragLeave}
            onTouchStart={(e) => handleTouchStart(entry, e)}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            {isDir ? (
              <span className="flex w-4 shrink-0 items-center justify-center text-text-secondary">
                {isExpanded ? <ChevronDown /> : <ChevronRight />}
              </span>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <Icon className="h-icon-base w-icon-base shrink-0" />
            <span className="truncate">{entry.name}</span>
            {gitFileStatuses &&
              (() => {
                if (isDir) {
                  const dirStatus = getDirStatus(entry.path, gitFileStatuses);
                  if (dirStatus)
                    return (
                      <span
                        className={`ml-auto shrink-0 pr-2 text-xs ${getStatusColor(dirStatus)}`}
                      >
                        ●
                      </span>
                    );
                } else {
                  const status = gitFileStatuses[entry.path];
                  if (status)
                    return (
                      <span
                        className={`ml-auto shrink-0 pr-2 text-xs font-semibold ${getStatusColor(status)}`}
                      >
                        {status === "?" ? "U" : status}
                      </span>
                    );
                }
                return null;
              })()}
          </button>

          {isDir && isExpanded && renderEntries(entry.path, depth + 1)}
        </div>
      );
    });
  };

  const targetLabel = drop.targetPath ?? ".";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: root pane owns drag-and-drop events for the file tree.
    <div
      className={`relative h-full overflow-y-auto bg-bg-primary text-text-primary ${
        drop.isDragging ? "ring-1 ring-accent ring-inset" : ""
      }`}
      onDragEnter={drop.rootHandlers.onDragEnter}
      onDragOver={drop.rootHandlers.onDragOver}
      onDragLeave={drop.rootHandlers.onDragLeave}
      onDrop={drop.rootHandlers.onDrop}
    >
      <div className="py-1">{renderEntries(".", 0)}</div>

      {drop.isDragging && (
        <div
          aria-hidden
          className="pointer-events-none sticky bottom-2 ml-2 mr-2 rounded-control border border-border bg-bg-secondary/95 px-3 py-1.5 text-xs text-text-secondary shadow-md"
        >
          Drop into{" "}
          <code className="rounded-control bg-bg-primary px-1 text-text-primary">
            {targetLabel}
          </code>
        </div>
      )}

      {drop.uploading && (
        <div
          aria-live="polite"
          className="pointer-events-none sticky bottom-2 ml-2 mr-2 rounded-control border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-secondary shadow-md"
        >
          Uploading…
        </div>
      )}

      {drop.message && (
        <div
          role="status"
          className={`sticky bottom-2 ml-2 mr-2 flex items-center justify-between gap-2 rounded-control border px-3 py-1.5 text-xs shadow-md ${
            drop.message.kind === "success"
              ? "border-accent bg-bg-secondary text-text-primary"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          <span className="truncate">
            {drop.message.kind === "success" &&
              `Uploaded ${drop.message.count} file${drop.message.count === 1 ? "" : "s"} to ${drop.message.targetLabel}.`}
            {drop.message.kind === "read-only" &&
              "This project is read-only. Toggle write access in Settings to upload."}
            {drop.message.kind === "too-large" &&
              `One of the files exceeds the ${Math.round(drop.message.limit / (1024 * 1024))} MB upload limit.`}
            {drop.message.kind === "invalid-filename" &&
              `Filename rejected (${drop.message.reason}).`}
            {drop.message.kind === "invalid-target" &&
              `Target folder rejected (${drop.message.reason}).`}
            {drop.message.kind === "io" &&
              "Upload failed. Check the server logs and try again."}
          </span>
          <button
            type="button"
            onClick={drop.dismissMessage}
            className="ml-2 shrink-0 text-xs text-text-secondary hover:text-text-primary"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {contextMenu && (
        <FileContextMenu
          entry={contextMenu.entry}
          projectPath={projectPath}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onDuplicate={(entry) => {
            void handleDuplicate(entry);
          }}
        />
      )}

      <FileTreeUploadConflictDialog
        open={drop.conflict !== null}
        conflicts={drop.conflict?.conflicts ?? []}
        totalCount={drop.conflict?.files.length ?? 0}
        targetLabel={drop.conflict?.targetPath ?? "."}
        onResolve={(disposition, applyToAll) =>
          drop.resolveConflict(disposition, applyToAll)
        }
        onCancel={drop.cancelConflict}
      />
    </div>
  );
}

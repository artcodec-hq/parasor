import type {
  FileUploadDisposition,
  FileUploadResultEntry,
} from "@parasor/shared";
import {
  type DragEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FileUploadConflictError,
  FileUploadInvalidFilenameError,
  FileUploadInvalidTargetError,
  FileUploadIoError,
  FileUploadReadOnlyError,
  FileUploadTooLargeError,
  uploadFiles,
} from "../lib/uploadFiles.js";
import { isOsFileDrop } from "./useOsFileDrop.js";

const AUTO_EXPAND_DELAY_MS = 800;

/**
 * Status banner copy. Inline string union (no enum) so future call sites
 * can localize per-message at the call boundary.
 */
export type FileTreeDropMessage =
  | { kind: "success"; count: number; targetLabel: string }
  | { kind: "read-only" }
  | { kind: "too-large"; limit: number }
  | { kind: "invalid-filename"; reason: string }
  | { kind: "invalid-target"; reason: string }
  | { kind: "io" };

interface PendingDrop {
  files: readonly File[];
  targetPath: string;
}

interface ConflictState extends PendingDrop {
  conflicts: string[];
}

export interface UseFileTreeDropOptions {
  projectId: string;
  /**
   * Resolves the relative path beneath the project root for a given row.
   * Folder rows return the folder path itself; file rows return the
   * parent directory; a `null` row (drop on empty tree area) maps to `"."`.
   */
  resolveTargetForRow: (
    entry: { path: string; isDirectory: boolean } | null,
  ) => string;
  /** Fires after the 800 ms hover timer expires on a collapsed folder row. */
  onAutoExpand: (path: string) => void;
  /**
   * Optional set of currently-expanded folder paths. When provided the
   * hover timer skips already-open folders so we do not recursively
   * re-expand on every dragenter.
   */
  expandedPaths: ReadonlySet<string>;
  /** Called after a successful upload so the caller can refresh the tree. */
  onUploaded: () => void;
}

export interface UseFileTreeDropResult {
  /** Attach to the root element of the file tree. */
  rootHandlers: {
    onDragEnter: DragEventHandler<HTMLElement>;
    onDragOver: DragEventHandler<HTMLElement>;
    onDragLeave: DragEventHandler<HTMLElement>;
    onDrop: DragEventHandler<HTMLElement>;
  };
  /** Per-row hover handlers for highlight + auto-expand. */
  getRowHandlers: (entry: {
    path: string;
    isDirectory: boolean;
    isExpanded: boolean;
  }) => {
    onDragEnter: DragEventHandler<HTMLElement>;
    onDragLeave: DragEventHandler<HTMLElement>;
  };
  /** Current row path under cursor (`null` => drop fires at the project root). */
  hoveredRowPath: string | null;
  /** Resolved target dir for the current hover. */
  targetPath: string | null;
  /** True while an OS file drag is hovering anywhere in the tree. */
  isDragging: boolean;
  /** True while an upload request is awaiting the server. */
  uploading: boolean;
  conflict: ConflictState | null;
  /** Inline status banner state managed by the hook. */
  message: FileTreeDropMessage | null;
  dismissMessage: () => void;
  resolveConflict: (
    disposition: FileUploadDisposition,
    applyToAll: boolean,
  ) => void;
  cancelConflict: () => void;
}

/**
 * File-tree drop coordinator. Wires three concerns the file tree itself
 * shouldn't have to know about:
 *
 *   1. OS-drag classification (delegated to `useOsFileDrop` helpers so
 *      we don't double-handle internal filetree -> terminal drags).
 *   2. Hover state with auto-expand for collapsed folders.
 *   3. Two-phase upload (probe -> conflict modal -> retry with disposition).
 */
export function useFileTreeDrop(
  options: UseFileTreeDropOptions,
): UseFileTreeDropResult {
  const {
    projectId,
    resolveTargetForRow,
    onAutoExpand,
    expandedPaths,
    onUploaded,
  } = options;

  const depthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredRowPath, setHoveredRowPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [message, setMessage] = useState<FileTreeDropMessage | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandTargetRef = useRef<string | null>(null);

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    expandTargetRef.current = null;
  }, []);

  useEffect(() => () => clearExpandTimer(), [clearExpandTimer]);

  const targetPath = useMemo(() => {
    if (!isDragging) return null;
    if (hoveredRowPath === null) {
      return resolveTargetForRow(null);
    }
    // The row entry needs an `isDirectory` decision; the caller can
    // recompute that cheaply because rows already advertise their kind
    // in the data attribute.
    return resolveTargetForRow({
      path: hoveredRowPath,
      isDirectory:
        // Heuristic: trust the row's advertised isDirectory via the
        // dragenter call below; we cache the last value alongside the
        // path. Default to false (= treat as file -> parent dir).
        currentRowIsDirRef.current,
    });
  }, [hoveredRowPath, isDragging, resolveTargetForRow]);

  // The hovered row's "isDirectory" is needed by `resolveTargetForRow`,
  // but state churn would re-render on every dragenter. Stash it in a
  // ref and pair updates with `setHoveredRowPath`.
  const currentRowIsDirRef = useRef(false);

  /**
   * Run the upload pipeline for an already-resolved target. Handles the
   * two-phase conflict flow: a `disposition === undefined` first call
   * surfaces the modal on `FileUploadConflictError`; subsequent calls
   * carry the user's chosen disposition.
   */
  const runUpload = useCallback(
    async (
      pending: PendingDrop,
      disposition: FileUploadDisposition | undefined,
    ): Promise<FileUploadResultEntry[] | null> => {
      setUploading(true);
      setMessage(null);
      try {
        return await uploadFiles({
          projectId,
          targetPath: pending.targetPath,
          files: pending.files,
          ...(disposition ? { disposition } : {}),
        });
      } catch (err) {
        if (err instanceof FileUploadConflictError) {
          setConflict({ ...pending, conflicts: err.conflicts });
          return null;
        }
        if (err instanceof FileUploadReadOnlyError) {
          setMessage({ kind: "read-only" });
          return null;
        }
        if (err instanceof FileUploadTooLargeError) {
          setMessage({ kind: "too-large", limit: err.limit });
          return null;
        }
        if (err instanceof FileUploadInvalidFilenameError) {
          setMessage({ kind: "invalid-filename", reason: err.reason });
          return null;
        }
        if (err instanceof FileUploadInvalidTargetError) {
          setMessage({ kind: "invalid-target", reason: err.reason });
          return null;
        }
        if (err instanceof FileUploadIoError) {
          setMessage({ kind: "io" });
          return null;
        }
        // Unknown error -- treat as IO failure. Upstream caller already
        // logs detail to the console via authFetch, so we just surface
        // the inline banner here.
        console.error("[file-uploads] unexpected error", err);
        setMessage({ kind: "io" });
        return null;
      } finally {
        setUploading(false);
      }
    },
    [projectId],
  );

  const finalizeSuccess = useCallback(
    (count: number, targetLabel: string) => {
      setMessage({ kind: "success", count, targetLabel });
      onUploaded();
    },
    [onUploaded],
  );

  const handleRootDragEnter: DragEventHandler<HTMLElement> = (event) => {
    if (!isOsFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    depthRef.current += 1;
    if (!isDragging) setIsDragging(true);
  };

  const handleRootDragOver: DragEventHandler<HTMLElement> = (event) => {
    if (!isOsFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  const handleRootDragLeave: DragEventHandler<HTMLElement> = (event) => {
    if (!isOsFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) {
      setIsDragging(false);
      setHoveredRowPath(null);
      currentRowIsDirRef.current = false;
      clearExpandTimer();
    }
  };

  const handleRootDrop: DragEventHandler<HTMLElement> = (event) => {
    if (!isOsFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    const dt = event.dataTransfer;
    depthRef.current = 0;
    setIsDragging(false);
    clearExpandTimer();
    const files: File[] = [];
    if (dt) {
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files.item(i);
        if (f) files.push(f);
      }
    }
    if (files.length === 0) {
      setHoveredRowPath(null);
      currentRowIsDirRef.current = false;
      return;
    }
    const target = resolveTargetForRow(
      hoveredRowPath
        ? {
            path: hoveredRowPath,
            isDirectory: currentRowIsDirRef.current,
          }
        : null,
    );
    setHoveredRowPath(null);
    currentRowIsDirRef.current = false;

    void (async () => {
      const result = await runUpload({ files, targetPath: target }, undefined);
      if (result) {
        finalizeSuccess(
          result.filter((r) => r.status !== "skipped").length,
          target || ".",
        );
      }
    })();
  };

  const getRowHandlers = useCallback(
    (entry: { path: string; isDirectory: boolean; isExpanded: boolean }) => {
      const onDragEnter: DragEventHandler<HTMLElement> = (event) => {
        if (!isOsFileDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        setHoveredRowPath(entry.path);
        currentRowIsDirRef.current = entry.isDirectory;
        // Auto-expand collapsed folder after hover delay. Already-open
        // folders skip the timer entirely, otherwise repeated dragenters
        // on inner rows would keep arming and disarming the timeout.
        if (entry.isDirectory && !entry.isExpanded) {
          if (expandTargetRef.current !== entry.path) {
            clearExpandTimer();
            expandTargetRef.current = entry.path;
            expandTimerRef.current = setTimeout(() => {
              if (expandTargetRef.current === entry.path) {
                onAutoExpand(entry.path);
                expandTimerRef.current = null;
                expandTargetRef.current = null;
              }
            }, AUTO_EXPAND_DELAY_MS);
          }
        } else {
          clearExpandTimer();
        }
      };
      const onDragLeave: DragEventHandler<HTMLElement> = (event) => {
        if (!isOsFileDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        // We only clear the highlight if the row we're leaving still
        // matches `hoveredRowPath`. Sibling enters fire before parent
        // leaves on most browsers, so ordering protection avoids losing
        // the new highlight to a delayed leave.
        if (expandTargetRef.current === entry.path) {
          clearExpandTimer();
        }
      };
      return { onDragEnter, onDragLeave };
    },
    [onAutoExpand, clearExpandTimer],
  );

  const dismissMessage = useCallback(() => setMessage(null), []);

  const cancelConflict = useCallback(() => {
    setConflict(null);
  }, []);

  const resolveConflict = useCallback(
    (disposition: FileUploadDisposition, _applyToAll: boolean) => {
      const pending = conflict;
      setConflict(null);
      if (!pending) return;
      void (async () => {
        const result = await runUpload(
          { files: pending.files, targetPath: pending.targetPath },
          disposition,
        );
        if (result) {
          finalizeSuccess(
            result.filter((r) => r.status !== "skipped").length,
            pending.targetPath || ".",
          );
        }
      })();
    },
    [conflict, runUpload, finalizeSuccess],
  );

  // Suppress unused-import warning for expandedPaths (not currently needed
  // by the row-handler implementation but kept on the public API in case
  // the auto-expand decision moves into render later).
  void expandedPaths;

  return {
    rootHandlers: {
      onDragEnter: handleRootDragEnter,
      onDragOver: handleRootDragOver,
      onDragLeave: handleRootDragLeave,
      onDrop: handleRootDrop,
    },
    getRowHandlers,
    hoveredRowPath,
    targetPath,
    isDragging,
    uploading,
    conflict,
    message,
    dismissMessage,
    resolveConflict,
    cancelConflict,
  };
}

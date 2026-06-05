import { type DragEventHandler, useCallback, useMemo, useState } from "react";

/**
 * MIME type for parasor's internal filetree-to-terminal DnD payload. If a
 * drop event advertises this type we treat the drop as an internal path
 * insertion and keep our hands off the OS upload pipeline.
 */
export const FILE_DRAG_MIME = "application/x-parasor-paths";

/**
 * A drag event is an OS file drop when the dataTransfer advertises `"Files"`
 * in `types` AND does NOT advertise the internal FILE_DRAG_MIME. The two
 * sources can coexist in a single browser session (internal drag AND a
 * second OS file drop into a different pane) so the distinction has to be
 * per-event, not per-session.
 */
export function isOsFileDrop(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = dt.types;
  let hasFiles = false;
  for (const t of types) {
    if (t === FILE_DRAG_MIME) return false;
    if (t === "Files") hasFiles = true;
  }
  return hasFiles;
}

/**
 * Three kinds of drag may enter a terminal-like drop target:
 *   - "internal"  -- our own filetree drag  (FILE_DRAG_MIME present)
 *   - "os-files"  -- an OS file drop        (Files present, no FILE_DRAG_MIME)
 *   - "internal"  -- a plain text drag      (text/plain only; insert as text)
 *   - "none"      -- nothing we handle
 *
 * Precedence matters on Safari/macOS: Finder drags advertise BOTH
 * "Files" AND "text/plain", so "Files" must be checked before
 * "text/plain". Routing a Finder drop through the text-insert path
 * would insert just the filename instead of triggering the upload path.
 */
export type DragKind = "internal" | "os-files" | "none";

export function classifyDrag(types: ReadonlyArray<string>): DragKind {
  if (types.includes(FILE_DRAG_MIME)) return "internal";
  if (types.includes("Files")) return "os-files";
  if (types.includes("text/plain")) return "internal";
  return "none";
}

export interface UseOsFileDropOptions {
  onDrop: (files: readonly File[]) => void;
  /** When false, the hook refuses to enter the dragging state. */
  enabled?: boolean;
}

export interface UseOsFileDropResult {
  /** Attach these handlers to the drop target element. */
  handlers: {
    onDragEnter: DragEventHandler<HTMLElement>;
    onDragOver: DragEventHandler<HTMLElement>;
    onDragLeave: DragEventHandler<HTMLElement>;
    onDrop: DragEventHandler<HTMLElement>;
  };
  /** True while an OS file drag is hovering the target. */
  isDragging: boolean;
}

/**
 * Low-level file-drop handler shared by Terminal and future drop zones.
 * A dedicated hook (not a library like `react-dropzone`'s higher-level
 * `useDropzone`) is required because the Terminal already owns its own
 * drag handlers for the internal filetree payload; we need to co-operate,
 * not replace.
 */
export function useOsFileDrop(
  options: UseOsFileDropOptions,
): UseOsFileDropResult {
  const { onDrop, enabled = true } = options;
  const [depth, setDepth] = useState(0);

  const handlers = useMemo(() => {
    const onDragEnter: DragEventHandler<HTMLElement> = (event) => {
      if (!enabled) return;
      if (!isOsFileDrop(event.dataTransfer)) return;
      event.preventDefault();
      setDepth((d) => d + 1);
    };
    const onDragOver: DragEventHandler<HTMLElement> = (event) => {
      if (!enabled) return;
      if (!isOsFileDrop(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave: DragEventHandler<HTMLElement> = (event) => {
      if (!enabled) return;
      if (!isOsFileDrop(event.dataTransfer)) return;
      event.preventDefault();
      // Depth counter tolerates dragenter/leave pairs firing on inner
      // children of the drop target: we only reset when we return to zero.
      setDepth((d) => Math.max(0, d - 1));
    };
    const onDropHandler: DragEventHandler<HTMLElement> = (event) => {
      if (!enabled) return;
      if (!isOsFileDrop(event.dataTransfer)) return;
      event.preventDefault();
      setDepth(0);
      const files: File[] = [];
      const dt = event.dataTransfer;
      if (dt) {
        for (let i = 0; i < dt.files.length; i++) {
          const file = dt.files.item(i);
          if (file) files.push(file);
        }
      }
      if (files.length > 0) onDrop(files);
    };
    return {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop: onDropHandler,
    };
  }, [enabled, onDrop]);

  const isDragging = useCallback(() => depth > 0, [depth])();

  return { handlers, isDragging };
}

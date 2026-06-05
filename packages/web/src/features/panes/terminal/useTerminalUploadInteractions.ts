import {
  type DragEventHandler,
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { classifyDrag, FILE_DRAG_MIME } from "../../../hooks/useOsFileDrop.js";
import { shellEscapeJoin } from "../../../lib/shell-escape.js";
import { uploadDrops } from "../../../lib/uploadDrops.js";
import {
  classifyHoverLabel,
  cleanUploadedPaths,
  type UploadState,
  uploadErrorMessage,
} from "./terminal-upload.js";

interface UseTerminalUploadInteractionsOptions {
  projectId?: string;
  sessionId: string;
  dropEnabled: boolean;
  sendInput: (data: string) => void;
  focusTerminal: () => void;
}

export interface TerminalUploadDragHandlers {
  onDragEnter: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
}

export interface TerminalUploadInteractions {
  uploadState: UploadState;
  isDragOver: boolean;
  dragOverlayLabel: string;
  runUpload: (files: readonly File[]) => Promise<void>;
  dropEnabledRef: MutableRefObject<boolean>;
  runUploadRef: MutableRefObject<(files: readonly File[]) => Promise<void>>;
  dragHandlers: TerminalUploadDragHandlers;
}

export function useTerminalUploadInteractions({
  projectId,
  sessionId,
  dropEnabled,
  sendInput,
  focusTerminal,
}: UseTerminalUploadInteractionsOptions): TerminalUploadInteractions {
  const [isDragOver, setIsDragOver] = useState(false);
  // dragenter/dragleave fire for every child element too, so we count nested
  // enters and only clear the overlay when the count drops to 0.
  const dragDepthRef = useRef(0);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
  });
  const uploadAbortRef = useRef<AbortController | null>(null);
  const errorClearTimerRef = useRef<number | null>(null);

  const scheduleErrorClear = useCallback(() => {
    if (errorClearTimerRef.current !== null) {
      clearTimeout(errorClearTimerRef.current);
    }
    errorClearTimerRef.current = window.setTimeout(() => {
      setUploadState({ status: "idle" });
      errorClearTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
      if (errorClearTimerRef.current !== null) {
        clearTimeout(errorClearTimerRef.current);
      }
    };
  }, []);

  const runUpload = useCallback(
    async (files: readonly File[]) => {
      if (!projectId) {
        setUploadState({
          status: "error",
          message: "Cannot upload: project unknown",
        });
        scheduleErrorClear();
        return;
      }
      uploadAbortRef.current?.abort();
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      setUploadState({ status: "uploading" });
      try {
        const paths = await uploadDrops({
          projectId,
          sessionId,
          files,
          signal: controller.signal,
          onSlow: () => setUploadState({ status: "slow" }),
        });
        const cleaned = cleanUploadedPaths(paths);
        if (cleaned.length > 0) {
          sendInput(shellEscapeJoin(cleaned));
          focusTerminal();
        }
        setUploadState({ status: "idle" });
      } catch (err) {
        const message = uploadErrorMessage(err);
        if (message === null) {
          setUploadState({ status: "idle" });
          return;
        }
        setUploadState({ status: "error", message });
        scheduleErrorClear();
      }
    },
    [focusTerminal, projectId, scheduleErrorClear, sendInput, sessionId],
  );

  // Forward latest `dropEnabled` / `runUpload` into the xterm init effect
  // without adding them to its deps. The effect rebuilds xterm + WebGL + font
  // atlas, so retriggering it on socket reconnect or projectId flip would
  // drop scrollback.
  const dropEnabledRef = useRef(dropEnabled);
  dropEnabledRef.current = dropEnabled;
  const runUploadRef = useRef(runUpload);
  runUploadRef.current = runUpload;

  const handleDragEnter: DragEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (!dropEnabled) return;
      const kind = classifyDrag(e.dataTransfer.types);
      if (kind === "none") return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDragOver(true);
    },
    [dropEnabled],
  );

  const handleDragOver: DragEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (!dropEnabled) return;
      const kind = classifyDrag(e.dataTransfer.types);
      if (kind === "none") return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [dropEnabled],
  );

  const handleDragLeave: DragEventHandler<HTMLDivElement> = useCallback((e) => {
    if (classifyDrag(e.dataTransfer.types) === "none") return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop: DragEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (!dropEnabled) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragOver(false);

      const kind = classifyDrag(e.dataTransfer.types);
      if (kind === "os-files") {
        const files: File[] = [];
        const list = e.dataTransfer.files;
        for (let i = 0; i < list.length; i++) {
          const f = list.item(i);
          if (f) files.push(f);
        }
        if (files.length > 0) void runUpload(files);
        return;
      }

      let paths: string[] = [];
      const payload = e.dataTransfer.getData(FILE_DRAG_MIME);
      if (payload) {
        try {
          const parsed: unknown = JSON.parse(payload);
          if (Array.isArray(parsed)) {
            paths = parsed.filter((p): p is string => typeof p === "string");
          }
        } catch {
          // fall through to text/plain
        }
      }
      if (paths.length === 0) {
        const text = e.dataTransfer.getData("text/plain");
        if (text) paths = [text];
      }
      const cleaned = cleanUploadedPaths(paths);
      if (cleaned.length === 0) return;
      sendInput(shellEscapeJoin(cleaned));
      focusTerminal();
    },
    [dropEnabled, focusTerminal, runUpload, sendInput],
  );

  const dragHandlers = useMemo<TerminalUploadDragHandlers>(
    () => ({
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    }),
    [handleDragEnter, handleDragLeave, handleDragOver, handleDrop],
  );

  return {
    uploadState,
    isDragOver,
    dragOverlayLabel: classifyHoverLabel(uploadState) ?? "Drop to insert path",
    runUpload,
    dropEnabledRef,
    runUploadRef,
    dragHandlers,
  };
}

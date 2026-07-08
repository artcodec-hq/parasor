import type { Terminal as XTerm } from "@xterm/xterm";
import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import type { TerminalSelectionHandle } from "./TerminalSelectionOverlay.js";
import type { SelectionOverlayState } from "./terminal-selection-layout.js";
import {
  applyBoundarySelection,
  getSelectionPointFromHandleDrag,
  getTerminalSelectionRange,
} from "./terminal-touch-selection.js";

type ToolbarAnchor = { clientX: number; clientY: number } | null;

export function useTerminalSelectionOverlay({
  sessionId,
  xtermRef,
  getScreenElement,
  setInputToolbarAnchor,
}: {
  sessionId: string;
  xtermRef: RefObject<XTerm | null>;
  getScreenElement: (term: XTerm) => Element | null;
  setInputToolbarAnchor: Dispatch<SetStateAction<ToolbarAnchor>>;
}) {
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionOverlay, setSelectionOverlay] =
    useState<SelectionOverlayState | null>(null);
  const selectionOverlayRef = useRef<SelectionOverlayState | null>(null);
  selectionOverlayRef.current = selectionOverlay;

  const clearSelectionOverlay = useCallback(() => {
    setHasSelection(false);
    setSelectionOverlay(null);
  }, []);

  const commitSelectionOverlay = useCallback(
    (input: { clientX: number; clientY: number; showToolbar: boolean }) => {
      const term = xtermRef.current;
      const text = term?.getSelection() ?? "";
      const range = term ? getTerminalSelectionRange(term) : null;
      if (!text) {
        setSelectionOverlay(null);
        return;
      }
      if (!range) return;

      setHasSelection(true);
      setInputToolbarAnchor(null);
      setSelectionOverlay({
        range,
        toolbarAnchor: input.showToolbar
          ? { clientX: input.clientX, clientY: input.clientY }
          : null,
        draggingHandle: null,
      });

      traceTerminalEvent("terminal-selection-overlay-commit", {
        sessionId,
        dataLength: text.length,
        visible: input.showToolbar,
      });
    },
    [sessionId, setInputToolbarAnchor, xtermRef],
  );

  const applySelectionHandleDrag = useCallback(
    (
      event: Pick<PointerEvent, "clientX" | "clientY">,
      showToolbar: boolean,
    ) => {
      const term = xtermRef.current;
      const screenElement = term ? getScreenElement(term) : null;
      const overlay = selectionOverlayRef.current;
      if (!term || !screenElement || !overlay?.draggingHandle) return;
      const focus = getSelectionPointFromHandleDrag(term, screenElement, event);
      if (!focus) return;
      const fixed =
        overlay.draggingHandle === "start"
          ? overlay.range.end
          : overlay.range.start;
      const nextRange = applyBoundarySelection(term, fixed, focus);
      setHasSelection(true);
      setSelectionOverlay({
        range: nextRange,
        toolbarAnchor: showToolbar
          ? { clientX: event.clientX, clientY: event.clientY }
          : null,
        draggingHandle: showToolbar ? null : overlay.draggingHandle,
      });
    },
    [getScreenElement, xtermRef],
  );

  const handleSelectionHandlePointerDown = useCallback(
    (
      handle: TerminalSelectionHandle,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setInputToolbarAnchor(null);
      setSelectionOverlay((prev) =>
        prev ? { ...prev, draggingHandle: handle, toolbarAnchor: null } : prev,
      );
    },
    [setInputToolbarAnchor],
  );

  useEffect(() => {
    if (!selectionOverlay?.draggingHandle) return;
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      applySelectionHandleDrag(event, false);
    };
    const handlePointerUp = (event: PointerEvent) => {
      event.preventDefault();
      applySelectionHandleDrag(event, true);
    };
    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerUp, {
      passive: false,
    });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [selectionOverlay?.draggingHandle, applySelectionHandleDrag]);

  return {
    hasSelection,
    setHasSelection,
    selectionOverlay,
    setSelectionOverlay,
    clearSelectionOverlay,
    commitSelectionOverlay,
    handleSelectionHandlePointerDown,
  };
}

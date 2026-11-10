import type { Terminal as XTerm } from "@xterm/xterm";
import type { Dispatch, SetStateAction } from "react";
import { hasTerminalPasteCandidate } from "../../../lib/terminal-internal-clipboard.js";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import type { SelectionOverlayState } from "./terminal-selection-layout.js";
import {
  attachTerminalTapGestures,
  attachTerminalTouchSelection,
  attachTerminalTouchWheel,
} from "./terminal-touch-gestures.js";
import { getTerminalSelectionRange } from "./terminal-touch-selection.js";

type ToolbarAnchor = { clientX: number; clientY: number } | null;

export function attachTerminalTouchLifecycle({
  sessionId,
  term,
  container,
  screenElement,
  inputToolbarDismissSuppressUntilRef,
  setHasSelection,
  setSelectionOverlay,
  setInputToolbarAnchor,
  openUrl,
  openFilePath,
  getWorktreePath,
  onSelectionCommit,
}: {
  sessionId: string;
  term: XTerm;
  container: HTMLElement;
  screenElement: Element | null;
  inputToolbarDismissSuppressUntilRef: { current: number };
  setHasSelection: Dispatch<SetStateAction<boolean>>;
  setSelectionOverlay: Dispatch<SetStateAction<SelectionOverlayState | null>>;
  setInputToolbarAnchor: Dispatch<SetStateAction<ToolbarAnchor>>;
  openUrl: (uri: string) => void;
  openFilePath: (filePath: string) => void;
  getWorktreePath: () => string | undefined;
  onSelectionCommit: (input: {
    clientX: number;
    clientY: number;
    showToolbar: boolean;
  }) => void;
}) {
  const cleanupTapGestures = attachTerminalTapGestures({
    term,
    container,
    screenElement,
  });
  const cleanupTouchWheel = attachTerminalTouchWheel({
    term,
    screenElement,
  });

  const cleanupTouchSelection = attachTerminalTouchSelection({
    term,
    screenElement,
    openUrl,
    openFilePath,
    getWorktreePath,
    onSelectionCleared: () => {
      setHasSelection(false);
      setSelectionOverlay(null);
      setInputToolbarAnchor(null);
    },
    onInputToolbarRequest: (anchor) => {
      if (!hasTerminalPasteCandidate()) return;
      if (performance.now() < inputToolbarDismissSuppressUntilRef.current) {
        traceTerminalEvent("terminal-toolbar-request-skipped", {
          sessionId,
          surface: "paste",
          reason: "recent-dismiss",
        });
        return;
      }
      setHasSelection(false);
      setSelectionOverlay(null);
      setInputToolbarAnchor(anchor);
    },
    onSelectionCommit,
  });

  const selectionDisposable = term.onSelectionChange(() => {
    const selected = term.getSelection().length > 0;
    setHasSelection(selected);
    if (!selected) {
      setSelectionOverlay(null);
      setInputToolbarAnchor(null);
      return;
    }
    const range = getTerminalSelectionRange(term);
    if (range) {
      setSelectionOverlay((prev) => (prev ? { ...prev, range } : prev));
    }
  });

  return () => {
    cleanupTapGestures();
    cleanupTouchWheel();
    cleanupTouchSelection();
    selectionDisposable.dispose();
  };
}

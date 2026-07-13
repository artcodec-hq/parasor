import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import type { TerminalSelectionAction } from "./TerminalSelectionOverlay.js";
import { attachTerminalToolbarDismissLifecycle } from "./terminal-toolbar-dismiss-lifecycle.js";

const TOOLBAR_SYNTHETIC_MOUSE_SUPPRESS_MS = 700;

type InputToolbarAnchor = {
  clientX: number;
  clientY: number;
} | null;

type UseTerminalToolbarInteractionsArgs = {
  sessionId: string;
  inputToolbarAnchorRef: RefObject<InputToolbarAnchor>;
  setInputToolbarAnchor: (anchor: null) => void;
};

type ToolbarActionEvent = {
  action: TerminalSelectionAction;
  eventType: string;
  deduped: boolean;
};

export function useTerminalToolbarInteractions({
  sessionId,
  inputToolbarAnchorRef,
  setInputToolbarAnchor,
}: UseTerminalToolbarInteractionsArgs): {
  inputToolbarDismissSuppressUntilRef: RefObject<number>;
  toolbarSyntheticMouseSuppressUntilRef: RefObject<number>;
  handleToolbarActionEvent: (input: ToolbarActionEvent) => void;
} {
  const inputToolbarDismissSuppressUntilRef = useRef(0);
  const toolbarSyntheticMouseSuppressUntilRef = useRef(0);

  useEffect(() => {
    return attachTerminalToolbarDismissLifecycle({
      sessionId,
      inputToolbarAnchorRef,
      inputToolbarDismissSuppressUntilRef,
      setInputToolbarAnchor,
    });
  }, [inputToolbarAnchorRef, sessionId, setInputToolbarAnchor]);

  const handleToolbarActionEvent = useCallback(
    (input: ToolbarActionEvent) => {
      if (!input.deduped) {
        toolbarSyntheticMouseSuppressUntilRef.current =
          performance.now() + TOOLBAR_SYNTHETIC_MOUSE_SUPPRESS_MS;
      }
      traceTerminalEvent("terminal-toolbar-action", {
        sessionId,
        surface: input.action,
        status: input.eventType,
        skipped: input.deduped,
      });
    },
    [sessionId],
  );

  return {
    inputToolbarDismissSuppressUntilRef,
    toolbarSyntheticMouseSuppressUntilRef,
    handleToolbarActionEvent,
  };
}

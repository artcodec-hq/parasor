import type { MutableRefObject } from "react";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";

const INPUT_TOOLBAR_DISMISS_SUPPRESS_MS = 800;

type InputToolbarAnchor = {
  clientX: number;
  clientY: number;
} | null;

export function attachTerminalToolbarDismissLifecycle({
  sessionId,
  inputToolbarAnchorRef,
  inputToolbarDismissSuppressUntilRef,
  setInputToolbarAnchor,
}: {
  sessionId: string;
  inputToolbarAnchorRef: MutableRefObject<InputToolbarAnchor>;
  inputToolbarDismissSuppressUntilRef: MutableRefObject<number>;
  setInputToolbarAnchor: (anchor: null) => void;
}) {
  const closeInputToolbarFromOutside = (event: Event) => {
    if (!inputToolbarAnchorRef.current) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    const toolbar = document.querySelector(
      '[role="toolbar"][aria-label="Terminal selection actions"]',
    );
    if (toolbar?.contains(target)) return;
    inputToolbarDismissSuppressUntilRef.current =
      performance.now() + INPUT_TOOLBAR_DISMISS_SUPPRESS_MS;
    setInputToolbarAnchor(null);
    traceTerminalEvent("terminal-toolbar-dismiss", {
      sessionId,
      surface: "paste",
      status: event.type,
    });
  };

  document.addEventListener("pointerdown", closeInputToolbarFromOutside, {
    capture: true,
  });
  document.addEventListener("touchstart", closeInputToolbarFromOutside, {
    capture: true,
  });
  document.addEventListener("mousedown", closeInputToolbarFromOutside, {
    capture: true,
  });

  return () => {
    document.removeEventListener("pointerdown", closeInputToolbarFromOutside, {
      capture: true,
    });
    document.removeEventListener("touchstart", closeInputToolbarFromOutside, {
      capture: true,
    });
    document.removeEventListener("mousedown", closeInputToolbarFromOutside, {
      capture: true,
    });
  };
}

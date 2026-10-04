import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import { attachTerminalDomDiagnostics } from "./terminal-dom-diagnostics.js";

export function attachTerminalDomLifecycle({
  sessionId,
  textarea,
  screenElement,
  toolbarSyntheticMouseSuppressUntilRef,
}: {
  sessionId: string;
  textarea: HTMLTextAreaElement | undefined;
  screenElement: Element | null;
  toolbarSyntheticMouseSuppressUntilRef: { current: number };
}) {
  const suppressSyntheticMouseAfterToolbarAction = (event: Event) => {
    if (performance.now() > toolbarSyntheticMouseSuppressUntilRef.current) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    traceTerminalEvent("terminal-toolbar-synthetic-mouse-suppressed", {
      sessionId,
      status: event.type,
      surface:
        event.target instanceof Element
          ? event.target.className.toString()
          : undefined,
    });
  };

  screenElement?.addEventListener(
    "mousedown",
    suppressSyntheticMouseAfterToolbarAction,
    { capture: true },
  );
  screenElement?.addEventListener(
    "click",
    suppressSyntheticMouseAfterToolbarAction,
    { capture: true },
  );
  const cleanupDomDiagnostics = attachTerminalDomDiagnostics({
    sessionId,
    textarea,
    screenElement,
  });

  return () => {
    screenElement?.removeEventListener(
      "mousedown",
      suppressSyntheticMouseAfterToolbarAction,
      { capture: true },
    );
    screenElement?.removeEventListener(
      "click",
      suppressSyntheticMouseAfterToolbarAction,
      { capture: true },
    );
    cleanupDomDiagnostics();
  };
}

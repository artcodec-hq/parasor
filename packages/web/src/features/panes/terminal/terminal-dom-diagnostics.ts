import {
  isTerminalTraceEnabled,
  traceTerminalEvent,
} from "../../../lib/terminal-trace.js";

type AttachTerminalDomDiagnosticsArgs = {
  sessionId: string;
  textarea: HTMLTextAreaElement | undefined;
  screenElement: Element | null;
};

export function attachTerminalDomDiagnostics({
  sessionId,
  textarea,
  screenElement,
}: AttachTerminalDomDiagnosticsArgs): () => void {
  if (!isTerminalTraceEnabled()) return () => {};

  const traceDomInputEvent = (event: Event) => {
    const inputEvent = event as InputEvent;
    traceTerminalEvent(`dom-${event.type}`, {
      sessionId,
      dataLength:
        typeof inputEvent.data === "string" ? inputEvent.data.length : 0,
      inputType:
        typeof inputEvent.inputType === "string"
          ? inputEvent.inputType
          : undefined,
      isComposing:
        typeof inputEvent.isComposing === "boolean"
          ? inputEvent.isComposing
          : undefined,
    });
  };

  const traceDomKeyEvent = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    traceTerminalEvent(`dom-${event.type}`, {
      sessionId,
      dataLength: typeof keyEvent.key === "string" ? keyEvent.key.length : 0,
      isComposing: keyEvent.isComposing,
    });
  };

  const traceTextareaFocusState = (event: Event) => {
    traceTerminalEvent(`dom-${event.type}`, {
      sessionId,
      surface: "xterm-textarea",
      visible: document.activeElement === textarea,
    });
  };

  const traceTerminalSurfaceEvent = (event: Event) => {
    traceTerminalEvent("terminal-surface-event", {
      sessionId,
      status: event.type,
      surface:
        event.target instanceof Element
          ? event.target.className.toString()
          : undefined,
      visible: document.activeElement === textarea,
      skipped: event.defaultPrevented,
    });
  };

  textarea?.addEventListener("focus", traceTextareaFocusState);
  textarea?.addEventListener("blur", traceTextareaFocusState);
  textarea?.addEventListener("keydown", traceDomKeyEvent);
  textarea?.addEventListener("beforeinput", traceDomInputEvent);
  textarea?.addEventListener("input", traceDomInputEvent);
  textarea?.addEventListener("compositionstart", traceDomInputEvent);
  textarea?.addEventListener("compositionupdate", traceDomInputEvent);
  textarea?.addEventListener("compositionend", traceDomInputEvent);
  screenElement?.addEventListener("pointerdown", traceTerminalSurfaceEvent, {
    capture: true,
  });
  screenElement?.addEventListener("pointerup", traceTerminalSurfaceEvent, {
    capture: true,
  });
  screenElement?.addEventListener("touchstart", traceTerminalSurfaceEvent, {
    capture: true,
  });
  screenElement?.addEventListener("touchend", traceTerminalSurfaceEvent, {
    capture: true,
  });
  screenElement?.addEventListener("mousedown", traceTerminalSurfaceEvent, {
    capture: true,
  });
  screenElement?.addEventListener("click", traceTerminalSurfaceEvent, {
    capture: true,
  });

  return () => {
    textarea?.removeEventListener("focus", traceTextareaFocusState);
    textarea?.removeEventListener("blur", traceTextareaFocusState);
    textarea?.removeEventListener("keydown", traceDomKeyEvent);
    textarea?.removeEventListener("beforeinput", traceDomInputEvent);
    textarea?.removeEventListener("input", traceDomInputEvent);
    textarea?.removeEventListener("compositionstart", traceDomInputEvent);
    textarea?.removeEventListener("compositionupdate", traceDomInputEvent);
    textarea?.removeEventListener("compositionend", traceDomInputEvent);
    screenElement?.removeEventListener(
      "pointerdown",
      traceTerminalSurfaceEvent,
      { capture: true },
    );
    screenElement?.removeEventListener("pointerup", traceTerminalSurfaceEvent, {
      capture: true,
    });
    screenElement?.removeEventListener(
      "touchstart",
      traceTerminalSurfaceEvent,
      { capture: true },
    );
    screenElement?.removeEventListener("touchend", traceTerminalSurfaceEvent, {
      capture: true,
    });
    screenElement?.removeEventListener("mousedown", traceTerminalSurfaceEvent, {
      capture: true,
    });
    screenElement?.removeEventListener("click", traceTerminalSurfaceEvent, {
      capture: true,
    });
  };
}

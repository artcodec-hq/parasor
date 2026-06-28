import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject } from "react";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import type { TerminalRendererFontEvent } from "./terminal-renderer-fonts.js";
import type { TerminalRendererTrace } from "./terminal-trace-snapshot.js";

type CreateTerminalRendererFontEventHandlerArgs = {
  sessionId: string;
  term: XTerm;
  rendererTraceRef: MutableRefObject<TerminalRendererTrace | null>;
  getFallbackFontFamily: () => string;
};

export function createTerminalRendererFontEventHandler({
  sessionId,
  term,
  rendererTraceRef,
  getFallbackFontFamily,
}: CreateTerminalRendererFontEventHandlerArgs): (
  event: TerminalRendererFontEvent,
) => void {
  const emitRendererTrace = (type: string) => {
    const renderer = rendererTraceRef.current;
    traceTerminalEvent(type, {
      sessionId,
      requestedWebgl: renderer?.requestedWebgl,
      effectiveRenderer: renderer?.effectiveRenderer,
      webglStatus: renderer?.webglStatus,
      webglFailureReason: renderer?.webglFailureReason,
      contextLossCount: renderer?.contextLossCount,
      fontLoadingDoneCount: renderer?.fontLoadingDoneCount,
      atlasRebuildCount: renderer?.atlasRebuildCount,
      iosFontPrefetchStatus: renderer?.iosFontPrefetchStatus,
      unicodeVersion: renderer?.unicodeVersion,
      isTouch: renderer?.isTouch,
      isIos: renderer?.isIos,
    });
  };

  return (event) => {
    const renderer = rendererTraceRef.current;
    if (!renderer) return;
    switch (event.type) {
      case "webgl-skip":
        renderer.requestedWebgl = false;
        renderer.effectiveRenderer = "dom";
        renderer.webglStatus = "disabled";
        renderer.webglFailureReason = event.reason;
        emitRendererTrace("terminal-renderer-webgl-skip");
        break;
      case "webgl-attach":
        renderer.effectiveRenderer = "webgl";
        renderer.webglStatus = "attached";
        renderer.webglFailureReason = undefined;
        emitRendererTrace("terminal-renderer-webgl-attach");
        break;
      case "webgl-error":
        renderer.effectiveRenderer = "dom";
        renderer.webglStatus = "failed";
        renderer.webglFailureReason = event.reason;
        emitRendererTrace("terminal-renderer-webgl-error");
        break;
      case "webgl-context-loss":
        renderer.effectiveRenderer = "dom";
        renderer.webglStatus = "context-lost";
        renderer.contextLossCount += 1;
        emitRendererTrace("terminal-renderer-webgl-context-loss");
        break;
      case "font-loadingdone":
        renderer.fontLoadingDoneCount += 1;
        renderer.atlasRebuildCount += 1;
        renderer.fontFamily =
          term.options.fontFamily ?? getFallbackFontFamily();
        emitRendererTrace("terminal-renderer-font-loadingdone");
        break;
      case "ios-font-prefetch":
        renderer.iosFontPrefetchStatus = event.status;
        emitRendererTrace("terminal-renderer-ios-font-prefetch");
        break;
    }
  };
}

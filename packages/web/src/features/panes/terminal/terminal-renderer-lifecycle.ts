import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject } from "react";
import { attachWebglRendererAndFontAtlas } from "./terminal-renderer-fonts.js";
import { createTerminalRendererFontEventHandler } from "./terminal-renderer-trace-events.js";
import type { TerminalRendererTrace } from "./terminal-trace-snapshot.js";

export function attachTerminalRendererLifecycle({
  sessionId,
  term,
  rendererTraceRef,
  getFallbackFontFamily,
  isIos,
  enableWebgl,
}: {
  sessionId: string;
  term: XTerm;
  rendererTraceRef: MutableRefObject<TerminalRendererTrace | null>;
  getFallbackFontFamily: () => string;
  isIos: boolean;
  enableWebgl: boolean;
}) {
  const onRendererFontEvent = createTerminalRendererFontEventHandler({
    sessionId,
    term,
    rendererTraceRef,
    getFallbackFontFamily,
  });

  return attachWebglRendererAndFontAtlas(term, {
    isIos,
    enableWebgl,
    onEvent: onRendererFontEvent,
  });
}

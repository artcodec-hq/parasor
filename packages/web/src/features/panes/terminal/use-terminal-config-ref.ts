import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject } from "react";
import { useCallback, useRef } from "react";
import type { TerminalRendererTrace } from "./terminal-trace-snapshot.js";

export type TerminalConfigRefValue = {
  fontFamily: string;
  fontSize: number;
  theme: XTerm["options"]["theme"];
};

export function useTerminalConfigRef({
  fontFamily,
  fontSize,
  theme,
  rendererTraceRef,
}: {
  fontFamily: string;
  fontSize: number;
  theme: XTerm["options"]["theme"];
  rendererTraceRef: MutableRefObject<TerminalRendererTrace | null>;
}): {
  terminalConfigRef: MutableRefObject<TerminalConfigRefValue>;
  getTerminalConfig: () => TerminalConfigRefValue;
  getFallbackFontFamily: () => string;
} {
  const terminalConfigRef = useRef({
    fontFamily,
    fontSize,
    theme,
  });
  terminalConfigRef.current = {
    fontFamily,
    fontSize,
    theme,
  };
  if (rendererTraceRef.current) {
    rendererTraceRef.current.fontFamily = fontFamily;
    rendererTraceRef.current.fontSize = fontSize;
  }
  const getTerminalConfig = useCallback(() => terminalConfigRef.current, []);
  const getFallbackFontFamily = useCallback(
    () => terminalConfigRef.current.fontFamily,
    [],
  );

  return {
    terminalConfigRef,
    getTerminalConfig,
    getFallbackFontFamily,
  };
}

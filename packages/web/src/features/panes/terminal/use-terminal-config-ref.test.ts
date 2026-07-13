import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TerminalRendererTrace } from "./terminal-trace-snapshot.js";
import { useTerminalConfigRef } from "./use-terminal-config-ref.js";

function makeRendererTrace(): TerminalRendererTrace {
  return {
    requestedWebgl: false,
    effectiveRenderer: "dom",
    webglStatus: "disabled",
    contextLossCount: 0,
    fontLoadingDoneCount: 0,
    atlasRebuildCount: 0,
    iosFontPrefetchStatus: "not-ios",
    unicodeVersion: "11",
    isTouch: false,
    isIos: false,
    fontFamily: "old",
    fontSize: 11,
  };
}

describe("useTerminalConfigRef", () => {
  it("keeps the terminal config ref current across setting changes", () => {
    const rendererTraceRef = { current: null };
    const { result, rerender } = renderHook(
      ({ fontFamily, fontSize, theme }) =>
        useTerminalConfigRef({
          fontFamily,
          fontSize,
          theme,
          rendererTraceRef,
        }),
      {
        initialProps: {
          fontFamily: "mono",
          fontSize: 13,
          theme: { background: "#000" },
        },
      },
    );

    const configRef = result.current.terminalConfigRef;
    expect(result.current.getTerminalConfig()).toEqual({
      fontFamily: "mono",
      fontSize: 13,
      theme: { background: "#000" },
    });
    expect(result.current.getFallbackFontFamily()).toBe("mono");

    rerender({
      fontFamily: "serif",
      fontSize: 15,
      theme: { background: "#111" },
    });

    expect(result.current.terminalConfigRef).toBe(configRef);
    expect(result.current.getTerminalConfig()).toEqual({
      fontFamily: "serif",
      fontSize: 15,
      theme: { background: "#111" },
    });
    expect(result.current.getFallbackFontFamily()).toBe("serif");
  });

  it("mirrors font settings into the renderer trace when present", () => {
    const rendererTraceRef = { current: makeRendererTrace() };

    renderHook(() =>
      useTerminalConfigRef({
        fontFamily: "mono",
        fontSize: 14,
        theme: {},
        rendererTraceRef,
      }),
    );

    expect(rendererTraceRef.current?.fontFamily).toBe("mono");
    expect(rendererTraceRef.current?.fontSize).toBe(14);
  });
});

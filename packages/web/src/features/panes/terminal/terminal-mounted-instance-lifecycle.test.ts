import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { attachTerminalMountedInstance } from "./terminal-mounted-instance-lifecycle.js";
import type { TerminalRendererTrace } from "./terminal-trace-snapshot.js";

describe("attachTerminalMountedInstance", () => {
  it("binds the active xterm and fit refs and resets output for mount", () => {
    const term = { dispose: vi.fn() } as unknown as XTerm;
    const fitAddon = {} as FitAddon;
    const xtermRef = { current: null as XTerm | null };
    const fitRef = { current: null as FitAddon | null };
    const rendererTraceRef = {
      current: {} as TerminalRendererTrace | null,
    };
    const resetOutputPipeline = vi.fn();

    attachTerminalMountedInstance({
      term,
      fitAddon,
      xtermRef,
      fitRef,
      rendererTraceRef,
      resetOutputPipeline,
    });

    expect(xtermRef.current).toBe(term);
    expect(fitRef.current).toBe(fitAddon);
    expect(resetOutputPipeline).toHaveBeenCalledWith(false);
  });

  it("resets output before unmount cleanup and clears refs after dispose", () => {
    const term = { dispose: vi.fn() } as unknown as XTerm;
    const fitAddon = {} as FitAddon;
    const xtermRef = { current: null as XTerm | null };
    const fitRef = { current: null as FitAddon | null };
    const rendererTraceRef = {
      current: {} as TerminalRendererTrace | null,
    };
    const resetOutputPipeline = vi.fn();
    const mountedInstance = attachTerminalMountedInstance({
      term,
      fitAddon,
      xtermRef,
      fitRef,
      rendererTraceRef,
      resetOutputPipeline,
    });

    mountedInstance.resetOutputPipelineForUnmount();
    mountedInstance.dispose();

    expect(resetOutputPipeline).toHaveBeenNthCalledWith(1, false);
    expect(resetOutputPipeline).toHaveBeenNthCalledWith(2, true);
    expect(term.dispose).toHaveBeenCalledTimes(1);
    expect(xtermRef.current).toBeNull();
    expect(fitRef.current).toBeNull();
    expect(rendererTraceRef.current).toBeNull();
  });
});

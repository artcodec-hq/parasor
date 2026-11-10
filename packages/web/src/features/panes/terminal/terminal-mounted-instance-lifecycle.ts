import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject } from "react";
import type { TerminalRendererTrace } from "./terminal-trace-snapshot.js";

export function attachTerminalMountedInstance({
  term,
  fitAddon,
  xtermRef,
  fitRef,
  rendererTraceRef,
  resetOutputPipeline,
}: {
  term: XTerm;
  fitAddon: FitAddon;
  xtermRef: MutableRefObject<XTerm | null>;
  fitRef: MutableRefObject<FitAddon | null>;
  rendererTraceRef: MutableRefObject<TerminalRendererTrace | null>;
  resetOutputPipeline: (resumeIfPaused: boolean) => void;
}) {
  xtermRef.current = term;
  fitRef.current = fitAddon;
  resetOutputPipeline(false);

  return {
    resetOutputPipelineForUnmount: () => resetOutputPipeline(true),
    dispose: () => {
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      rendererTraceRef.current = null;
    },
  };
}

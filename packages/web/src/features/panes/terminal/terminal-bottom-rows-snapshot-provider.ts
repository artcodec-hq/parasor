import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject } from "react";
import { registerTerminalBottomRowsSnapshotProvider } from "../../../lib/terminal-trace.js";
import {
  type TerminalRendererTrace,
  terminalBottomRowsTrace,
} from "./terminal-trace-snapshot.js";

type AttachTerminalBottomRowsSnapshotProviderArgs = {
  sessionId: string;
  paneId: string | undefined;
  term: XTerm;
  getActiveTerm: () => XTerm | null;
  rendererTraceRef: MutableRefObject<TerminalRendererTrace | null>;
};

export function attachTerminalBottomRowsSnapshotProvider({
  sessionId,
  paneId,
  term,
  getActiveTerm,
  rendererTraceRef,
}: AttachTerminalBottomRowsSnapshotProviderArgs): {
  markActive: () => void;
  dispose: () => void;
} {
  const bottomRowsSnapshotProvider = (rowCount?: number) =>
    getActiveTerm() === term
      ? terminalBottomRowsTrace(
          term,
          rowCount,
          rendererTraceRef.current ?? undefined,
        )
      : null;

  let unregister = registerTerminalBottomRowsSnapshotProvider(
    bottomRowsSnapshotProvider,
    { sessionId, paneId },
  );

  const markActive = () => {
    unregister();
    unregister = registerTerminalBottomRowsSnapshotProvider(
      bottomRowsSnapshotProvider,
      { sessionId, paneId },
    );
  };

  return {
    markActive,
    dispose: () => unregister(),
  };
}

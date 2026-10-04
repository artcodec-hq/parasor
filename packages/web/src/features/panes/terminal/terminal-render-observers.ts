import type { Terminal as XTerm } from "@xterm/xterm";
import { traceTerminalEventLazy } from "../../../lib/terminal-trace.js";
import { terminalBufferTrace } from "./terminal-trace-snapshot.js";

const SYNCHRONIZED_CURSOR_REFRESH_MAX_WAIT_MS = 1200;

type Disposable = {
  dispose: () => void;
};

type ObservableTerminal = XTerm & {
  onRender?: XTerm["onRender"];
  onCursorMove?: XTerm["onCursorMove"];
};

type AttachTerminalRenderObserversArgs = {
  sessionId: string;
  term: XTerm;
  getActiveTerm: () => XTerm | null;
  refreshVisibleRows: (term: XTerm) => void;
};

export function attachTerminalRenderObservers({
  sessionId,
  term,
  getActiveTerm,
  refreshVisibleRows,
}: AttachTerminalRenderObserversArgs): () => void {
  const maybeTerm = term as ObservableTerminal;
  const renderDisposable: Disposable =
    typeof maybeTerm.onRender === "function"
      ? maybeTerm.onRender(({ start, end }) => {
          traceTerminalEventLazy("xterm-render", () => ({
            sessionId,
            renderStart: start,
            renderEnd: end,
            ...terminalBufferTrace(term),
          }));
        })
      : { dispose: () => {} };

  let synchronizedCursorRefreshFrame: number | null = null;
  let synchronizedCursorRefreshStartedAt = 0;

  const cancelSynchronizedCursorRefresh = () => {
    if (synchronizedCursorRefreshFrame === null) return;
    cancelAnimationFrame(synchronizedCursorRefreshFrame);
    synchronizedCursorRefreshFrame = null;
  };

  const runSynchronizedCursorRefresh = () => {
    synchronizedCursorRefreshFrame = null;
    if (getActiveTerm() !== term) return;
    if (
      term.modes.synchronizedOutputMode &&
      performance.now() - synchronizedCursorRefreshStartedAt <
        SYNCHRONIZED_CURSOR_REFRESH_MAX_WAIT_MS
    ) {
      synchronizedCursorRefreshFrame = requestAnimationFrame(
        runSynchronizedCursorRefresh,
      );
      return;
    }
    refreshVisibleRows(term);
  };

  const scheduleSynchronizedCursorRefresh = () => {
    if (synchronizedCursorRefreshFrame !== null) return;
    synchronizedCursorRefreshStartedAt = performance.now();
    synchronizedCursorRefreshFrame = requestAnimationFrame(
      runSynchronizedCursorRefresh,
    );
  };

  const cursorMoveDisposable: Disposable =
    typeof maybeTerm.onCursorMove === "function"
      ? maybeTerm.onCursorMove(() => {
          traceTerminalEventLazy("xterm-cursor-move", () => ({
            sessionId,
            ...terminalBufferTrace(term),
          }));
          if (term.modes.synchronizedOutputMode) {
            scheduleSynchronizedCursorRefresh();
          }
        })
      : { dispose: () => {} };

  return () => {
    cancelSynchronizedCursorRefresh();
    renderDisposable.dispose();
    cursorMoveDisposable.dispose();
  };
}

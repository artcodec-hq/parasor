import type { Terminal as XTerm } from "@xterm/xterm";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";

const HISTORY_LOAD_TOP_THRESHOLD_ROWS = 2;
const SCROLL_DOWN_THRESHOLD_ROWS = 3;

export function attachTerminalScrollState({
  sessionId,
  term,
  replayRestoringRef,
  keyboardSettlingRef,
  keyboardHistoryLoadSuppressUntilRef,
  historyTopLoadArmedRef,
  setShowScrollDown,
  refreshSelectionOverlayLayout,
  loadOlderHistory,
}: {
  sessionId: string;
  term: XTerm;
  replayRestoringRef: { current: boolean };
  keyboardSettlingRef: { current: boolean };
  keyboardHistoryLoadSuppressUntilRef: { current: number };
  historyTopLoadArmedRef: { current: boolean };
  setShowScrollDown: (visible: boolean) => void;
  refreshSelectionOverlayLayout: () => void;
  loadOlderHistory: () => void | Promise<void>;
}) {
  let pendingScrollFrame: number | null = null;
  const updateScrollState = () => {
    if (pendingScrollFrame !== null) return;
    pendingScrollFrame = requestAnimationFrame(() => {
      pendingScrollFrame = null;
      const buf = term.buffer.active;
      if (replayRestoringRef.current) {
        traceTerminalEvent("terminal-scroll-state", {
          sessionId,
          viewportY: buf.viewportY,
          baseY: buf.baseY,
          reason: "replay-restoring",
        });
        return;
      }
      setShowScrollDown(buf.baseY - buf.viewportY > SCROLL_DOWN_THRESHOLD_ROWS);
      refreshSelectionOverlayLayout();
      traceTerminalEvent("terminal-scroll-state", {
        sessionId,
        viewportY: buf.viewportY,
        baseY: buf.baseY,
        deferred: keyboardSettlingRef.current,
        reason: historyTopLoadArmedRef.current ? "armed" : "observed",
      });
      if (buf.viewportY > HISTORY_LOAD_TOP_THRESHOLD_ROWS) {
        historyTopLoadArmedRef.current = true;
      } else if (historyTopLoadArmedRef.current) {
        if (
          keyboardSettlingRef.current ||
          performance.now() < keyboardHistoryLoadSuppressUntilRef.current
        ) {
          traceTerminalEvent("terminal-history-load-suppressed", {
            sessionId,
            viewportY: buf.viewportY,
            baseY: buf.baseY,
            reason: "keyboard-settle",
          });
          return;
        }
        historyTopLoadArmedRef.current = false;
        void loadOlderHistory();
      }
    });
  };

  const scrollDisposable = term.onScroll(updateScrollState);
  updateScrollState();

  return () => {
    scrollDisposable.dispose();
    if (pendingScrollFrame !== null) {
      cancelAnimationFrame(pendingScrollFrame);
      pendingScrollFrame = null;
    }
  };
}

import type { WsTerminalClientMessage } from "@parasor/shared";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  scheduleTerminalInputDiagnosticCapture,
  traceTerminalEvent,
} from "../../../lib/terminal-trace.js";
import { captureScrollAnchor } from "./terminal-scroll-anchor.js";
import { terminalBufferTrace } from "./terminal-trace-snapshot.js";

const FIT_MIN_COLS = 2;
const FIT_MIN_ROWS = 1;
const RESIZE_DEBOUNCE_MS = 100;
const RESIZE_OUTPUT_FLUSH_MAX_WAIT_MS = 120;

type SendTerminalMessage = (msg: WsTerminalClientMessage) => void;

type TerminalConfig = {
  fontFamily: string;
  fontSize: number;
  theme: XTerm["options"]["theme"];
};

type UseTerminalViewportLifecycleArgs = {
  sessionId: string;
  isEnded: boolean;
  terminalConfig: TerminalConfig;
  xtermRef: RefObject<XTerm | null>;
  fitRef: RefObject<FitAddon | null>;
  flushPendingOutput: (onFlushed?: () => void) => boolean;
  keyboardSettling: boolean;
  /** Touch-primary device -- a row-shrinking resize there is the keyboard. */
  isTouch: boolean;
  firstDataTimerRef: MutableRefObject<number | null>;
  hasReceivedDataRef: RefObject<boolean>;
  onResizeProposed?: (proposal: {
    cols: number;
    rows: number;
    preferBottom: boolean;
  }) => void;
  send: SendTerminalMessage;
  sendInit: (cols: number, rows: number) => void;
  setLastForegroundAtMs: (value: number) => void;
};

type AttachViewportLifecycleArgs = {
  container: HTMLElement;
  term: XTerm;
  fitAddon: FitAddon;
  onInitCommitted?: () => void;
};

type ViewportLifecycleCleanup = () => void;

function isValidProposedDimensions(
  proposed: { cols: number; rows: number } | undefined,
): proposed is { cols: number; rows: number } {
  return (
    proposed != null &&
    Number.isFinite(proposed.cols) &&
    Number.isFinite(proposed.rows) &&
    proposed.cols > FIT_MIN_COLS &&
    proposed.rows > FIT_MIN_ROWS
  );
}

export function useTerminalViewportLifecycle({
  sessionId,
  isEnded,
  terminalConfig,
  xtermRef,
  fitRef,
  flushPendingOutput,
  keyboardSettling,
  isTouch,
  firstDataTimerRef,
  hasReceivedDataRef,
  onResizeProposed,
  send,
  sendInit,
  setLastForegroundAtMs,
}: UseTerminalViewportLifecycleArgs): {
  attachViewportLifecycle: (
    args: AttachViewportLifecycleArgs,
  ) => ViewportLifecycleCleanup;
  applyTerminalConfig: () => void;
  claimViewport: (reason: string) => void;
} {
  const initCommittedRef = useRef(false);
  const keyboardSettlingRef = useRef(keyboardSettling);
  const isTouchRef = useRef(isTouch);
  const flushDeferredResizeRef = useRef<(() => void) | null>(null);
  const claimViewportRef = useRef<((reason: string) => void) | null>(null);
  keyboardSettlingRef.current = keyboardSettling;
  isTouchRef.current = isTouch;

  useEffect(() => {
    if (!keyboardSettling) {
      flushDeferredResizeRef.current?.();
    }
  }, [keyboardSettling]);

  const clearFirstDataTimer = useCallback(() => {
    if (firstDataTimerRef.current === null) return;
    clearTimeout(firstDataTimerRef.current);
    firstDataTimerRef.current = null;
  }, [firstDataTimerRef]);

  const attachViewportLifecycle = useCallback(
    ({
      container,
      term,
      fitAddon,
      onInitCommitted,
    }: AttachViewportLifecycleArgs): ViewportLifecycleCleanup => {
      initCommittedRef.current = false;
      clearFirstDataTimer();

      let initFallbackTimer: number | null = null;

      const clearInitFallbackTimer = () => {
        if (initFallbackTimer === null) return;
        clearTimeout(initFallbackTimer);
        initFallbackTimer = null;
      };

      const sendResize = (
        dimensions: { cols: number; rows: number } = term,
      ): boolean => {
        if (isEnded) return false;
        send({
          type: "resize",
          cols: dimensions.cols,
          rows: dimensions.rows,
        });
        return true;
      };

      const commitInit = () => {
        if (initCommittedRef.current) return;
        initCommittedRef.current = true;
        clearInitFallbackTimer();
        fitAddon.fit();
        onInitCommitted?.();

        if (!isEnded) {
          traceTerminalEvent("terminal-init-commit", {
            sessionId,
            cols: term.cols,
            rows: term.rows,
          });
          sendInit(term.cols, term.rows);
          // Mount is an active pane selection. Attach stays passive, while the
          // explicit claim is replay-fenced by the socket before it reaches PTY.
          const ptyResizeSent = sendResize();
          traceTerminalEvent("terminal-viewport-claim", {
            sessionId,
            reason: "mount",
            cols: term.cols,
            rows: term.rows,
            ptyResizeSent,
          });
          firstDataTimerRef.current = window.setTimeout(() => {
            firstDataTimerRef.current = null;
            if (!hasReceivedDataRef.current) {
              send({ type: "refresh" });
            }
          }, 500);
        }
      };

      const hasValidProposedDimensions = (): boolean => {
        if (container.clientWidth <= 0 || container.clientHeight <= 0) {
          return false;
        }
        const proposed = fitAddon.proposeDimensions();
        return isValidProposedDimensions(proposed);
      };

      if (hasValidProposedDimensions()) {
        commitInit();
      } else {
        initFallbackTimer = window.setTimeout(() => {
          initFallbackTimer = null;
          commitInit();
        }, 500);
      }

      let resizeTimer: number | null = null;
      let resizeAfterFlushFrame: number | null = null;
      let keyboardResizeDeferred = false;
      let lastResizeProposal: { cols: number; rows: number } | null = null;
      const clearResizeTimer = () => {
        if (resizeTimer === null) return;
        clearTimeout(resizeTimer);
        resizeTimer = null;
      };
      const clearResizeAfterFlushFrame = () => {
        if (resizeAfterFlushFrame === null) return;
        cancelAnimationFrame(resizeAfterFlushFrame);
        resizeAfterFlushFrame = null;
      };
      // forceClaim: push this device's size to the shared PTY even if the local
      // xterm is already that size. Needed on engagement (cursor-enter /
      // foreground) because the PTY may currently hold ANOTHER device's width --
      // the local "unchanged" check alone would never reclaim it.
      const applyResize = (
        forceClaim = false,
        outputFlushStartedAt: number | null = null,
        captureDiagnostics = true,
        flushOutputBeforeResize = true,
      ) => {
        const startedAt = performance.now();
        resizeTimer = null;
        if (container.clientWidth <= 0 || container.clientHeight <= 0) {
          traceTerminalEvent("terminal-resize-skip", {
            sessionId,
            reason: "zero-container",
            durationMs: performance.now() - startedAt,
          });
          return;
        }
        const proposeStartedAt = performance.now();
        const proposed = fitAddon.proposeDimensions();
        const proposeDurationMs = performance.now() - proposeStartedAt;
        if (!isValidProposedDimensions(proposed)) {
          traceTerminalEvent("terminal-resize-skip", {
            sessionId,
            reason: "invalid-proposed-dimensions",
            durationMs: performance.now() - startedAt,
            proposeDurationMs,
          });
          return;
        }
        if (!initCommittedRef.current) {
          traceTerminalEvent("terminal-resize-init-commit", {
            sessionId,
            proposedCols: proposed.cols,
            proposedRows: proposed.rows,
            durationMs: performance.now() - startedAt,
            proposeDurationMs,
          });
          commitInit();
          return;
        }
        const flushStartedAt = outputFlushStartedAt ?? startedAt;
        if (
          flushOutputBeforeResize &&
          performance.now() - flushStartedAt < RESIZE_OUTPUT_FLUSH_MAX_WAIT_MS
        ) {
          const flushedOutput = flushPendingOutput(() => {
            clearResizeAfterFlushFrame();
            resizeAfterFlushFrame = requestAnimationFrame(() => {
              resizeAfterFlushFrame = null;
              applyResize(
                forceClaim,
                flushStartedAt,
                captureDiagnostics,
                flushOutputBeforeResize,
              );
            });
          });
          if (flushedOutput) {
            traceTerminalEvent("terminal-resize-flush-output", {
              sessionId,
              proposedCols: proposed.cols,
              proposedRows: proposed.rows,
              durationMs: performance.now() - startedAt,
              proposeDurationMs,
            });
            return;
          }
        }
        if (proposed.cols === term.cols && proposed.rows === term.rows) {
          // A duplicate claim is server-side no-op. Do not touch xterm or its
          // viewport merely because the browser returned to foreground.
          const ptyResizeSent = forceClaim ? sendResize() : false;
          const reason = forceClaim ? "claim-unchanged" : "unchanged";
          traceTerminalEvent("terminal-resize-skip", {
            sessionId,
            cols: term.cols,
            rows: term.rows,
            proposedCols: proposed.cols,
            proposedRows: proposed.rows,
            reason,
            ptyResizeSent,
            durationMs: performance.now() - startedAt,
            proposeDurationMs,
          });
          if (forceClaim && captureDiagnostics) {
            scheduleTerminalInputDiagnosticCapture("terminal-resize-claim", {
              type: "terminal-resize-skip",
              sessionId,
              ...terminalBufferTrace(term),
              proposedCols: proposed.cols,
              proposedRows: proposed.rows,
              reason,
              ptyResizeSent,
              durationMs: performance.now() - startedAt,
              proposeDurationMs,
            });
          }
          return;
        }
        if (
          !forceClaim &&
          lastResizeProposal?.cols === proposed.cols &&
          lastResizeProposal.rows === proposed.rows
        ) {
          traceTerminalEvent("terminal-resize-skip", {
            sessionId,
            ...terminalBufferTrace(term),
            proposedCols: proposed.cols,
            proposedRows: proposed.rows,
            reason: "proposal-pending",
            ptyResizeSent: false,
            durationMs: performance.now() - startedAt,
            proposeDurationMs,
          });
          return;
        }
        const anchor = captureScrollAnchor(term);
        const preferBottom =
          (isTouchRef.current && proposed.rows < term.rows) ||
          (forceClaim && anchor.wasAtBottom);
        lastResizeProposal = { cols: proposed.cols, rows: proposed.rows };
        onResizeProposed?.({
          cols: proposed.cols,
          rows: proposed.rows,
          preferBottom,
        });
        const ptyResizeSent = sendResize(proposed);
        const resizeProposalEvent = {
          type: "terminal-resize-propose",
          sessionId,
          ...terminalBufferTrace(term),
          proposedCols: proposed.cols,
          proposedRows: proposed.rows,
          deferred: keyboardSettlingRef.current,
          reason: preferBottom ? "prefer-bottom" : "preserve-anchor",
          ptyResizeSent,
          durationMs: performance.now() - startedAt,
          proposeDurationMs,
        };
        traceTerminalEvent("terminal-resize-propose", resizeProposalEvent);
        if (captureDiagnostics) {
          scheduleTerminalInputDiagnosticCapture(
            "terminal-resize-propose",
            resizeProposalEvent,
          );
        }
      };

      const flushDeferredKeyboardResize = () => {
        if (!keyboardResizeDeferred) return;
        keyboardResizeDeferred = false;
        clearResizeTimer();
        traceTerminalEvent("terminal-resize-deferred-flush", {
          sessionId,
        });
        applyResize();
      };
      flushDeferredResizeRef.current = flushDeferredKeyboardResize;

      const observer = new ResizeObserver(() => {
        const deferred = keyboardSettlingRef.current;
        traceTerminalEvent("terminal-resize-observed", {
          sessionId,
          skipped: resizeTimer !== null || keyboardResizeDeferred,
          deferred,
          delayMs: deferred ? undefined : RESIZE_DEBOUNCE_MS,
        });
        if (deferred) {
          keyboardResizeDeferred = true;
          clearResizeTimer();
          return;
        }
        keyboardResizeDeferred = false;
        clearResizeTimer();
        resizeTimer = window.setTimeout(applyResize, RESIZE_DEBOUNCE_MS);
      });
      observer.observe(container);

      // Mount, foreground, layout resize, and input are the complete set of
      // viewport claims. The server deduplicates equal PTY geometry.
      const onForeground = () => {
        const visible = document.visibilityState === "visible";
        traceTerminalEvent("terminal-engage", {
          sessionId,
          reason: "foreground",
          surface: isTouchRef.current ? "touch" : "desktop",
          visible,
        });
        if (!visible) return;
        setLastForegroundAtMs(Date.now());
        applyResize(true);
      };
      document.addEventListener("visibilitychange", onForeground);
      window.addEventListener("focus", onForeground);
      claimViewportRef.current = (reason: string) => {
        traceTerminalEvent("terminal-engage", {
          sessionId,
          reason,
          surface: isTouchRef.current ? "touch" : "desktop",
        });
        applyResize(true, null, false, reason !== "desktop-input");
      };

      return () => {
        clearFirstDataTimer();
        clearInitFallbackTimer();
        clearResizeTimer();
        clearResizeAfterFlushFrame();
        if (flushDeferredResizeRef.current === flushDeferredKeyboardResize) {
          flushDeferredResizeRef.current = null;
        }
        if (claimViewportRef.current !== null) {
          claimViewportRef.current = null;
        }
        observer.disconnect();
        document.removeEventListener("visibilitychange", onForeground);
        window.removeEventListener("focus", onForeground);
      };
    },
    [
      clearFirstDataTimer,
      firstDataTimerRef,
      hasReceivedDataRef,
      isEnded,
      flushPendingOutput,
      onResizeProposed,
      send,
      sendInit,
      sessionId,
      setLastForegroundAtMs,
    ],
  );

  const applyTerminalConfig = useCallback(() => {
    const term = xtermRef.current;
    const fit = fitRef.current;
    if (!term) return;
    term.options.fontSize = terminalConfig.fontSize;
    term.options.fontFamily = terminalConfig.fontFamily;
    term.options.theme = terminalConfig.theme;
    const proposed = fit?.proposeDimensions();
    if (
      !isEnded &&
      isValidProposedDimensions(proposed) &&
      (proposed.cols !== term.cols || proposed.rows !== term.rows)
    ) {
      onResizeProposed?.({ ...proposed, preferBottom: false });
      send({ type: "resize", cols: proposed.cols, rows: proposed.rows });
    }
  }, [
    fitRef,
    isEnded,
    onResizeProposed,
    send,
    terminalConfig.fontFamily,
    terminalConfig.fontSize,
    terminalConfig.theme,
    xtermRef,
  ]);

  const claimViewport = useCallback((reason: string) => {
    claimViewportRef.current?.(reason);
  }, []);

  return {
    attachViewportLifecycle,
    applyTerminalConfig,
    claimViewport,
  };
}

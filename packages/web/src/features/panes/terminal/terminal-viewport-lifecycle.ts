import type { WsTerminalClientMessage } from "@parasor/shared";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  scheduleTerminalInputDiagnosticCapture,
  traceTerminalEvent,
} from "../../../lib/terminal-trace.js";
import {
  captureScrollAnchor,
  restoreScrollAnchor,
} from "./terminal-scroll-anchor.js";
import { terminalBufferTrace } from "./terminal-trace-snapshot.js";

const FIT_MIN_COLS = 2;
const FIT_MIN_ROWS = 1;
const RESIZE_DEBOUNCE_MS = 100;
// How long to keep the viewport pinned to the tail after the keyboard opens,
// so a TUI's SIGWINCH repaint settles on the input line instead of the top.
const KEYBOARD_BOTTOM_PIN_MS = 500;

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
  refreshVisibleRows: (term: XTerm) => void;
  keyboardSettling: boolean;
  /** Touch-primary device -- a row-shrinking resize there is the keyboard. */
  isTouch: boolean;
  firstDataTimerRef: MutableRefObject<number | null>;
  hasReceivedDataRef: RefObject<boolean>;
  onResizeApplied?: () => void;
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

function dimensionsChanged(
  before: { cols: number; rows: number },
  term: XTerm,
): boolean {
  return term.cols !== before.cols || term.rows !== before.rows;
}

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
  refreshVisibleRows,
  keyboardSettling,
  isTouch,
  firstDataTimerRef,
  hasReceivedDataRef,
  onResizeApplied,
  send,
  sendInit,
  setLastForegroundAtMs,
}: UseTerminalViewportLifecycleArgs): {
  attachViewportLifecycle: (
    args: AttachViewportLifecycleArgs,
  ) => ViewportLifecycleCleanup;
  applyTerminalConfig: () => void;
} {
  const initCommittedRef = useRef(false);
  const keyboardSettlingRef = useRef(keyboardSettling);
  const isTouchRef = useRef(isTouch);
  const flushDeferredResizeRef = useRef<(() => void) | null>(null);
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

      const sendResize = (): boolean => {
        if (isEnded) return false;
        send({ type: "resize", cols: term.cols, rows: term.rows });
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
          if (isTouchRef.current) {
            // On mobile, terminal mount means this pane is the foreground
            // surface. Existing running PTYs ignore passive attach dimensions,
            // so explicitly claim this viewport size.
            const ptyResizeSent = sendResize();
            traceTerminalEvent("terminal-viewport-claim", {
              sessionId,
              reason: "mount",
              cols: term.cols,
              rows: term.rows,
              ptyResizeSent,
            });
          }
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
      let keyboardResizeDeferred = false;
      // After a foreground/keyboard resize claim, a full-screen TUI
      // (codex/claude) repaints on SIGWINCH -- it clears and redraws from the
      // top, which can strand the viewport away from its input line. A single
      // scrollToBottom before that repaint is overwritten. Instead, pin the
      // viewport to the tail for a short window so it follows the repaint.
      let tailPinFrame: number | null = null;
      let tailPinUntil = 0;
      const stopTailPin = () => {
        if (tailPinFrame === null) return;
        cancelAnimationFrame(tailPinFrame);
        tailPinFrame = null;
      };
      const startTailPin = () => {
        term.scrollToBottom();
        tailPinUntil = performance.now() + KEYBOARD_BOTTOM_PIN_MS;
        if (tailPinFrame !== null) return;
        const tick = () => {
          term.scrollToBottom();
          if (performance.now() < tailPinUntil) {
            tailPinFrame = requestAnimationFrame(tick);
          } else {
            tailPinFrame = null;
          }
        };
        tailPinFrame = requestAnimationFrame(tick);
      };
      const clearResizeTimer = () => {
        if (resizeTimer === null) return;
        clearTimeout(resizeTimer);
        resizeTimer = null;
      };
      // forceClaim: push this device's size to the shared PTY even if the local
      // xterm is already that size. Needed on engagement (cursor-enter /
      // foreground) because the PTY may currently hold ANOTHER device's width --
      // the local "unchanged" check alone would never reclaim it.
      const applyResize = (forceClaim = false) => {
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
        if (proposed.cols === term.cols && proposed.rows === term.rows) {
          // Local size already matches, but on engagement still (re)claim the
          // shared PTY -- it may be sized for another connected device.
          const anchor = captureScrollAnchor(term);
          if (forceClaim && anchor.wasAtBottom) startTailPin();
          const ptyResizeSent = forceClaim ? sendResize() : false;
          refreshVisibleRows(term);
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
          if (forceClaim) {
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
        const anchor = captureScrollAnchor(term);
        const rowsBeforeResize = term.rows;
        const resizeStartedAt = performance.now();
        term.resize(proposed.cols, proposed.rows);
        const resizeDurationMs = performance.now() - resizeStartedAt;
        // On a touch device, a row-shrinking resize is the on-screen keyboard
        // opening -- the user is entering input mode, so pin to the live tail
        // (input cursor) regardless of prior scroll position. This also
        // re-engages xterm's tail-following, so the PTY's SIGWINCH redraw keeps
        // the viewport at the bottom instead of the program's repaint scrolling
        // it to the top. Keyboard close (rows grow) and desktop resizes fall
        // through to anchor restore, preserving the reading position.
        const keyboardOpening =
          isTouchRef.current && proposed.rows < rowsBeforeResize;
        const foregroundBottomClaim = forceClaim && anchor.wasAtBottom;
        let reason: string;
        let targetViewportY: number | undefined;
        if (keyboardOpening) {
          startTailPin();
          reason = "keyboard-open-bottom";
          targetViewportY = undefined;
        } else if (foregroundBottomClaim) {
          startTailPin();
          reason = "foreground-bottom";
          targetViewportY = undefined;
        } else {
          const restore = restoreScrollAnchor(term, anchor);
          reason = restore.reason;
          targetViewportY =
            restore.reason === "anchor-changed"
              ? restore.targetViewportY
              : undefined;
        }
        onResizeApplied?.();
        refreshVisibleRows(term);
        const ptyResizeSent = sendResize();
        const resizeApplyEvent = {
          type: "terminal-resize-apply",
          sessionId,
          ...terminalBufferTrace(term),
          proposedCols: proposed.cols,
          proposedRows: proposed.rows,
          previousViewportY: anchor.viewportY,
          previousBaseY: anchor.baseY,
          deferred: keyboardSettlingRef.current,
          targetViewportY,
          reason,
          ptyResizeSent,
          durationMs: performance.now() - startedAt,
          proposeDurationMs,
          resizeDurationMs,
        };
        traceTerminalEvent("terminal-resize-apply", resizeApplyEvent);
        scheduleTerminalInputDiagnosticCapture(
          "terminal-resize-apply",
          resizeApplyEvent,
        );
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

      // The terminal width is a single shared PTY dimension, so connected
      // devices should not keep re-claiming it. A device claims the width
      // (fits + resizes the PTY) only when the user engages with it: on a
      // touch device when its pane is foregrounded; on desktop when the cursor
      // enters the terminal. Window-resize (ResizeObserver) still re-fits -- that
      // is a deliberate "I want this width" signal -- and commitInit establishes
      // the initial width regardless.
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
        // Foreground is the touch device's engagement signal. On desktop a bare
        // window focus (e.g. alt-tab) is not intent to interact, so we don't
        // claim the width there unless the pointer is already over the
        // terminal. That covers mobile->desktop handoff where no mouseenter
        // fires because the cursor never moved.
        if (isTouchRef.current || container.matches(":hover")) {
          applyResize(true);
        }
      };
      document.addEventListener("visibilitychange", onForeground);
      window.addEventListener("focus", onForeground);

      const onPointerEnter = () => {
        traceTerminalEvent("terminal-engage", {
          sessionId,
          reason: "pointer-enter",
          surface: isTouchRef.current ? "touch" : "desktop",
        });
        if (isTouchRef.current) return;
        applyResize(true);
      };
      container.addEventListener("mouseenter", onPointerEnter);

      return () => {
        clearFirstDataTimer();
        clearInitFallbackTimer();
        clearResizeTimer();
        stopTailPin();
        if (flushDeferredResizeRef.current === flushDeferredKeyboardResize) {
          flushDeferredResizeRef.current = null;
        }
        observer.disconnect();
        document.removeEventListener("visibilitychange", onForeground);
        window.removeEventListener("focus", onForeground);
        container.removeEventListener("mouseenter", onPointerEnter);
      };
    },
    [
      clearFirstDataTimer,
      firstDataTimerRef,
      hasReceivedDataRef,
      isEnded,
      onResizeApplied,
      refreshVisibleRows,
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
    const before = { cols: term.cols, rows: term.rows };
    term.options.fontSize = terminalConfig.fontSize;
    term.options.fontFamily = terminalConfig.fontFamily;
    term.options.theme = terminalConfig.theme;
    const proposed = fit?.proposeDimensions();
    if (isValidProposedDimensions(proposed)) {
      term.resize(proposed.cols, proposed.rows);
    }
    if (!isEnded && dimensionsChanged(before, term)) {
      send({ type: "resize", cols: term.cols, rows: term.rows });
    }
  }, [
    fitRef,
    isEnded,
    send,
    terminalConfig.fontFamily,
    terminalConfig.fontSize,
    terminalConfig.theme,
    xtermRef,
  ]);

  return {
    attachViewportLifecycle,
    applyTerminalConfig,
  };
}

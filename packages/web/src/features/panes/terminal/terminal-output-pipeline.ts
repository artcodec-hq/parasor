import type { WsTerminalClientMessage } from "@parasor/shared";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject, RefObject } from "react";
import { useCallback, useRef } from "react";
import {
  isTerminalTraceEnabled,
  scheduleTerminalInputDiagnosticCapture,
  traceTerminalEvent,
  traceTerminalEventLazy,
} from "../../../lib/terminal-trace.js";
import {
  restoreScrollAnchor,
  type ScrollAnchor,
} from "./terminal-scroll-anchor.js";
import { terminalBufferTrace } from "./terminal-trace-snapshot.js";

const OUTPUT_FLOW_CALLBACK_BYTE_LIMIT = 100_000;
const OUTPUT_FLOW_HIGH_WATER = 5;
const OUTPUT_FLOW_LOW_WATER = 2;
const OUTPUT_BATCH_TRACE_CHUNK_THRESHOLD = 2;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal OSC escapes are control-sequence delimiters we intentionally strip.
const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal CSI escapes are control-sequence delimiters we intentionally strip.
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: remaining ANSI ESC sequences are intentionally stripped.
const ESC_SEQUENCE = /\u001b[@-_]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: remaining C0/DEL control bytes are intentionally stripped from terminal text.
const OTHER_CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

type SendTerminalMessage = (msg: WsTerminalClientMessage) => void;

type OutputFlowState = {
  bytesSinceCallback: number;
  pendingCallbacks: number;
  paused: boolean;
};

type UseTerminalOutputPipelineArgs = {
  sessionId: string;
  xtermRef: RefObject<XTerm | null>;
  sendRef: RefObject<SendTerminalMessage | null>;
  onReplayWriteComplete?: (data: string, term: XTerm) => void;
};

function hasVisibleTerminalContent(data: string): boolean {
  const stripped = data
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESC_SEQUENCE, "")
    .replace(OTHER_CONTROL_CHARS, "");
  return /[^\s]/u.test(stripped);
}

export function useTerminalOutputPipeline({
  sessionId,
  xtermRef,
  sendRef,
  onReplayWriteComplete,
}: UseTerminalOutputPipelineArgs): {
  firstDataTimerRef: MutableRefObject<number | null>;
  hasReceivedDataRef: RefObject<boolean>;
  onData: (data: string) => void;
  onFullReplay: () => void;
  refreshVisibleRows: (term: XTerm) => void;
  restoreExpandedReplay: (
    term: XTerm,
    data: string,
    anchor: ScrollAnchor,
  ) => void;
  restoreCachedReplay: (term: XTerm, data: string) => void;
  resetOutputPipeline: (resumeIfPaused: boolean) => void;
  flushPendingOutput: (onFlushed?: () => void) => boolean;
} {
  const replayRefreshPendingRef = useRef(false);
  const replayStartAtRef = useRef<number | null>(null);
  const outputBatchRef = useRef<{
    chunks: string[];
    timer: number | null;
  }>({
    chunks: [],
    timer: null,
  });
  const hasReceivedDataRef = useRef(false);
  const firstDataTimerRef = useRef<number | null>(null);
  const outputFlowRef = useRef<OutputFlowState>({
    bytesSinceCallback: 0,
    pendingCallbacks: 0,
    paused: false,
  });

  const refreshVisibleRows = useCallback((term: XTerm) => {
    term.refresh(0, Math.max(0, term.rows - 1));
  }, []);

  const maybeResumeOutput = useCallback(() => {
    const flow = outputFlowRef.current;
    if (!flow.paused || flow.pendingCallbacks > OUTPUT_FLOW_LOW_WATER) {
      return;
    }
    flow.paused = false;
    sendRef.current?.({ type: "flow-resume" });
  }, [sendRef]);

  const writeTerminalOutput = useCallback(
    (term: XTerm, data: string, onWriteComplete?: () => void) => {
      traceTerminalEventLazy("xterm-write-start", () => ({
        sessionId,
        dataLength: data.length,
      }));
      const flow = outputFlowRef.current;
      flow.bytesSinceCallback += data.length;
      const shouldTrack =
        onWriteComplete !== undefined ||
        flow.bytesSinceCallback >= OUTPUT_FLOW_CALLBACK_BYTE_LIMIT ||
        isTerminalTraceEnabled();

      if (!shouldTrack) {
        term.write(data);
        return;
      }

      flow.bytesSinceCallback = 0;
      flow.pendingCallbacks += 1;
      if (!flow.paused && flow.pendingCallbacks > OUTPUT_FLOW_HIGH_WATER) {
        flow.paused = true;
        sendRef.current?.({ type: "flow-pause" });
      }
      term.write(data, () => {
        traceTerminalEventLazy("xterm-write-callback", () => ({
          sessionId,
          dataLength: data.length,
          pendingCallbacks: flow.pendingCallbacks,
          ...terminalBufferTrace(term),
        }));
        flow.pendingCallbacks = Math.max(0, flow.pendingCallbacks - 1);
        onWriteComplete?.();
        maybeResumeOutput();
      });
    },
    [maybeResumeOutput, sendRef, sessionId],
  );

  const flushOutputBatch = useCallback(
    (onFlushed?: () => void): boolean => {
      const batch = outputBatchRef.current;
      if (batch.timer !== null) {
        cancelAnimationFrame(batch.timer);
        batch.timer = null;
      }
      if (batch.chunks.length === 0) return false;
      const term = xtermRef.current;
      const chunks = batch.chunks;
      batch.chunks = [];
      if (!term) return false;
      const data = chunks.length === 1 ? chunks[0] : chunks.join("");
      if (chunks.length >= OUTPUT_BATCH_TRACE_CHUNK_THRESHOLD) {
        traceTerminalEvent("xterm-output-batch", {
          sessionId,
          dataLength: data.length,
          queueLength: chunks.length,
        });
      }
      writeTerminalOutput(term, data, onFlushed);
      return true;
    },
    [sessionId, writeTerminalOutput, xtermRef],
  );

  const clearOutputBatch = useCallback(() => {
    const batch = outputBatchRef.current;
    if (batch.timer !== null) {
      cancelAnimationFrame(batch.timer);
      batch.timer = null;
    }
    batch.chunks = [];
  }, []);

  const queueTerminalOutput = useCallback(
    (data: string) => {
      const batch = outputBatchRef.current;
      batch.chunks.push(data);
      if (batch.timer !== null) return;
      batch.timer = requestAnimationFrame(() => {
        batch.timer = null;
        flushOutputBatch();
      });
    },
    [flushOutputBatch],
  );

  const resetOutputPipeline = useCallback(
    (resumeIfPaused: boolean) => {
      clearOutputBatch();
      const flow = outputFlowRef.current;
      if (resumeIfPaused && flow.paused) {
        sendRef.current?.({ type: "flow-resume" });
      }
      flow.bytesSinceCallback = 0;
      flow.pendingCallbacks = 0;
      flow.paused = false;
      replayRefreshPendingRef.current = false;
      replayStartAtRef.current = null;
      hasReceivedDataRef.current = false;
      if (firstDataTimerRef.current !== null) {
        clearTimeout(firstDataTimerRef.current);
        firstDataTimerRef.current = null;
      }
    },
    [clearOutputBatch, sendRef],
  );

  const onData = useCallback(
    (data: string) => {
      const term = xtermRef.current;
      if (!term) return;
      if (!hasReceivedDataRef.current && hasVisibleTerminalContent(data)) {
        hasReceivedDataRef.current = true;
      }
      if (hasReceivedDataRef.current && firstDataTimerRef.current !== null) {
        clearTimeout(firstDataTimerRef.current);
        firstDataTimerRef.current = null;
      }
      if (replayRefreshPendingRef.current) {
        replayRefreshPendingRef.current = false;
        const replayStartAt = replayStartAtRef.current;
        const resetStartAt = performance.now();
        term.reset();
        const resetEndAt = performance.now();
        traceTerminalEvent("xterm-replay-reset", {
          sessionId,
          durationMs: resetEndAt - resetStartAt,
          sinceReplayStartMs:
            replayStartAt === null ? undefined : resetEndAt - replayStartAt,
        });
        const writeStartAt = performance.now();
        traceTerminalEvent("xterm-replay-write-start", {
          sessionId,
          dataLength: data.length,
          sinceReplayStartMs:
            replayStartAt === null ? undefined : writeStartAt - replayStartAt,
        });
        writeTerminalOutput(term, data, () => {
          const callbackAt = performance.now();
          traceTerminalEvent("xterm-replay-write-callback", {
            sessionId,
            dataLength: data.length,
            durationMs: callbackAt - writeStartAt,
            sinceReplayStartMs:
              replayStartAt === null ? undefined : callbackAt - replayStartAt,
          });
          refreshVisibleRows(term);
          traceTerminalEvent("xterm-replay-refresh", {
            sessionId,
            rows: term.rows,
            sinceReplayStartMs:
              replayStartAt === null
                ? undefined
                : performance.now() - replayStartAt,
          });
          onReplayWriteComplete?.(data, term);
          requestAnimationFrame(() => {
            const sinceReplayStartMs =
              replayStartAt === null
                ? undefined
                : performance.now() - replayStartAt;
            traceTerminalEvent("xterm-replay-paint", {
              sessionId,
              sinceReplayStartMs,
            });
            scheduleTerminalInputDiagnosticCapture("xterm-replay-paint", {
              type: "xterm-replay-paint",
              sessionId,
              sinceReplayStartMs,
              ...terminalBufferTrace(term),
            });
          });
        });
        return;
      }
      queueTerminalOutput(data);
    },
    [
      onReplayWriteComplete,
      refreshVisibleRows,
      sessionId,
      queueTerminalOutput,
      writeTerminalOutput,
      xtermRef,
    ],
  );

  const onFullReplay = useCallback(() => {
    const replayStartAt = performance.now();
    resetOutputPipeline(true);
    replayRefreshPendingRef.current = true;
    replayStartAtRef.current = replayStartAt;
    traceTerminalEvent("xterm-replay-pending", {
      sessionId,
    });
  }, [resetOutputPipeline, sessionId]);

  const restoreCachedReplay = useCallback(
    (term: XTerm, data: string) => {
      const replayStartAt = performance.now();
      term.reset();
      resetOutputPipeline(true);
      hasReceivedDataRef.current = hasVisibleTerminalContent(data);
      traceTerminalEvent("xterm-cache-replay-start", {
        sessionId,
        dataLength: data.length,
      });
      writeTerminalOutput(term, data, () => {
        refreshVisibleRows(term);
        traceTerminalEvent("xterm-cache-replay-refresh", {
          sessionId,
          rows: term.rows,
          sinceReplayStartMs: performance.now() - replayStartAt,
        });
        requestAnimationFrame(() => {
          const sinceReplayStartMs = performance.now() - replayStartAt;
          traceTerminalEvent("xterm-cache-replay-paint", {
            sessionId,
            sinceReplayStartMs,
          });
          scheduleTerminalInputDiagnosticCapture("xterm-cache-replay-paint", {
            type: "xterm-cache-replay-paint",
            sessionId,
            sinceReplayStartMs,
            ...terminalBufferTrace(term),
          });
        });
      });
    },
    [refreshVisibleRows, resetOutputPipeline, sessionId, writeTerminalOutput],
  );

  const restoreExpandedReplay = useCallback(
    (term: XTerm, data: string, anchor: ScrollAnchor) => {
      const replayStartAt = performance.now();
      term.reset();
      resetOutputPipeline(true);
      hasReceivedDataRef.current = hasVisibleTerminalContent(data);
      traceTerminalEvent("xterm-history-replay-start", {
        sessionId,
        dataLength: data.length,
      });
      writeTerminalOutput(term, data, () => {
        refreshVisibleRows(term);
        const restore = restoreScrollAnchor(term, anchor);
        traceTerminalEvent("xterm-history-scroll-restore", {
          sessionId,
          viewportY: term.buffer.active.viewportY,
          baseY: term.buffer.active.baseY,
          previousViewportY: anchor.viewportY,
          previousBaseY: anchor.baseY,
          targetViewportY: restore.targetViewportY,
          reason: restore.reason,
          sinceReplayStartMs: performance.now() - replayStartAt,
        });
        sendRef.current?.({ type: "refresh" });
        traceTerminalEvent("xterm-history-replay-refresh", {
          sessionId,
          rows: term.rows,
          sinceReplayStartMs: performance.now() - replayStartAt,
        });
        requestAnimationFrame(() => {
          const sinceReplayStartMs = performance.now() - replayStartAt;
          traceTerminalEvent("xterm-history-replay-paint", {
            sessionId,
            sinceReplayStartMs,
          });
          scheduleTerminalInputDiagnosticCapture("xterm-history-replay-paint", {
            type: "xterm-history-replay-paint",
            sessionId,
            sinceReplayStartMs,
            ...terminalBufferTrace(term),
          });
        });
      });
    },
    [
      refreshVisibleRows,
      resetOutputPipeline,
      sendRef,
      sessionId,
      writeTerminalOutput,
    ],
  );

  return {
    firstDataTimerRef,
    hasReceivedDataRef,
    onData,
    onFullReplay,
    refreshVisibleRows,
    restoreExpandedReplay,
    restoreCachedReplay,
    resetOutputPipeline,
    flushPendingOutput: flushOutputBatch,
  };
}

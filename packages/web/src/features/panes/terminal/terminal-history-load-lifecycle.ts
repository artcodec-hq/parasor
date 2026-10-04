import type { TerminalLastSeen } from "@parasor/shared";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTerminalReplayCache,
  setTerminalReplayCache,
  type TerminalReplayCacheEntry,
} from "../../../lib/terminal-replay-cache.js";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import {
  createInitialTerminalHistoryLoadState,
  INITIAL_HISTORY_LOAD_BYTES,
  loadOlderTerminalHistory,
  type TerminalHistoryLoadStatus,
  type TerminalHistoryLoadStatusState,
} from "./terminal-history-loader.js";
import {
  replayCacheMatchesDimensions,
  type TerminalReplayCacheRef,
} from "./terminal-initial-replay.js";
import {
  captureScrollAnchor,
  restoreScrollAnchor,
  type ScrollAnchor,
} from "./terminal-scroll-anchor.js";

// After a viewport change shifts the buffer, suppress the scroll-to-top
// history loader for one short window.
const HISTORY_LOAD_SUPPRESS_MS = 750;

type UseTerminalHistoryLoadLifecycleArgs = {
  sessionId: string;
  xtermRef: RefObject<XTerm | null>;
  keyboardSettling: boolean;
};

type UseTerminalHistoryLoadLifecycleResult = {
  cachedReplayRef: TerminalReplayCacheRef;
  replayRestoringRef: MutableRefObject<boolean>;
  keyboardSettlingRef: MutableRefObject<boolean>;
  keyboardHistoryLoadSuppressUntilRef: MutableRefObject<number>;
  historyTopLoadArmedRef: MutableRefObject<boolean>;
  visibleHistoryLoadStatus: TerminalHistoryLoadStatus;
  isReplayRestoring: boolean;
  loadOlderHistory: (
    restoreExpandedReplay: (
      term: XTerm,
      data: string,
      anchor: ScrollAnchor,
    ) => void,
  ) => Promise<void>;
  startFullReplay: (
    lastSeen: TerminalLastSeen | null,
    onFullReplay: () => void,
  ) => void;
  handleReplayWriteComplete: (data: string, term: XTerm) => void;
  resolveInitialLastSeen: (dims: {
    cols: number;
    rows: number;
  }) => TerminalLastSeen | null;
  suppressHistoryLoadAfterResize: () => void;
};

export function useTerminalHistoryLoadLifecycle({
  sessionId,
  xtermRef,
  keyboardSettling,
}: UseTerminalHistoryLoadLifecycleArgs): UseTerminalHistoryLoadLifecycleResult {
  const [isReplayRestoring, setIsReplayRestoring] = useState(false);
  const replayRestoringRef = useRef(false);
  const pendingFullReplayViewportRef = useRef<ScrollAnchor | null>(null);
  const [historyLoadStatus, setHistoryLoadStatus] =
    useState<TerminalHistoryLoadStatusState>({
      sessionId,
      status: "hidden",
    });
  const cachedReplayRef = useRef<{
    sessionId: string;
    entry: TerminalReplayCacheEntry | null;
  } | null>(null);
  const historyLoadRef = useRef(createInitialTerminalHistoryLoadState());
  const historyTopLoadArmedRef = useRef(false);
  const encoderRef = useRef<TextEncoder | null>(null);
  const pendingFullReplayCursorRef = useRef<TerminalLastSeen | null>(null);
  const keyboardSettlingRef = useRef(keyboardSettling);
  const keyboardHistoryLoadSuppressUntilRef = useRef(0);
  const wasKeyboardSettlingRef = useRef(keyboardSettling);

  if (!encoderRef.current) encoderRef.current = new TextEncoder();
  if (cachedReplayRef.current?.sessionId !== sessionId) {
    cachedReplayRef.current = {
      sessionId,
      entry: getTerminalReplayCache(sessionId),
    };
    historyLoadRef.current = createInitialTerminalHistoryLoadState();
    historyTopLoadArmedRef.current = false;
  }
  keyboardSettlingRef.current = keyboardSettling;

  const visibleHistoryLoadStatus =
    historyLoadStatus.sessionId === sessionId
      ? historyLoadStatus.status
      : "hidden";

  const armHistoryLoadSuppression = useCallback(
    (reason: string) => {
      keyboardHistoryLoadSuppressUntilRef.current =
        performance.now() + HISTORY_LOAD_SUPPRESS_MS;
      traceTerminalEvent("terminal-history-load-suppress-window", {
        sessionId,
        reason,
        timeoutMs: HISTORY_LOAD_SUPPRESS_MS,
      });
    },
    [sessionId],
  );

  useEffect(() => {
    const wasSettling = wasKeyboardSettlingRef.current;
    wasKeyboardSettlingRef.current = keyboardSettling;
    if (wasSettling && !keyboardSettling) {
      armHistoryLoadSuppression("keyboard-settled");
    }
  }, [keyboardSettling, armHistoryLoadSuppression]);

  const handleReplayWriteComplete = useCallback(
    (data: string, term: XTerm) => {
      setIsReplayRestoring(false);
      replayRestoringRef.current = false;
      const lastSeen = pendingFullReplayCursorRef.current;
      pendingFullReplayCursorRef.current = null;
      const anchor = pendingFullReplayViewportRef.current;
      pendingFullReplayViewportRef.current = null;
      if (!anchor) {
        term.scrollToBottom();
        traceTerminalEvent("xterm-replay-scroll-restore", {
          sessionId,
          viewportY: term.buffer.active.viewportY,
          baseY: term.buffer.active.baseY,
          reason: "was-at-bottom",
        });
      } else {
        const restore = restoreScrollAnchor(term, anchor);
        traceTerminalEvent("xterm-replay-scroll-restore", {
          sessionId,
          viewportY: term.buffer.active.viewportY,
          baseY: term.buffer.active.baseY,
          previousViewportY: anchor.viewportY,
          previousBaseY: anchor.baseY,
          targetViewportY: restore.targetViewportY,
          reason: restore.reason,
        });
      }
      const byteLength =
        encoderRef.current?.encode(data).byteLength ?? data.length;
      historyLoadRef.current = {
        loading: false,
        maxBytes: Math.max(INITIAL_HISTORY_LOAD_BYTES, byteLength),
        exhausted: false,
        lastRequestedAt: 0,
      };
      setHistoryLoadStatus({
        sessionId,
        status: byteLength >= INITIAL_HISTORY_LOAD_BYTES ? "ready" : "hidden",
      });
      historyTopLoadArmedRef.current = false;
      if (!lastSeen) return;
      setTerminalReplayCache(sessionId, {
        data,
        lastSeen,
        cols: term.cols,
        rows: term.rows,
      });
      cachedReplayRef.current = {
        sessionId,
        entry: getTerminalReplayCache(sessionId),
      };
      traceTerminalEvent("xterm-replay-cache-store", {
        sessionId,
        dataLength: data.length,
        generation: lastSeen.generation,
      });
    },
    [sessionId],
  );

  const startFullReplay = useCallback(
    (lastSeen: TerminalLastSeen | null, onFullReplay: () => void) => {
      setIsReplayRestoring(true);
      replayRestoringRef.current = true;
      const term = xtermRef.current;
      pendingFullReplayViewportRef.current = term
        ? captureScrollAnchor(term)
        : null;
      historyTopLoadArmedRef.current = false;
      pendingFullReplayCursorRef.current = lastSeen;
      onFullReplay();
    },
    [xtermRef],
  );

  const loadOlderHistory = useCallback(
    async (
      restoreExpandedReplay: (
        term: XTerm,
        data: string,
        anchor: ScrollAnchor,
      ) => void,
    ) => {
      const term = xtermRef.current;
      const encoder = encoderRef.current;
      if (!term || !encoder) return;
      await loadOlderTerminalHistory({
        sessionId,
        term,
        encoder,
        replayRestoring: replayRestoringRef.current,
        historyState: historyLoadRef.current,
        cachedReplayRef,
        setHistoryLoadStatus,
        restoreExpandedReplay,
      });
    },
    [sessionId, xtermRef],
  );

  const resolveInitialLastSeen = useCallback(
    (dims: { cols: number; rows: number }) => {
      const entry = cachedReplayRef.current?.entry ?? null;
      return replayCacheMatchesDimensions(entry, dims) ? entry.lastSeen : null;
    },
    [],
  );

  const suppressHistoryLoadAfterResize = useCallback(
    () => armHistoryLoadSuppression("resize-applied"),
    [armHistoryLoadSuppression],
  );

  return {
    cachedReplayRef,
    replayRestoringRef,
    keyboardSettlingRef,
    keyboardHistoryLoadSuppressUntilRef,
    historyTopLoadArmedRef,
    visibleHistoryLoadStatus,
    isReplayRestoring,
    loadOlderHistory,
    startFullReplay,
    handleReplayWriteComplete,
    resolveInitialLastSeen,
    suppressHistoryLoadAfterResize,
  };
}

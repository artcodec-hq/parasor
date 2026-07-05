import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject } from "react";
import { authFetch } from "../../../lib/auth-fetch.js";
import {
  getTerminalReplayCache,
  setTerminalReplayCache,
  type TerminalReplayCacheEntry,
} from "../../../lib/terminal-replay-cache.js";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import {
  captureScrollAnchor,
  type ScrollAnchor,
} from "./terminal-scroll-anchor.js";

export const INITIAL_HISTORY_LOAD_BYTES = 256 * 1024;

const MIN_NEXT_HISTORY_LOAD_BYTES = 512 * 1024;
const MAX_HISTORY_LOAD_BYTES = 4 * 1024 * 1024;

export type TerminalHistoryLoadStatus = "hidden" | "ready" | "loading";

export type TerminalHistoryLoadState = {
  loading: boolean;
  maxBytes: number;
  exhausted: boolean;
  lastRequestedAt: number;
};

export type TerminalHistoryLoadStatusState = {
  sessionId: string;
  status: TerminalHistoryLoadStatus;
};

type TerminalReplayCacheRef = MutableRefObject<{
  sessionId: string;
  entry: TerminalReplayCacheEntry | null;
} | null>;

type LoadOlderTerminalHistoryArgs = {
  sessionId: string;
  term: XTerm;
  encoder: TextEncoder;
  replayRestoring: boolean;
  historyState: TerminalHistoryLoadState;
  cachedReplayRef: TerminalReplayCacheRef;
  setHistoryLoadStatus: (state: TerminalHistoryLoadStatusState) => void;
  restoreExpandedReplay: (
    term: XTerm,
    data: string,
    anchor: ScrollAnchor,
  ) => void;
};

export function createInitialTerminalHistoryLoadState(): TerminalHistoryLoadState {
  return {
    loading: false,
    maxBytes: INITIAL_HISTORY_LOAD_BYTES,
    exhausted: false,
    lastRequestedAt: 0,
  };
}

export async function loadOlderTerminalHistory({
  sessionId,
  term,
  encoder,
  replayRestoring,
  historyState,
  cachedReplayRef,
  setHistoryLoadStatus,
  restoreExpandedReplay,
}: LoadOlderTerminalHistoryArgs): Promise<void> {
  if (replayRestoring) {
    traceTerminalEvent("terminal-history-load-suppressed", {
      sessionId,
      viewportY: term.buffer.active.viewportY,
      baseY: term.buffer.active.baseY,
      reason: "replay-restoring",
    });
    return;
  }

  if (historyState.loading || historyState.exhausted) return;
  const now = performance.now();
  if (now - historyState.lastRequestedAt < 500) return;
  const nextMaxBytes = Math.min(
    Math.max(historyState.maxBytes * 2, MIN_NEXT_HISTORY_LOAD_BYTES),
    MAX_HISTORY_LOAD_BYTES,
  );
  if (nextMaxBytes <= historyState.maxBytes) {
    historyState.exhausted = true;
    setHistoryLoadStatus({ sessionId, status: "hidden" });
    return;
  }

  historyState.loading = true;
  historyState.lastRequestedAt = now;
  const replayAnchor = captureScrollAnchor(term);
  setHistoryLoadStatus({ sessionId, status: "loading" });
  traceTerminalEvent("terminal-history-load-start", {
    sessionId,
    maxBytes: nextMaxBytes,
    cols: term.cols,
    rows: term.rows,
  });

  try {
    const params = new URLSearchParams({
      cols: String(term.cols),
      rows: String(term.rows),
      maxBytes: String(nextMaxBytes),
    });
    const res = await authFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/scrollback-snapshot?${params}`,
    );
    if (!res.ok) {
      traceTerminalEvent("terminal-history-load-failed", {
        sessionId,
        status: String(res.status),
        maxBytes: nextMaxBytes,
      });
      setHistoryLoadStatus({ sessionId, status: "ready" });
      return;
    }

    const data = (await res.json()) as {
      text?: unknown;
      replayBytes?: unknown;
      maxBytes?: unknown;
      hasMore?: unknown;
    };
    if (typeof data.text !== "string") return;
    const replayBytes =
      typeof data.replayBytes === "number"
        ? data.replayBytes
        : encoder.encode(data.text).byteLength;
    historyState.maxBytes =
      typeof data.maxBytes === "number" ? data.maxBytes : nextMaxBytes;
    historyState.exhausted =
      data.hasMore === false || historyState.maxBytes >= MAX_HISTORY_LOAD_BYTES;
    setHistoryLoadStatus({
      sessionId,
      status: historyState.exhausted ? "hidden" : "ready",
    });
    if (data.text.length === 0) return;
    restoreExpandedReplay(term, data.text, replayAnchor);
    const lastSeen = cachedReplayRef.current?.entry?.lastSeen ?? null;
    if (lastSeen) {
      setTerminalReplayCache(sessionId, {
        data: data.text,
        lastSeen,
        cols: term.cols,
        rows: term.rows,
      });
      cachedReplayRef.current = {
        sessionId,
        entry: getTerminalReplayCache(sessionId),
      };
    }
    traceTerminalEvent("terminal-history-load-complete", {
      sessionId,
      dataLength: data.text.length,
      byteLength: replayBytes,
      maxBytes: historyState.maxBytes,
    });
  } catch (err) {
    setHistoryLoadStatus({ sessionId, status: "ready" });
    traceTerminalEvent("terminal-history-load-failed", {
      sessionId,
      status: err instanceof Error ? err.name : "unknown",
      maxBytes: nextMaxBytes,
    });
  } finally {
    historyState.loading = false;
  }
}

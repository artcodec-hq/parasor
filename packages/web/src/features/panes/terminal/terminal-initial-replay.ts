import type { Terminal as XTerm } from "@xterm/xterm";
import type { MutableRefObject } from "react";
import {
  getTerminalReplayCache,
  type TerminalReplayCacheEntry,
} from "../../../lib/terminal-replay-cache.js";

export type TerminalReplayCacheRef = MutableRefObject<{
  sessionId: string;
  entry: TerminalReplayCacheEntry | null;
} | null>;

export function replayCacheMatchesDimensions(
  entry: TerminalReplayCacheEntry | null,
  dims: { cols: number; rows: number },
): entry is TerminalReplayCacheEntry {
  return entry?.cols === dims.cols && entry.rows === dims.rows;
}

export function prepareInitialReplayRestore({
  sessionId,
  term,
  cachedReplayRef,
  restoreCachedReplay,
}: {
  sessionId: string;
  term: XTerm;
  cachedReplayRef: TerminalReplayCacheRef;
  restoreCachedReplay: (term: XTerm, data: string) => void;
}) {
  const cachedReplay =
    cachedReplayRef.current?.entry ?? getTerminalReplayCache(sessionId);
  if (cachedReplay) {
    cachedReplayRef.current = { sessionId, entry: cachedReplay };
  }
  return () => {
    if (replayCacheMatchesDimensions(cachedReplay, term)) {
      restoreCachedReplay(term, cachedReplay.data);
    }
  };
}

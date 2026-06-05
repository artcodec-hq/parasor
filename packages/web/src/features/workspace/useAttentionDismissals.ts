import type { AgentState } from "@parasor/shared";
import { useEffect, useState } from "react";

// Map of sessionId -> the `waiting.detectedAt` timestamp the user has already
// viewed. A newer detectedAt re-arms the badge.
export type AttentionDismissals = Record<string, number>;

const TERMINAL_PANE_PREFIX = "terminal:";

interface UseAttentionDismissalsOptions {
  focusedPaneId: string | null;
  agentStates: Record<string, AgentState>;
}

export function useAttentionDismissals({
  focusedPaneId,
  agentStates,
}: UseAttentionDismissalsOptions): AttentionDismissals {
  const [dismissedAt, setDismissedAt] = useState<AttentionDismissals>({});

  useEffect(() => {
    if (!focusedPaneId?.startsWith(TERMINAL_PANE_PREFIX)) {
      return;
    }
    const sessionId = focusedPaneId.slice(TERMINAL_PANE_PREFIX.length);
    const state = agentStates[sessionId];
    if (!state || state.lifecycle !== "waiting") return;
    setDismissedAt((prev) => {
      if (prev[sessionId] === state.detectedAt) return prev;
      return { ...prev, [sessionId]: state.detectedAt };
    });
  }, [focusedPaneId, agentStates]);

  // Drop entries for sessions no longer reported by the server. Without this
  // the map grows monotonically as sessions are created and destroyed over a
  // long-lived workspace.
  useEffect(() => {
    setDismissedAt((prev) => {
      const next: AttentionDismissals = {};
      let changed = false;
      for (const [sid, ts] of Object.entries(prev)) {
        if (sid in agentStates) {
          next[sid] = ts;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [agentStates]);

  return dismissedAt;
}

export function isAttentionDismissed(
  state: AgentState | undefined,
  dismissedAt: AttentionDismissals,
): boolean {
  if (!state) return false;
  if (state.lifecycle !== "waiting") return false;
  const ts = dismissedAt[state.sessionId];
  return ts !== undefined && ts >= state.detectedAt;
}

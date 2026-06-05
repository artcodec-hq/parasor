import type { AgentState, Session } from "@parasor/shared";
import { useEffect, useRef, useState } from "react";

interface UseReviewPendingSessionsOptions {
  activeProjectId: string | null;
  agentStates: Record<string, AgentState>;
  sessions: Session[];
}

export function useReviewPendingSessions({
  activeProjectId,
  agentStates,
  sessions,
}: UseReviewPendingSessionsOptions) {
  const [reviewPendingSessions, setReviewPendingSessions] = useState<
    Set<string>
  >(() => new Set());
  const prevLifecyclesRef = useRef<Record<string, AgentState["lifecycle"]>>({});

  useEffect(() => {
    const prev = prevLifecyclesRef.current;
    const next: Record<string, AgentState["lifecycle"]> = {};
    const additions = new Set<string>();
    const removals = new Set<string>();
    let changed = false;
    const activeSessionIds = new Set(sessions.map((session) => session.id));

    for (const [sessionId, state] of Object.entries(agentStates)) {
      next[sessionId] = state.lifecycle;
      const prior = prev[sessionId];
      if (prior === state.lifecycle) continue;
      const session = sessions.find((s) => s.id === sessionId);
      const projectId = session?.projectId;
      if (
        state.lifecycle === "completed" &&
        prior !== "completed" &&
        projectId &&
        projectId !== activeProjectId
      ) {
        additions.add(sessionId);
        changed = true;
      } else if (
        state.lifecycle === "running" ||
        state.lifecycle === "waiting"
      ) {
        removals.add(sessionId);
        changed = true;
      }
    }

    prevLifecyclesRef.current = next;

    if (changed || reviewPendingSessions.size > 0) {
      setReviewPendingSessions((current) => {
        const nextSet = new Set(current);
        for (const id of current) {
          if (!activeSessionIds.has(id)) {
            nextSet.delete(id);
          }
        }
        for (const id of removals) nextSet.delete(id);
        for (const id of additions) nextSet.add(id);
        return nextSet;
      });
    }
  }, [activeProjectId, agentStates, reviewPendingSessions.size, sessions]);

  useEffect(() => {
    if (!activeProjectId) return;
    setReviewPendingSessions((current) => {
      if (current.size === 0) return current;
      const nextSet = new Set(current);
      let mutated = false;
      for (const id of current) {
        const session = sessions.find((s) => s.id === id);
        if (session?.projectId === activeProjectId) {
          nextSet.delete(id);
          mutated = true;
        }
      }
      return mutated ? nextSet : current;
    });
  }, [activeProjectId, sessions]);

  return reviewPendingSessions;
}

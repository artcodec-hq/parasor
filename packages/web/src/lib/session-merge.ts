import type { Session } from "@parasor/shared";

/**
 * Append optimistic (locally-created, not-yet-acknowledged) sessions that the
 * authoritative server list does not yet contain. Server sessions win on id
 * collision; the input array is returned unchanged when nothing is missing.
 */
export function mergeOptimisticSessions(
  sessions: Session[],
  optimisticSessions: Session[],
): Session[] {
  if (optimisticSessions.length === 0) return sessions;
  const sessionIds = new Set(sessions.map((session) => session.id));
  const missing = optimisticSessions.filter(
    (session) => !sessionIds.has(session.id),
  );
  return missing.length > 0 ? [...sessions, ...missing] : sessions;
}

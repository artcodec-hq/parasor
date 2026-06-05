/*
 * Shared reconnect-timing policy for the WebSocket hooks (`useTerminalSocket`,
 * `useEventSocket`). Both sockets reconnect with the same exponential backoff
 * and treat the same dwell window as "stable enough" for an instant reconnect;
 * keeping the policy in one pure module stops the two copies from drifting.
 */

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

/**
 * Minimum time a socket must have stayed established before its close is
 * eligible for an instant (0 ms) reconnect. A socket that establishes and then
 * drops within this window is flapping (server restart loop, proxy churn), so
 * such a close takes the backoff branch instead of looping at 0 ms.
 */
export const MIN_STABLE_MS = 3000;

// ±20% jitter so a fleet of clients reconnecting after one server blip does
// not synchronize into a thundering herd on the same tick.
function jitter(ms: number): number {
  return ms * (1 + (Math.random() * 0.4 - 0.2));
}

/**
 * Exponential reconnect backoff: doubles from `BASE_DELAY_MS` per attempt,
 * clamped at `MAX_DELAY_MS`, then jittered ±20% and rounded. The clamp is
 * applied before the jitter, so the returned delay can exceed `MAX_DELAY_MS`
 * by up to 20%.
 */
export function nextReconnectDelay(attempt: number): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.round(jitter(exp));
}

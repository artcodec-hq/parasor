import type { PtyHost } from "../pty/host.js";
import type { TerminalRelayState, TerminalWs } from "./terminal.js";

/*
 * Server-side send backpressure for the terminal socket. A client that stops
 * draining its socket (mobile background, slow link, frozen tab the keepalive
 * has not yet reaped) would otherwise grow the server's per-socket send buffer
 * without bound. When `bufferedAmount` reaches the high-water mark we pause the
 * PTY via the existing flow-control path; a poll resumes it once the buffer
 * drains to the low-water mark. The hard ceiling is the backstop: a socket that
 * blows past it is closed (1013) and the client reconnects + replays.
 */
const BACKPRESSURE_HIGH_WATER = 1024 * 1024; // 1 MiB -- pause the PTY
const BACKPRESSURE_LOW_WATER = 256 * 1024; // 256 KiB -- resume the PTY
const BACKPRESSURE_HARD_LIMIT = 8 * 1024 * 1024; // 8 MiB -- give up, close 1013
const BACKPRESSURE_DRAIN_POLL_MS = 100;

/**
 * Reconcile the host's single per-client `flowPaused` bit against the relay's
 * two independent pause reasons. Pause when either the client or the server
 * wants it; resume only when both are clear. Idempotent -- the host no-ops a
 * repeated pause/resume -- so it is safe to call after any reason flips.
 */
export function syncPtyFlow(
  state: TerminalRelayState,
  sessionId: string,
  clientId: string,
  ptyManager: PtyHost,
): void {
  if (state.clientPaused || state.serverPaused) {
    ptyManager.pauseOutput(sessionId, clientId);
  } else {
    ptyManager.resumeOutput(sessionId, clientId);
  }
}

/**
 * Apply send backpressure after relaying a chunk to {@link ws}. Pauses the PTY
 * when the socket's send buffer is congested and starts a drain poll that
 * resumes it once the buffer empties; closes 1013 if the buffer blows past the
 * hard ceiling. No-op when the transport does not expose `bufferedAmount`.
 */
export function applyServerBackpressure(
  ws: TerminalWs,
  state: TerminalRelayState,
  sessionId: string,
  clientId: string,
  ptyManager: PtyHost,
): void {
  const buffered = ws.raw?.bufferedAmount ?? 0;
  if (buffered > BACKPRESSURE_HARD_LIMIT) {
    ws.close(1013, "backpressure");
    return;
  }
  if (buffered < BACKPRESSURE_HIGH_WATER) return;

  if (state.serverPaused) return;
  state.serverPaused = true;
  syncPtyFlow(state, sessionId, clientId, ptyManager);

  const timer = setInterval(() => {
    const depth = ws.raw?.bufferedAmount ?? 0;
    if (ws.readyState !== 1 || depth <= BACKPRESSURE_LOW_WATER) {
      clearInterval(timer);
      state.drainTimer = undefined;
      if (state.serverPaused) {
        state.serverPaused = false;
        // Honor a still-active client-driven pause: resume only if the client
        // is not itself paused (syncPtyFlow ANDs the two reasons).
        if (ws.readyState === 1) {
          syncPtyFlow(state, sessionId, clientId, ptyManager);
        }
      }
    }
  }, BACKPRESSURE_DRAIN_POLL_MS);
  timer.unref?.();
  state.drainTimer = timer;
}

import type { SessionCommand, SessionEndReason } from "@parasor/shared";

/**
 * Mirrors the server-side check in `PtyManager.isAutoResumable`. When
 * the session ended safely (no orphan-process risk, no unknown side
 * effects), the WS init triggers a silent re-spawn on the server and
 * the pane stays a normal live terminal. Otherwise the pane surfaces
 * an error.
 */
export function isAutoResumable(
  command: SessionCommand | undefined,
  endReason: SessionEndReason | undefined,
): boolean {
  if (!command || !endReason) return false;
  if (command.type !== "shell" && command.type !== "claude") return false;
  return (
    endReason.type === "exit" ||
    endReason.type === "signal" ||
    endReason.type === "server-graceful" ||
    endReason.type === "daemon-graceful"
  );
}

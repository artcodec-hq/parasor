import type { SessionCommand, SessionEndReason } from "@parasor/shared";
import type { TerminalSocketStatus } from "../../../hooks/useTerminalSocket.js";
import { isAutoResumable } from "../../../lib/session-resume.js";

export function shouldShowTerminalSessionError({
  sessionState,
  sessionCommand,
  sessionEndReason,
}: {
  sessionState: "running" | "ended";
  sessionCommand?: SessionCommand;
  sessionEndReason?: SessionEndReason;
}) {
  // An ended session that is safe to resume stays wired to the WS -- the
  // server will silently re-spawn on init and the pane keeps rendering
  // as a live terminal. An ended session that is NOT safe to resume
  // drops out to the error pane and never opens a WS.
  return (
    sessionState === "ended" &&
    !isAutoResumable(sessionCommand, sessionEndReason)
  );
}

export function resolveTerminalSessionStatus({
  showError,
  socketStatus,
}: {
  showError: boolean;
  socketStatus: TerminalSocketStatus;
}) {
  // A WS that the server closed with 1008 (Session not found /
  // unavailable / init expected) parks as `socketStatus === "ended"`.
  // Treating that as a terminal state here -- alongside the AppStore
  // sessionState path -- disables xterm input and flips the pane to
  // SessionErrorState immediately, without waiting for the session
  // event stream to also arrive. Without this, silent keystroke loss
  // happens whenever the event-store update is delayed or missing.
  const socketEnded = socketStatus === "ended";
  const isEnded = showError || socketEnded;

  return {
    socketEnded,
    isEnded,
  };
}

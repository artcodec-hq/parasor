import type { SessionCommand, SessionEndReason } from "@parasor/shared";
import type { StateCardTone } from "../primitives/StateCard.js";
import { StateCard } from "../primitives/StateCard.js";

export interface SessionErrorStateProps {
  sessionTitle: string;
  command: SessionCommand | undefined;
  endReason: SessionEndReason | undefined;
  /**
   * Populated when the WebSocket itself was terminated by the server
   * (close code 1008 -- "Session not found" / "Session unavailable" /
   * "init expected"). Takes precedence over `endReason`: the socket-level
   * close is authoritative about the session being gone, and the
   * message sent by the server is more actionable than the synthetic
   * "Session ended" fallback.
   */
  socketDisconnectedReason?: string | null;
  onRestart?: () => void;
  onClose?: () => void;
}

interface ErrorMessage {
  tone: StateCardTone;
  tag: string;
  heading: string;
  detail: string;
  showRestart: boolean;
}

/**
 * Empty-pane error state shown when a session ended under conditions
 * that are not safe to auto-resume (server crash / unknown custom
 * command side-effects). Replaces the previous centered "Session ended"
 * modal: non-resumable cases warrant a full-pane error surface.
 * Tone bar + uppercase tag + title/body + buttons.
 */
export function SessionErrorState({
  sessionTitle,
  command,
  endReason,
  socketDisconnectedReason,
  onRestart,
  onClose,
}: SessionErrorStateProps) {
  const message = buildMessage(command, endReason, socketDisconnectedReason);

  return (
    <div className="flex h-full w-full items-center justify-center bg-bg-primary p-6">
      <StateCard
        tone={message.tone}
        tag={message.tag}
        title={message.heading}
        body={
          <div className="flex flex-col gap-1.5">
            <span className="cm-mono text-xs text-text-primary">
              {sessionTitle}
            </span>
            <span className="whitespace-pre-line">{message.detail}</span>
          </div>
        }
        primary={
          message.showRestart && onRestart
            ? { label: "Re-run", onClick: onRestart }
            : undefined
        }
        secondary={onClose ? { label: "Close", onClick: onClose } : undefined}
      />
    </div>
  );
}

function buildMessage(
  command: SessionCommand | undefined,
  endReason: SessionEndReason | undefined,
  socketDisconnectedReason: string | null | undefined,
): ErrorMessage {
  if (socketDisconnectedReason) {
    return {
      tone: "warn",
      tag: "DISCONNECTED",
      heading: "Disconnected",
      detail: `${socketDisconnectedReason}\nReopen this session from the sidebar.`,
      showRestart: false,
    };
  }

  if (endReason?.type === "server-crash") {
    return {
      tone: "err",
      tag: "FAILED",
      heading: "parasor server exited unexpectedly",
      detail:
        "This session will not auto-resume to avoid duplicate processes.\nStart a new session from the sidebar.",
      showRestart: false,
    };
  }

  if (endReason?.type === "daemon-crash") {
    return {
      tone: "err",
      tag: "CRASHED",
      heading: "parasor PTY host exited unexpectedly",
      detail:
        "The daemon that owned this terminal crashed. Re-running may double-spawn an orphaned process -- start a new session from the sidebar instead.",
      showRestart: false,
    };
  }

  if (endReason?.type === "daemon-graceful") {
    // Reachable only in edge cases -- `isAutoResumable` normally takes
    // the happy path and silently re-spawns. We surface this branch
    // when the command type is `custom` (side-effects unknown, no
    // auto-resume) or auto-resume was disabled at the server level.
    return {
      tone: "warn",
      tag: "DAEMON SHUTDOWN",
      heading: "Session ended when the PTY host shut down",
      detail: "Re-run to start a fresh session.",
      showRestart: true,
    };
  }

  const label = command?.type === "custom" ? `"${command.command}"` : "Command";

  if (endReason?.type === "exit") {
    return {
      tone: "info",
      tag: "EXITED",
      heading: `${label} exited (exit ${endReason.code})`,
      detail: "Re-run if needed.",
      showRestart: true,
    };
  }

  if (endReason?.type === "signal") {
    return {
      tone: "info",
      tag: "STOPPED",
      heading: `${label} stopped (signal ${endReason.signal})`,
      detail: "Re-run if needed.",
      showRestart: true,
    };
  }

  return {
    tone: "info",
    tag: "ENDED",
    heading: "Session ended",
    detail: "Re-run if needed.",
    showRestart: true,
  };
}

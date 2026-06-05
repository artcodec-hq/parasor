import { StateCard } from "../primitives/StateCard.js";

export interface MissingSessionRouteStateProps {
  sessionId: string;
  hydrated: boolean;
  connected: boolean;
  onClose: () => void;
}

export function MissingSessionRouteState({
  sessionId,
  hydrated,
  connected,
  onClose,
}: MissingSessionRouteStateProps) {
  const title = hydrated ? "Session not found" : "Opening session";
  const detail = hydrated
    ? "This session is no longer present in the server state. It may have ended when the server or PTY host restarted."
    : connected
      ? "Waiting for the server snapshot. If this session was owned by a previous server or PTY host, it may no longer exist."
      : "Waiting for the server connection. If this session was owned by a previous server or PTY host, it may no longer exist.";

  return (
    <div className="flex h-full w-full items-center justify-center bg-bg-primary p-6">
      <StateCard
        tone={hydrated ? "warn" : "info"}
        tag={hydrated ? "SESSION MISSING" : "SESSION"}
        title={title}
        body={
          <div className="flex flex-col gap-1.5">
            <span className="cm-mono text-xs text-text-primary">
              {sessionId}
            </span>
            <span>{detail}</span>
          </div>
        }
        secondary={{ label: "Close", onClick: onClose }}
      />
    </div>
  );
}

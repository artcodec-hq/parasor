import type { Session } from "@parasor/shared";
import type { ReactNode } from "react";
import { MissingSessionRouteState } from "../../components/overlays/MissingSessionRouteState.js";
import { SessionErrorState } from "../../components/overlays/SessionErrorState.js";
import { isAutoResumable } from "../../lib/session-resume.js";
import type { WorkspaceRoute } from "../../lib/workspace-route.js";

interface WorkspaceSurfaceProps {
  closeRouteSession: (session: Session) => void;
  eventSocketConnected: boolean;
  hydrated: boolean;
  monitorActive: boolean;
  monitorSurface: ReactNode;
  navigate: (route: WorkspaceRoute, opts?: { replace?: boolean }) => void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  paneSurface: ReactNode;
  route: WorkspaceRoute;
  sessions: Session[];
}

export function WorkspaceSurface({
  closeRouteSession,
  eventSocketConnected,
  hydrated,
  monitorActive,
  monitorSurface,
  navigate,
  onRestartSession,
  paneSurface,
  route,
  sessions,
}: WorkspaceSurfaceProps) {
  const routeSession =
    route.kind === "session"
      ? (sessions.find((session) => session.id === route.sessionId) ?? null)
      : null;
  const missingRouteSessionId =
    route.kind === "session" && !routeSession ? route.sessionId : null;
  const unavailableRouteSession =
    routeSession?.state === "ended" &&
    !isAutoResumable(routeSession.command, routeSession.endReason)
      ? routeSession
      : null;

  if (missingRouteSessionId) {
    return (
      <MissingSessionRouteState
        sessionId={missingRouteSessionId}
        hydrated={hydrated}
        connected={eventSocketConnected}
        onClose={() => navigate({ kind: "root" })}
      />
    );
  }

  if (unavailableRouteSession) {
    return (
      <SessionErrorState
        sessionTitle={
          unavailableRouteSession.title.trim() || unavailableRouteSession.id
        }
        command={unavailableRouteSession.command}
        endReason={unavailableRouteSession.endReason}
        onRestart={() => void onRestartSession(unavailableRouteSession.id)}
        onClose={() => closeRouteSession(unavailableRouteSession)}
      />
    );
  }

  return monitorActive ? monitorSurface : paneSurface;
}

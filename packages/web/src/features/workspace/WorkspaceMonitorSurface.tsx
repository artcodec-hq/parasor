import type { AgentState, GitState, Project, Session } from "@parasor/shared";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { MonitorView } from "../monitor/MonitorView.js";
import type { AttentionDismissals } from "./useAttentionDismissals.js";

interface WorkspaceMonitorSurfaceProps {
  agentStates: Record<string, AgentState>;
  attentionDismissed: AttentionDismissals;
  gitStates: Record<string, Record<string, GitState | null>>;
  isMobile: boolean;
  projects: Project[];
  reviewPendingSessions: Set<string>;
  sessions: Session[];
  onOpenUrl: (url: string, options?: OpenUrlOptions) => Promise<void> | void;
  onRestartSession: (sessionId: string) => Promise<void> | void;
  onToggleDrawer: () => void;
  onToggleSessionPin: (sessionId: string) => Promise<void> | void;
}

export function WorkspaceMonitorSurface({
  agentStates,
  attentionDismissed,
  gitStates,
  isMobile,
  projects,
  reviewPendingSessions,
  sessions,
  onOpenUrl,
  onRestartSession,
  onToggleDrawer,
  onToggleSessionPin,
}: WorkspaceMonitorSurfaceProps) {
  return (
    <MonitorView
      projects={projects}
      sessions={sessions}
      agentStates={agentStates}
      reviewPendingSessions={reviewPendingSessions}
      gitStates={gitStates}
      attentionDismissed={attentionDismissed}
      isMobile={isMobile}
      onToggleDrawer={onToggleDrawer}
      onRestartSession={onRestartSession}
      onOpenUrl={onOpenUrl}
      onTogglePin={onToggleSessionPin}
    />
  );
}

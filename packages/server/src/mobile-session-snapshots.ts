import type {
  AgentState,
  AppState,
  MobileSessionPane,
  MobileSessionSnapshot,
  Session,
  TerminalPresenceSnapshot,
} from "@parasor/shared";

const MOBILE_SESSION_SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOTS_PER_PROJECT = 20;
const MAX_PANES_PER_WORKTREE = 24;

export function buildMobileSessionSnapshots({
  state,
  agentStates,
  terminalPresences,
}: {
  state: Readonly<AppState>;
  agentStates: Record<string, AgentState>;
  terminalPresences: Record<string, TerminalPresenceSnapshot>;
}): Record<string, MobileSessionSnapshot[]> {
  const sessionsById = new Map(
    state.sessions.map((session) => [session.id, session]),
  );
  const out: Record<string, MobileSessionSnapshot[]> = {};

  for (const project of state.projects) {
    const projectState = state.projectStates[project.id];
    if (!projectState) continue;
    const snapshots = projectState.worktrees
      .slice(0, MAX_SNAPSHOTS_PER_PROJECT)
      .map((worktree) => ({
        projectId: project.id,
        worktreePath: worktree.path,
        snapshotVersion: MOBILE_SESSION_SNAPSHOT_VERSION,
        focusedPaneId: projectState.focusedPaneId,
        panes: worktree.panes
          .slice(0, MAX_PANES_PER_WORKTREE)
          .map((pane): MobileSessionPane => {
            if (pane.kind === "terminal" && pane.state.kind === "terminal") {
              const session = sessionsById.get(pane.state.sessionId);
              if (!session) {
                return {
                  kind: "terminal",
                  paneId: pane.id,
                  sessionId: pane.state.sessionId,
                  status: "missing-session",
                  title: "Missing terminal",
                };
              }
              return mobileTerminalPane(
                pane.id,
                session,
                agentStates[session.id],
                terminalPresences[session.id] ?? idlePresence(session.id),
              );
            }
            if (pane.kind === "browser" && pane.state.kind === "browser") {
              return {
                kind: "browser",
                paneId: pane.id,
                url: pane.state.url,
                ...(pane.state.auto ? { auto: true } : {}),
              };
            }
            if (pane.kind === "git") return { kind: "git", paneId: pane.id };
            return { kind: "files", paneId: pane.id };
          }),
      }));
    out[project.id] = snapshots;
  }

  return out;
}

function mobileTerminalPane(
  paneId: string,
  session: Session,
  agentState: AgentState | undefined,
  presence: TerminalPresenceSnapshot,
): MobileSessionPane {
  const layout = presence.layout;
  return {
    kind: "terminal",
    paneId,
    sessionId: session.id,
    status: "ready",
    title: session.title,
    sessionState: session.state,
    agentState: agentState?.lifecycle ?? "unknown",
    presence,
    display: {
      cols: layout?.cols ?? null,
      rows: layout?.rows ?? null,
    },
  };
}

function idlePresence(sessionId: string): TerminalPresenceSnapshot {
  return {
    sessionId,
    driver: { kind: "idle" },
    layout: null,
    subscribers: [],
  };
}

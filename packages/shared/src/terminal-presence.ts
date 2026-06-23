export type TerminalClientKind = "desktop" | "mobile";

export interface TerminalViewport {
  cols: number;
  rows: number;
}

export type TerminalPresenceDriver =
  | { kind: "idle" }
  | { kind: "desktop" }
  | { kind: "mobile"; clientId: string };

export type TerminalLayoutTarget =
  | ({ kind: "desktop" } & TerminalViewport)
  | ({ kind: "mobile"; ownerClientId: string } & TerminalViewport);

export interface TerminalPresenceSubscriber {
  clientId: string;
  kind: TerminalClientKind;
  viewport: TerminalViewport | null;
  subscribedAt: number;
  lastActedAt: number;
}

export interface TerminalPresenceSnapshot {
  sessionId: string;
  driver: TerminalPresenceDriver;
  layout: TerminalLayoutTarget | null;
  subscribers: TerminalPresenceSubscriber[];
}

export type TerminalMobileSubscribeMode = "auto" | "desktop";

export interface MobileSessionSnapshot {
  projectId: string;
  worktreePath: string;
  snapshotVersion: number;
  focusedPaneId: string | null;
  panes: MobileSessionPane[];
}

export type MobileSessionPane =
  | MobileSessionFilesPane
  | MobileSessionGitPane
  | MobileSessionBrowserPane
  | MobileSessionTerminalPane;

export interface MobileSessionFilesPane {
  kind: "files";
  paneId: string;
}

export interface MobileSessionGitPane {
  kind: "git";
  paneId: string;
}

export interface MobileSessionBrowserPane {
  kind: "browser";
  paneId: string;
  url: string;
  auto?: boolean;
}

export type MobileSessionTerminalPane =
  | {
      kind: "terminal";
      paneId: string;
      sessionId: string;
      status: "ready";
      title: string;
      sessionState: "spawning" | "running" | "ended";
      agentState: "idle" | "running" | "waiting" | "completed" | "unknown";
      presence: TerminalPresenceSnapshot;
      display: {
        cols: number | null;
        rows: number | null;
      };
    }
  | {
      kind: "terminal";
      paneId: string;
      sessionId: string;
      status: "missing-session";
      title: string;
    };

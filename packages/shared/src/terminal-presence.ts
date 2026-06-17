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

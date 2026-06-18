export type RuntimeServiceLifecycle =
  | "detected"
  | "reachable"
  | "localhost-only"
  | "forwarder-pending"
  | "forwarder-failed"
  | "disappeared";

export type RuntimeServiceProtocol = "http" | "https" | "unknown";

export type RuntimeServiceKind = "workspace" | "external";

export type RuntimeServiceAttributionSource =
  | "session-process-tree"
  | "process-cwd"
  | "command-line"
  | "project"
  | "none";

export type RuntimeServiceAttributionConfidence =
  | "high"
  | "medium"
  | "low"
  | "none";

export interface RuntimeServiceAttribution {
  source: RuntimeServiceAttributionSource;
  confidence: RuntimeServiceAttributionConfidence;
  projectId?: string;
  worktreePath?: string;
  sessionId?: string;
}

export interface RuntimeServiceAdvertisedUrl {
  origin: string;
  protocol: "http" | "https";
  host: string;
  hostKind: "custom" | "loopback" | "private-ip" | "public-ip";
  sourceSessionId: string;
  capturedAt: number;
  validatedListenerPid?: number;
}

export interface RuntimeServiceInfo {
  id: string;
  kind: RuntimeServiceKind;
  port: number;
  pid: number | null;
  processName?: string;
  cwd?: string;
  bindHost: string;
  connectHost: string;
  bindsAll: boolean;
  protocol: RuntimeServiceProtocol;
  serviceName?: string;
  attribution: RuntimeServiceAttribution;
  advertisedUrl?: RuntimeServiceAdvertisedUrl;
  reachable: boolean;
  reachablePort?: number;
  reachableUrl?: string;
  lifecycle: RuntimeServiceLifecycle;
  firstSeenAt: number;
  lastSeenAt: number;
  disappearedAt?: number;
  source: "scanner" | "scanner+forwarder" | "terminal-output";
}

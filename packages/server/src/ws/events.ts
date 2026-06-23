import {
  type AgentState,
  type AppState,
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  type GitState,
  type HydrationPayload,
  type MobileSessionSnapshot,
  type Notification,
  type PortInfo,
  type RuntimeServiceInfo,
  type TerminalPresenceSnapshot,
  type Worktree,
  type WsEventEnvelope,
  type WsEventMessage,
} from "@parasor/shared";
import type { WSContext } from "hono/ws";
import { PromiseMutex } from "../lib/promise-mutex.js";
import type { SessionActivityStore } from "../session-activity-store.js";

export interface HydrationSources {
  getState: () => Readonly<AppState>;
  getAgentStates: () => Record<string, AgentState>;
  getNotifications: () => Notification[];
  getPorts: () => Record<string, PortInfo[]>;
  getActivityHistory: () => ReturnType<SessionActivityStore["getRecent"]>;
  getTerminalPresences: () => Record<string, TerminalPresenceSnapshot>;
  getMobileSessionSnapshots: () => Record<string, MobileSessionSnapshot[]>;
  getServices: () => Record<string, RuntimeServiceInfo[]>;
  getGitStates: () => Record<string, Record<string, GitState | null>>;
  /**
   * Per-project worktree snapshot. Sync because it reads from a
   * runtime-maintained `WorktreeCache` -- see `wireRuntime`. Keeping
   * this synchronous lets `addClient` capture seq + state + worktrees
   * atomically in one tick, avoiding the broadcast/snapshot race that
   * would otherwise leak events to a connecting client.
   */
  getWorktrees: () => Record<string, Worktree[]>;
}

export type ClientCountListener = (count: number) => void;

// Cap retained notifications so a long-running daemon does not grow the
// hydration payload without bound (every reconnect ships the full list).
const NOTIFICATION_RETENTION_LIMIT = 200;

export class EventBus {
  private clients = new Set<WSContext>();
  private seq = 0;
  private lock = new PromiseMutex();
  private sources: HydrationSources | null = null;
  private notifications: Notification[] = [];
  private clientCountListeners = new Set<ClientCountListener>();

  setHydrationSources(sources: HydrationSources): void {
    this.sources = sources;
  }

  addNotification(n: Notification): void {
    this.notifications.push(n);
    const overflow = this.notifications.length - NOTIFICATION_RETENTION_LIMIT;
    if (overflow > 0) this.notifications.splice(0, overflow);
  }

  getNotifications(): Notification[] {
    return this.notifications;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  onClientCountChanged(listener: ClientCountListener): () => void {
    this.clientCountListeners.add(listener);
    return () => {
      this.clientCountListeners.delete(listener);
    };
  }

  async addClient(ws: WSContext): Promise<void> {
    const release = await this.lock.acquire();

    const snapshotSeq = this.seq;
    const payload: HydrationPayload = this.sources
      ? {
          seq: snapshotSeq,
          state: structuredClone(this.sources.getState()) as AppState,
          agentStates: this.sources.getAgentStates(),
          notifications: this.sources.getNotifications(),
          ports: this.sources.getPorts(),
          activityHistory: this.sources.getActivityHistory(),
          terminalPresences: this.sources.getTerminalPresences(),
          mobileSessionSnapshots: this.sources.getMobileSessionSnapshots(),
          services: this.sources.getServices(),
          gitStates: this.sources.getGitStates(),
          worktrees: this.sources.getWorktrees(),
          hostPlatform: process.platform,
        }
      : {
          seq: snapshotSeq,
          state: {
            version: 1,
            projects: [],
            projectStates: {},
            sessions: [],
            sessionRecords: [],
            ideCommands: [],
            paneCommands: [],
            serviceConfig: {
              preventIdleSleep: false,
              portDetection: "all-interfaces",
              dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
              dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
            },
          },
          agentStates: {},
          notifications: [],
          ports: {},
          activityHistory: [],
          terminalPresences: {},
          mobileSessionSnapshots: {},
          services: {},
          gitStates: {},
          worktrees: {},
          hostPlatform: process.platform,
        };

    this.clients.add(ws);
    ws.send(JSON.stringify({ type: "app-state-snapshot", payload }));
    release();
    this.emitClientCount();
  }

  removeClient(ws: WSContext): void {
    const had = this.clients.delete(ws);
    if (had) this.emitClientCount();
  }

  private emitClientCount(): void {
    const count = this.clients.size;
    for (const listener of this.clientCountListeners) {
      listener(count);
    }
  }

  broadcast(message: WsEventMessage): void {
    this.seq++;
    const envelope: WsEventEnvelope = { seq: this.seq, message };
    const data = JSON.stringify(envelope);
    let dropped = false;
    for (const client of this.clients) {
      if (client.readyState === 1) {
        try {
          client.send(data);
        } catch {
          this.clients.delete(client);
          dropped = true;
        }
      }
    }
    if (dropped) this.emitClientCount();
  }
}

/**
 * Handle a single client->server frame on `/ws/events`. The browser
 * cannot issue WS-protocol pings from JS, so we offer an app-layer
 * ping that detects silent-dead TCP paths (NAT idle timeout, mobile
 * background freeze) where neither side observes a close. Echoes
 * `pong` with the same `ts`. Unknown / malformed frames are ignored
 * -- forward-compat for future client->server messages.
 */
export function handleEventClientMessage(
  ws: Pick<WSContext, "send">,
  raw: unknown,
): void {
  if (typeof raw !== "string") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    (parsed as { type?: unknown }).type !== "ping" ||
    !Number.isFinite((parsed as { ts?: unknown }).ts)
  ) {
    return;
  }
  ws.send(JSON.stringify({ type: "pong", ts: (parsed as { ts: number }).ts }));
}

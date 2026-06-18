import type {
  TerminalLayoutTarget,
  TerminalMobileSubscribeMode,
  TerminalPresenceDriver,
  TerminalPresenceSnapshot,
  TerminalPresenceSubscriber,
  TerminalViewport,
} from "@parasor/shared";

export type TerminalPresenceEffect =
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "presence-changed"; snapshot: TerminalPresenceSnapshot };

export interface TerminalPresenceUpdate {
  snapshot: TerminalPresenceSnapshot;
  effects: TerminalPresenceEffect[];
}

export interface TerminalPresenceManagerOptions {
  softLeaveMs?: number;
  now?: () => number;
  onEffects?: (effects: TerminalPresenceEffect[]) => void;
}

interface SubscriberRecord extends TerminalPresenceSubscriber {
  leaving: boolean;
}

interface SessionPresenceState {
  driver: TerminalPresenceDriver;
  layout: TerminalLayoutTarget | null;
  desktopBaseline: TerminalViewport | null;
  subscribers: Map<string, SubscriberRecord>;
  softLeaveTimers: Map<string, ReturnType<typeof setTimeout>>;
}

const DEFAULT_SOFT_LEAVE_MS = 250;

export class TerminalPresenceManager {
  private readonly softLeaveMs: number;
  private readonly now: () => number;
  private readonly onEffects?: (effects: TerminalPresenceEffect[]) => void;
  private readonly sessions = new Map<string, SessionPresenceState>();

  constructor(options: TerminalPresenceManagerOptions = {}) {
    this.softLeaveMs = options.softLeaveMs ?? DEFAULT_SOFT_LEAVE_MS;
    this.now = options.now ?? Date.now;
    this.onEffects = options.onEffects;
  }

  get(sessionId: string): TerminalPresenceSnapshot {
    return this.snapshot(sessionId, this.getOrCreate(sessionId));
  }

  subscribeMobile(
    sessionId: string,
    clientId: string,
    viewport: TerminalViewport,
    mode: TerminalMobileSubscribeMode = "auto",
  ): TerminalPresenceUpdate {
    const state = this.getOrCreate(sessionId);
    this.cancelSoftLeave(state, clientId);

    const existing = state.subscribers.get(clientId);
    const at = this.now();
    state.subscribers.set(clientId, {
      clientId,
      kind: "mobile",
      viewport,
      subscribedAt: existing?.subscribedAt ?? at,
      lastActedAt:
        mode === "auto" && state.driver.kind !== "desktop"
          ? at
          : (existing?.lastActedAt ?? at),
      leaving: false,
    });

    const effects: TerminalPresenceEffect[] = [];
    if (mode === "auto" && state.driver.kind !== "desktop") {
      effects.push(...this.takeMobileFloor(sessionId, state, clientId));
    }
    effects.push(this.presenceChanged(sessionId, state));
    return this.update(sessionId, state, effects);
  }

  updateMobileViewport(
    sessionId: string,
    clientId: string,
    viewport: TerminalViewport,
  ): TerminalPresenceUpdate {
    const state = this.getOrCreate(sessionId);
    const subscriber = state.subscribers.get(clientId);
    const effects: TerminalPresenceEffect[] = [];
    if (subscriber) {
      subscriber.viewport = viewport;
      subscriber.leaving = false;
      if (
        state.driver.kind === "mobile" &&
        state.driver.clientId === clientId
      ) {
        effects.push(
          ...this.applyMobileLayout(sessionId, state, clientId, viewport),
        );
      }
    }
    effects.push(this.presenceChanged(sessionId, state));
    return this.update(sessionId, state, effects);
  }

  markMobileActed(sessionId: string, clientId: string): TerminalPresenceUpdate {
    const state = this.getOrCreate(sessionId);
    this.cancelSoftLeave(state, clientId);
    const subscriber = state.subscribers.get(clientId);
    const effects: TerminalPresenceEffect[] = [];
    if (subscriber?.viewport) {
      subscriber.leaving = false;
      subscriber.lastActedAt = this.now();
      effects.push(...this.takeMobileFloor(sessionId, state, clientId));
    }
    effects.push(this.presenceChanged(sessionId, state));
    return this.update(sessionId, state, effects);
  }

  unsubscribeMobile(
    sessionId: string,
    clientId: string,
  ): TerminalPresenceUpdate {
    const state = this.getOrCreate(sessionId);
    const subscriber = state.subscribers.get(clientId);
    if (!subscriber) return this.update(sessionId, state, []);

    const remaining = this.activeMobileSubscribers(state).filter(
      (candidate) => candidate.clientId !== clientId,
    );
    const effects: TerminalPresenceEffect[] = [];

    if (remaining.length > 0) {
      state.subscribers.delete(clientId);
      this.cancelSoftLeave(state, clientId);
      if (
        state.driver.kind === "mobile" &&
        state.driver.clientId === clientId
      ) {
        const next = this.selectLatestActor(remaining);
        effects.push(...this.takeMobileFloor(sessionId, state, next.clientId));
      }
      effects.push(this.presenceChanged(sessionId, state));
      return this.update(sessionId, state, effects);
    }

    subscriber.leaving = true;
    this.cancelSoftLeave(state, clientId);
    const timer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (!current) return;
      const record = current.subscribers.get(clientId);
      if (!record?.leaving) return;
      current.subscribers.delete(clientId);
      current.softLeaveTimers.delete(clientId);
      if (
        current.driver.kind === "mobile" &&
        this.activeMobileSubscribers(current).length === 0
      ) {
        current.driver = { kind: "idle" };
        current.layout = null;
      }
      this.emit([this.presenceChanged(sessionId, current)]);
    }, this.softLeaveMs);
    state.softLeaveTimers.set(clientId, timer);

    effects.push(this.presenceChanged(sessionId, state));
    return this.update(sessionId, state, effects);
  }

  recordDesktopGeometry(
    sessionId: string,
    viewport: TerminalViewport,
  ): TerminalPresenceUpdate {
    const state = this.getOrCreate(sessionId);
    state.desktopBaseline = { ...viewport };
    if (state.driver.kind !== "mobile") {
      state.layout = { kind: "desktop", ...viewport };
    }
    return this.update(sessionId, state, [
      this.presenceChanged(sessionId, state),
    ]);
  }

  reclaimForDesktop(sessionId: string): TerminalPresenceUpdate {
    const state = this.getOrCreate(sessionId);
    const effects: TerminalPresenceEffect[] = [];
    state.driver = { kind: "desktop" };
    if (state.desktopBaseline) {
      const nextLayout: TerminalLayoutTarget = {
        kind: "desktop",
        ...state.desktopBaseline,
      };
      if (!sameLayout(state.layout, nextLayout)) {
        effects.push({
          type: "resize",
          sessionId,
          cols: nextLayout.cols,
          rows: nextLayout.rows,
        });
      }
      state.layout = nextLayout;
    }
    effects.push(this.presenceChanged(sessionId, state));
    return this.update(sessionId, state, effects);
  }

  canWrite(
    sessionId: string,
    client: { kind: "desktop" | "mobile"; clientId: string },
  ): boolean {
    const state = this.getOrCreate(sessionId);
    if (client.kind === "mobile") {
      return state.subscribers.get(client.clientId)?.leaving === false;
    }
    return state.driver.kind !== "mobile";
  }

  canResize(
    sessionId: string,
    client: { kind: "desktop" | "mobile"; clientId: string },
  ): boolean {
    return this.canWrite(sessionId, client);
  }

  resetSession(sessionId: string): TerminalPresenceUpdate {
    const existing = this.sessions.get(sessionId);
    if (existing) this.clearTimers(existing);
    this.sessions.delete(sessionId);
    const state = this.getOrCreate(sessionId);
    return this.update(sessionId, state, [
      this.presenceChanged(sessionId, state),
    ]);
  }

  private getOrCreate(sessionId: string): SessionPresenceState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const state: SessionPresenceState = {
      driver: { kind: "idle" },
      layout: null,
      desktopBaseline: null,
      subscribers: new Map(),
      softLeaveTimers: new Map(),
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  private takeMobileFloor(
    sessionId: string,
    state: SessionPresenceState,
    clientId: string,
  ): TerminalPresenceEffect[] {
    const subscriber = state.subscribers.get(clientId);
    if (!subscriber?.viewport) return [];
    state.driver = { kind: "mobile", clientId };
    return this.applyMobileLayout(
      sessionId,
      state,
      clientId,
      subscriber.viewport,
    );
  }

  private applyMobileLayout(
    sessionId: string,
    state: SessionPresenceState,
    clientId: string,
    viewport: TerminalViewport,
  ): TerminalPresenceEffect[] {
    const nextLayout: TerminalLayoutTarget = {
      kind: "mobile",
      ownerClientId: clientId,
      ...viewport,
    };
    const effects: TerminalPresenceEffect[] = [];
    if (!sameLayout(state.layout, nextLayout)) {
      effects.push({
        type: "resize",
        sessionId,
        cols: viewport.cols,
        rows: viewport.rows,
      });
    }
    state.layout = nextLayout;
    return effects;
  }

  private activeMobileSubscribers(
    state: SessionPresenceState,
  ): SubscriberRecord[] {
    return [...state.subscribers.values()].filter(
      (subscriber) => subscriber.kind === "mobile" && !subscriber.leaving,
    );
  }

  private selectLatestActor(records: SubscriberRecord[]): SubscriberRecord {
    return [...records].sort((a, b) => {
      if (b.lastActedAt !== a.lastActedAt) return b.lastActedAt - a.lastActedAt;
      return b.subscribedAt - a.subscribedAt;
    })[0];
  }

  private snapshot(
    sessionId: string,
    state: SessionPresenceState,
  ): TerminalPresenceSnapshot {
    return {
      sessionId,
      driver: { ...state.driver },
      layout: state.layout ? { ...state.layout } : null,
      subscribers: [...state.subscribers.values()]
        .filter((subscriber) => !subscriber.leaving)
        .map(({ leaving: _leaving, ...subscriber }) => ({
          ...subscriber,
          viewport: subscriber.viewport ? { ...subscriber.viewport } : null,
        })),
    };
  }

  private presenceChanged(
    sessionId: string,
    state: SessionPresenceState,
  ): TerminalPresenceEffect {
    return {
      type: "presence-changed",
      snapshot: this.snapshot(sessionId, state),
    };
  }

  private update(
    sessionId: string,
    state: SessionPresenceState,
    effects: TerminalPresenceEffect[],
  ): TerminalPresenceUpdate {
    this.emit(effects);
    return { snapshot: this.snapshot(sessionId, state), effects };
  }

  private emit(effects: TerminalPresenceEffect[]): void {
    if (effects.length === 0) return;
    this.onEffects?.(effects);
  }

  private cancelSoftLeave(state: SessionPresenceState, clientId: string): void {
    const timer = state.softLeaveTimers.get(clientId);
    if (!timer) return;
    clearTimeout(timer);
    state.softLeaveTimers.delete(clientId);
    const subscriber = state.subscribers.get(clientId);
    if (subscriber) subscriber.leaving = false;
  }

  private clearTimers(state: SessionPresenceState): void {
    for (const timer of state.softLeaveTimers.values()) clearTimeout(timer);
    state.softLeaveTimers.clear();
  }
}

function sameLayout(
  a: TerminalLayoutTarget | null,
  b: TerminalLayoutTarget,
): boolean {
  if (!a) return false;
  if (a.kind !== b.kind) return false;
  if (a.cols !== b.cols || a.rows !== b.rows) return false;
  if (a.kind === "mobile" && b.kind === "mobile") {
    return a.ownerClientId === b.ownerClientId;
  }
  return true;
}

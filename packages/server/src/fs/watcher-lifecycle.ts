export interface WatcherLifecycleOpts {
  onActivate: (projectId: string) => Promise<void>;
  onSuspend: (projectId: string) => Promise<void>;
  idleTimeoutMs?: number;
  /**
   * When false, counters still increment but `state` stays `suspended`
   * and `onActivate` is not called. Used for missing project roots.
   */
  shouldActivate?: (projectId: string) => boolean;
}

interface ProjectActivity {
  activeSessions: number;
  clientsFocused: number;
  state: "active" | "suspended";
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export class WatcherLifecycle {
  private readonly projects = new Map<string, ProjectActivity>();
  private readonly onActivate: (projectId: string) => Promise<void>;
  private readonly onSuspend: (projectId: string) => Promise<void>;
  private readonly idleTimeoutMs: number;
  private readonly shouldActivate: (projectId: string) => boolean;

  constructor(opts: WatcherLifecycleOpts) {
    this.onActivate = opts.onActivate;
    this.onSuspend = opts.onSuspend;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
    this.shouldActivate = opts.shouldActivate ?? (() => true);
  }

  async onSessionCreated(projectId: string): Promise<void> {
    const activity = this.getOrCreate(projectId);
    activity.activeSessions++;
    this.cancelIdle(activity);
    await this.activateIfAllowed(projectId, activity);
  }

  async onSessionEnded(projectId: string): Promise<void> {
    const activity = this.projects.get(projectId);
    if (!activity) return;
    activity.activeSessions = Math.max(0, activity.activeSessions - 1);
    this.scheduleIdleCheck(projectId, activity);
  }

  async onClientFocused(projectId: string): Promise<void> {
    const activity = this.getOrCreate(projectId);
    activity.clientsFocused++;
    this.cancelIdle(activity);
    await this.activateIfAllowed(projectId, activity);
  }

  async onClientFocusLost(projectId: string): Promise<void> {
    const activity = this.projects.get(projectId);
    if (!activity) return;
    activity.clientsFocused = Math.max(0, activity.clientsFocused - 1);
    this.scheduleIdleCheck(projectId, activity);
  }

  async onProjectDeleted(projectId: string): Promise<void> {
    const activity = this.projects.get(projectId);
    if (!activity) return;
    this.cancelIdle(activity);
    if (activity.state === "active") {
      await this.onSuspend(projectId);
    }
    this.projects.delete(projectId);
  }

  /**
   * Restore-only. Callers must have counters > 0. Does nothing when
   * `shouldActivate` is false (missing root).
   */
  async ensureActive(projectId: string): Promise<void> {
    if (!this.shouldActivate(projectId)) return;
    const activity = this.getOrCreate(projectId);
    this.cancelIdle(activity);
    if (activity.state === "suspended") {
      activity.state = "active";
      await this.onActivate(projectId);
    }
  }

  async forceSuspend(projectId: string): Promise<void> {
    const activity = this.projects.get(projectId);
    if (!activity) return;
    this.cancelIdle(activity);
    if (activity.state === "active") {
      activity.state = "suspended";
      await this.onSuspend(projectId);
    }
  }

  isActive(projectId: string): boolean {
    return this.projects.get(projectId)?.state === "active";
  }

  hasInterest(projectId: string): boolean {
    const activity = this.projects.get(projectId);
    if (!activity) return false;
    return activity.activeSessions > 0 || activity.clientsFocused > 0;
  }

  dispose(): void {
    for (const activity of this.projects.values()) {
      this.cancelIdle(activity);
    }
    this.projects.clear();
  }

  private async activateIfAllowed(
    projectId: string,
    activity: ProjectActivity,
  ): Promise<void> {
    if (activity.state !== "suspended") return;
    if (!this.shouldActivate(projectId)) return;
    activity.state = "active";
    await this.onActivate(projectId);
  }

  private getOrCreate(projectId: string): ProjectActivity {
    let activity = this.projects.get(projectId);
    if (!activity) {
      activity = {
        activeSessions: 0,
        clientsFocused: 0,
        state: "suspended",
        idleTimer: null,
      };
      this.projects.set(projectId, activity);
    }
    return activity;
  }

  private scheduleIdleCheck(
    projectId: string,
    activity: ProjectActivity,
  ): void {
    if (activity.activeSessions > 0 || activity.clientsFocused > 0) return;
    if (activity.state === "suspended") return;

    this.cancelIdle(activity);
    activity.idleTimer = setTimeout(async () => {
      activity.idleTimer = null;
      if (activity.activeSessions === 0 && activity.clientsFocused === 0) {
        activity.state = "suspended";
        await this.onSuspend(projectId);
      }
    }, this.idleTimeoutMs);
  }

  private cancelIdle(activity: ProjectActivity): void {
    if (activity.idleTimer) {
      clearTimeout(activity.idleTimer);
      activity.idleTimer = null;
    }
  }
}

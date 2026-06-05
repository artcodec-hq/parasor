export interface WatcherLifecycleOpts {
  onActivate: (projectId: string) => Promise<void>;
  onSuspend: (projectId: string) => Promise<void>;
  idleTimeoutMs?: number;
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

  constructor(opts: WatcherLifecycleOpts) {
    this.onActivate = opts.onActivate;
    this.onSuspend = opts.onSuspend;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
  }

  async onSessionCreated(projectId: string): Promise<void> {
    const activity = this.getOrCreate(projectId);
    activity.activeSessions++;
    this.cancelIdle(activity);
    if (activity.state === "suspended") {
      activity.state = "active";
      await this.onActivate(projectId);
    }
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
    if (activity.state === "suspended") {
      activity.state = "active";
      await this.onActivate(projectId);
    }
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

  async ensureActive(projectId: string): Promise<void> {
    const activity = this.getOrCreate(projectId);
    this.cancelIdle(activity);
    if (activity.state === "suspended") {
      activity.state = "active";
      await this.onActivate(projectId);
    }
  }

  isActive(projectId: string): boolean {
    return this.projects.get(projectId)?.state === "active";
  }

  dispose(): void {
    for (const activity of this.projects.values()) {
      this.cancelIdle(activity);
    }
    this.projects.clear();
  }

  private getOrCreate(projectId: string): ProjectActivity {
    let activity = this.projects.get(projectId);
    if (!activity) {
      activity = {
        activeSessions: 0,
        clientsFocused: 0,
        state: "active",
        idleTimer: null,
      };
      this.projects.set(projectId, activity);
      this.onActivate(projectId).catch(() => {});
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

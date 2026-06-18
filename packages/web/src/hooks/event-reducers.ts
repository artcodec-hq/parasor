import type {
  AgentState,
  GitState,
  HydrationPayload,
  IdeCommandConfig,
  Notification,
  PaneCommandConfig,
  PortInfo,
  Project,
  ProjectState,
  RuntimeServiceInfo,
  ServiceConfig,
  Session,
  Worktree,
  WsEventMessage,
} from "@parasor/shared";
import {
  createEmptyProjectSidebarState,
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
} from "@parasor/shared";

// Mirror the server's `NOTIFICATION_RETENTION_LIMIT`. Even with a server
// cap, a long-lived tab can outlast many incremental `notification` events
// (notifications older than the snapshot keep accumulating client-side
// until the next hydration), so trim here too.
const NOTIFICATION_RETENTION_LIMIT = 200;

const STORE_CACHE_KEY = "parasor:store-cache";
// v7: ProjectState.sidebar added to cached server-store subset.
// v6: ideCommands added to the cached server-store subset.
// v5: paneCommands added to the cached server-store subset.
// v4: gitStates reshaped from `Record<projectId, GitState>` to per-worktree
// `Record<projectId, Record<worktreePath, GitState>>`. Bump rather than
// migrate -- caches are ephemeral and the next snapshot rehydrates fresh.
const STORE_CACHE_VERSION = 7;

/*
 * Snapshot of the store fields that the sidebar's two-line project rows
 * need on first paint after a reload. Without `sessions` / `agentStates` /
 * `gitStates` cached, line 1 (project name) renders immediately from the
 * cache while line 2 (branch / session count / agent dot) stays blank
 * until the WebSocket snapshot arrives ~1s later -- a visible flash. We
 * accept a short window of mildly stale data here because it's overwritten
 * the moment the real snapshot lands.
 */
interface CachedStorePayload {
  version: number;
  projects: Project[];
  projectStates: Record<string, ProjectState>;
  sessions: Session[];
  agentStates: Record<string, AgentState>;
  gitStates: Record<string, Record<string, GitState | null>>;
  paneCommands: PaneCommandConfig[];
  ideCommands: IdeCommandConfig[];
}

export interface AppStore {
  projects: Project[];
  projectStates: Record<string, ProjectState>;
  sessions: Session[];
  agentStates: Record<string, AgentState>;
  notifications: Notification[];
  ports: Record<string, PortInfo[]>;
  services: Record<string, RuntimeServiceInfo[]>;
  /**
   * Per-worktree git state. Outer key = projectId, inner key = absolute
   * worktree path. Use `pickGitState(store, projectId, worktreePath)` for
   * lookups so a missing project or worktree returns `null` cleanly.
   */
  gitStates: Record<string, Record<string, GitState | null>>;
  serviceConfig: ServiceConfig;
  paneCommands: PaneCommandConfig[];
  ideCommands: IdeCommandConfig[];
  hostPlatform: NodeJS.Platform | null;
  fileChangeSeq: number;
  /**
   * Per-project worktree list (`git worktree list --porcelain` snapshot).
   * Hydrated on connect and updated incrementally via `worktree-created`
   * events so all tabs share a single source of truth without per-project
   * REST fetches.
   */
  worktrees: Record<string, Worktree[]>;
  pendingOpenUrl: string | null;
  connected: boolean;
  hydrated: boolean;
  snapshotApplied: boolean;
}

export const EMPTY_STORE: AppStore = {
  projects: [],
  projectStates: {},
  sessions: [],
  agentStates: {},
  notifications: [],
  ports: {},
  services: {},
  gitStates: {},
  serviceConfig: {
    preventIdleSleep: false,
    portDetection: "all-interfaces",
    dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
    dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  },
  paneCommands: [],
  ideCommands: [],
  hostPlatform: null,
  fileChangeSeq: 0,
  worktrees: {},
  pendingOpenUrl: null,
  connected: false,
  hydrated: false,
  snapshotApplied: false,
};

export function applyEvent(store: AppStore, msg: WsEventMessage): AppStore {
  switch (msg.type) {
    case "session-created":
      return { ...store, sessions: [...store.sessions, msg.session] };

    case "session-closed": {
      const agentStates = { ...store.agentStates };
      delete agentStates[msg.sessionId];
      return {
        ...store,
        sessions: store.sessions.filter((s) => s.id !== msg.sessionId),
        agentStates,
      };
    }

    case "session-restarted": {
      const existing = store.sessions.find((s) => s.id === msg.session.id);
      if (existing && msg.generation < existing.generation) return store;
      return {
        ...store,
        sessions: store.sessions.map((s) =>
          s.id === msg.session.id ? msg.session : s,
        ),
      };
    }

    case "session-ended": {
      const existing = store.sessions.find((s) => s.id === msg.sessionId);
      if (existing && msg.generation < existing.generation) return store;
      return {
        ...store,
        sessions: store.sessions.map((s) =>
          s.id === msg.sessionId
            ? {
                ...s,
                state: "ended" as const,
                pid: null,
                endedAt: Date.now(),
                endReason: msg.endReason,
              }
            : s,
        ),
      };
    }

    case "agent-state":
      return {
        ...store,
        agentStates: { ...store.agentStates, [msg.state.sessionId]: msg.state },
      };

    case "notification": {
      const next = [msg.notification, ...store.notifications];
      if (next.length > NOTIFICATION_RETENTION_LIMIT) {
        next.length = NOTIFICATION_RETENTION_LIMIT;
      }
      return { ...store, notifications: next };
    }

    case "project-created": {
      const exists = store.projects.some((p) => p.id === msg.project.id);
      const projects = exists
        ? store.projects.map((p) => (p.id === msg.project.id ? msg.project : p))
        : [...store.projects, msg.project];
      const projectStates =
        msg.project.id in store.projectStates
          ? store.projectStates
          : {
              ...store.projectStates,
              [msg.project.id]: {
                projectId: msg.project.id,
                layout: null,
                worktrees: [],
                openFiles: [],
                lastFocusedPaneId: null,
                focusedPaneId: null,
                sidebar: createEmptyProjectSidebarState(),
                lastAccessedAt: msg.project.createdAt,
              },
            };
      return { ...store, projects, projectStates };
    }

    case "project-updated":
      return {
        ...store,
        projects: store.projects.map((p) =>
          p.id === msg.project.id ? msg.project : p,
        ),
      };

    case "project-deleted": {
      const deletedSessions = new Set(
        store.sessions
          .filter((s) => s.projectId === msg.projectId)
          .map((s) => s.id),
      );
      const agentStates = { ...store.agentStates };
      for (const sid of deletedSessions) delete agentStates[sid];
      const { [msg.projectId]: _, ...projectStates } = store.projectStates;
      const { [msg.projectId]: _wt, ...worktrees } = store.worktrees;
      const { [msg.projectId]: _gs, ...gitStates } = store.gitStates;
      const { [msg.projectId]: _ports, ...ports } = store.ports;
      const { [msg.projectId]: _services, ...services } = store.services;
      return {
        ...store,
        projects: store.projects.filter((p) => p.id !== msg.projectId),
        sessions: store.sessions.filter((s) => s.projectId !== msg.projectId),
        projectStates,
        agentStates,
        ports,
        services,
        gitStates,
        worktrees,
      };
    }

    case "layout-updated": {
      const existing = store.projectStates[msg.projectId];
      if (!existing) return store;
      return {
        ...store,
        projectStates: {
          ...store.projectStates,
          [msg.projectId]: { ...existing, layout: msg.layout },
        },
      };
    }

    case "ports-updated":
      return {
        ...store,
        ports: { ...store.ports, [msg.projectId]: msg.ports },
      };

    case "services-updated":
      return {
        ...store,
        services: { ...store.services, [msg.projectId]: msg.services },
      };

    case "git-state": {
      const existing = store.gitStates[msg.projectId] ?? {};
      // null state still gets stored so the UI can distinguish "no data
      // yet" (undefined) from "watcher reported empty" (null).
      const nextProject = { ...existing, [msg.worktreePath]: msg.state };
      return {
        ...store,
        gitStates: { ...store.gitStates, [msg.projectId]: nextProject },
      };
    }

    case "session-cwd-changed":
      return {
        ...store,
        sessions: store.sessions.map((s) =>
          s.id === msg.sessionId ? { ...s, cwd: msg.cwd } : s,
        ),
      };

    case "session-title-changed":
      return {
        ...store,
        sessions: store.sessions.map((s) => {
          if (s.id !== msg.sessionId) return s;
          if (msg.titleManual === true) {
            return { ...s, title: msg.title, titleManual: true };
          }
          const { titleManual: _drop, ...rest } = s;
          return { ...rest, title: msg.title };
        }),
      };

    case "session-pin-changed":
      return {
        ...store,
        sessions: store.sessions.map((s) => {
          if (s.id !== msg.sessionId) return s;
          if (msg.pinned) return { ...s, pinned: true };
          const { pinned: _drop, ...rest } = s;
          return rest;
        }),
      };

    case "file-change":
    case "gitignore-updated":
      return { ...store, fileChangeSeq: store.fileChangeSeq + 1 };

    case "browser-url-changed":
      return { ...store, pendingOpenUrl: msg.url };

    case "service-config-changed":
      return { ...store, serviceConfig: msg.config };

    case "sidebar-state-changed": {
      const existing = store.projectStates[msg.projectId];
      if (!existing) return store;
      return {
        ...store,
        projectStates: {
          ...store.projectStates,
          [msg.projectId]: { ...existing, sidebar: msg.sidebar },
        },
      };
    }

    case "pane-commands-changed":
      return { ...store, paneCommands: msg.commands };

    case "ide-commands-changed":
      return { ...store, ideCommands: msg.commands };

    case "worktree-created": {
      // Drop events for projects no longer in the store. The server
      // re-broadcasts worktrees on project-created via an async git
      // enumeration, so a project-created -> project-deleted race could
      // otherwise leak orphan worktrees back into the store.
      if (!store.projects.some((p) => p.id === msg.projectId)) return store;
      const existing = store.worktrees[msg.projectId] ?? [];
      const idx = existing.findIndex((w) => w.path === msg.worktree.path);
      // Upsert by path: a re-broadcast carrying refreshed
      // ahead/behind/dirtyCount must overwrite the existing entry so the
      // sidebar counters update. Drop-on-duplicate would leave the row
      // stuck at the values from the first broadcast.
      const next =
        idx === -1
          ? [...existing, msg.worktree]
          : existing.map((w, i) => (i === idx ? { ...w, ...msg.worktree } : w));
      return {
        ...store,
        worktrees: {
          ...store.worktrees,
          [msg.projectId]: next,
        },
      };
    }

    case "worktree-renamed": {
      const existing = store.worktrees[msg.projectId];
      if (!existing) return store;
      const next = existing.map((w) =>
        w.path === msg.worktreePath ? { ...w, branch: msg.newBranch } : w,
      );
      return {
        ...store,
        worktrees: {
          ...store.worktrees,
          [msg.projectId]: next,
        },
      };
    }

    case "worktree-removed": {
      const existing = store.worktrees[msg.projectId];
      if (!existing) return store;
      const next = existing.filter((w) => w.path !== msg.worktreePath);
      const nextWorktrees = { ...store.worktrees, [msg.projectId]: next };
      // Strip per-worktree git state for the removed entry so stale ahead
      // / behind / dirty values cannot leak back into a future re-add.
      const projectGitStates = store.gitStates[msg.projectId];
      let nextGitStates = store.gitStates;
      if (projectGitStates && msg.worktreePath in projectGitStates) {
        const { [msg.worktreePath]: _drop, ...rest } = projectGitStates;
        nextGitStates = { ...store.gitStates, [msg.projectId]: rest };
      }
      return {
        ...store,
        worktrees: nextWorktrees,
        gitStates: nextGitStates,
      };
    }

    default:
      return store;
  }
}

export function applySnapshot(payload: HydrationPayload): AppStore {
  return {
    projects: payload.state.projects,
    projectStates: payload.state.projectStates,
    sessions: payload.state.sessions,
    agentStates: payload.agentStates,
    // Server keeps insertion order (oldest->newest) but the incremental
    // `notification` reducer prepends each new entry, so live state is
    // newest->oldest. Reverse the hydration payload to keep the orientation
    // consistent across reconnects -- otherwise the list flips direction
    // every time the snapshot is reapplied.
    notifications: [...payload.notifications].reverse(),
    ports: payload.ports,
    services: payload.services ?? {},
    gitStates: payload.gitStates,
    serviceConfig: payload.state.serviceConfig,
    paneCommands: payload.state.paneCommands ?? [],
    ideCommands: payload.state.ideCommands ?? [],
    hostPlatform: payload.hostPlatform,
    fileChangeSeq: 0,
    worktrees: payload.worktrees ?? {},
    pendingOpenUrl: null,
    connected: true,
    hydrated: true,
    snapshotApplied: true,
  };
}

export function loadCachedStore(): AppStore | null {
  try {
    const raw = localStorage.getItem(STORE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStorePayload;
    if (parsed.version !== STORE_CACHE_VERSION) return null;
    if (
      !Array.isArray(parsed.projects) ||
      typeof parsed.projectStates !== "object"
    ) {
      return null;
    }
    return {
      ...EMPTY_STORE,
      projects: parsed.projects,
      projectStates: parsed.projectStates,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      agentStates:
        parsed.agentStates && typeof parsed.agentStates === "object"
          ? parsed.agentStates
          : {},
      gitStates:
        parsed.gitStates && typeof parsed.gitStates === "object"
          ? parsed.gitStates
          : {},
      paneCommands: Array.isArray(parsed.paneCommands)
        ? parsed.paneCommands
        : [],
      ideCommands: Array.isArray(parsed.ideCommands) ? parsed.ideCommands : [],
      hydrated: true,
    };
  } catch {
    return null;
  }
}

export function persistCachedStore(store: AppStore): void {
  try {
    const payload: CachedStorePayload = {
      version: STORE_CACHE_VERSION,
      projects: store.projects,
      projectStates: store.projectStates,
      sessions: store.sessions,
      agentStates: store.agentStates,
      gitStates: store.gitStates,
      paneCommands: store.paneCommands,
      ideCommands: store.ideCommands,
    };
    localStorage.setItem(STORE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage unavailable -- non-fatal.
  }
}

export function clearCachedStore(): void {
  try {
    localStorage.removeItem(STORE_CACHE_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * Look up a worktree's git state. Returns `null` when the project hasn't
 * been hydrated yet OR when no broadcast has arrived for the worktree.
 * Callers that distinguish "loading" from "empty" should also check
 * `store.snapshotApplied`.
 */
export function pickGitState(
  store: AppStore,
  projectId: string | null | undefined,
  worktreePath: string | null | undefined,
): GitState | null {
  if (!projectId || !worktreePath) return null;
  return store.gitStates[projectId]?.[worktreePath] ?? null;
}

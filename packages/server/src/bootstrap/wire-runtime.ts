import { randomUUID } from "node:crypto";
import type {
  AgentLifecycle,
  AppState,
  Notification,
  PortInfo,
  SessionActivityRecord,
  SessionActivitySource,
  SessionEndReason,
} from "@parasor/shared";
import type { AgentStateStore } from "../agent-detector/agent-state-store.js";
import type { AgentDetector } from "../agent-detector/detector.js";
import { ManualAgentTracker } from "../agent-detector/manual-agent-tracker.js";
import {
  shouldAllowManualAgentOutputFallback,
  shouldObserveAgentOutput,
} from "../agent-detector/output-eligibility.js";
import { createProjectQueries } from "../application/workspace/project-queries.js";
import type { AgentStatusRecorder } from "../debug/agent-status-recorder.js";
import type { UploadStaging } from "../fs/upload-staging.js";
import type { IpcServer } from "../ipc/socket-server.js";
import { buildMobileSessionSnapshots } from "../mobile-session-snapshots.js";
import type { PtyHost } from "../pty/host.js";
import { Osc7Lifecycle } from "../pty/osc7-lifecycle.js";
import { TerminalPresenceManager } from "../pty/terminal-presence-manager.js";
import type { RuntimeServiceAdvertisedUrlWatcher } from "../runtime-services/advertised-url-watcher.js";
import {
  projectServicesToPorts,
  type RuntimeServiceRegistry,
} from "../runtime-services/service-registry.js";
import type { SessionActivityStore } from "../session-activity-store.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { WorktreeCache } from "../state/worktree-cache.js";
import type { EventBus } from "../ws/events.js";
import type { ProjectPresence } from "./project-presence.js";
import type { ProjectRuntime } from "./project-runtime.js";

export interface WireRuntimeDeps {
  appStateStore: AppStateStore;
  eventBus: EventBus;
  sessionActivityStore: SessionActivityStore;
  serviceRegistry: RuntimeServiceRegistry;
  advertisedUrlWatcher: RuntimeServiceAdvertisedUrlWatcher;
  terminalPresenceManager?: TerminalPresenceManager;
  ptyManager: PtyHost;
  agentDetector: AgentDetector;
  agentStateStore: AgentStateStore;
  debugRecorder?: AgentStatusRecorder;
  ipcServer: IpcServer;
  projectManager: ProjectManager;
  projectRuntime: ProjectRuntime;
  worktreeCache: WorktreeCache;
  uploadStaging: UploadStaging;
  projectPresence?: ProjectPresence;
}

export function createWaitingNotification(
  sessionId: string,
  projectId: string,
  now = Date.now(),
): Notification {
  return {
    id: randomUUID(),
    projectId,
    sessionId,
    type: "agent-waiting",
    title: "Agent waiting",
    message: "Agent is waiting for input",
    timestamp: now,
    read: false,
  };
}

export function buildHydrationStateSnapshot({
  appStateStore,
  ptyManager,
}: {
  appStateStore: AppStateStore;
  ptyManager: PtyHost;
}): AppState {
  const state = appStateStore.get();
  return {
    ...state,
    sessions: ptyManager.list(),
  };
}

export function wireRuntime({
  appStateStore,
  eventBus,
  sessionActivityStore,
  serviceRegistry,
  advertisedUrlWatcher,
  terminalPresenceManager = new TerminalPresenceManager(),
  ptyManager,
  agentDetector,
  agentStateStore,
  debugRecorder,
  ipcServer,
  projectManager,
  projectRuntime,
  worktreeCache,
  uploadStaging,
  projectPresence,
}: WireRuntimeDeps): void {
  const projectQueries = createProjectQueries({
    projectManager,
    getWorktreeMetadata: (projectId) =>
      appStateStore.get().projectStates[projectId]?.worktreeMetadata ?? {},
  });
  const getLiveSessionIds = () =>
    ptyManager
      .list()
      .flatMap((session) => (session.state === "ended" ? [] : [session.id]));
  eventBus.setHydrationSources({
    getState: () => buildHydrationStateSnapshot({ appStateStore, ptyManager }),
    getAgentStates: () =>
      agentStateStore.getStates({ liveSessionIds: getLiveSessionIds() }),
    getActivityHistory: () => sessionActivityStore.getRecent(100),
    getTerminalPresences: () => terminalPresenceManager.getAll(),
    getMobileSessionSnapshots: () =>
      buildMobileSessionSnapshots({
        state: buildHydrationStateSnapshot({ appStateStore, ptyManager }),
        agentStates: agentStateStore.getStates({
          liveSessionIds: getLiveSessionIds(),
        }),
        terminalPresences: terminalPresenceManager.getAll(),
      }),
    getNotifications: () => eventBus.getNotifications(),
    getPorts: () => {
      const out: Record<string, PortInfo[]> = {};
      for (const [projectId, services] of Object.entries(
        serviceRegistry.getAllServices(),
      )) {
        out[projectId] = projectServicesToPorts(services);
      }
      return out;
    },
    getServices: () => serviceRegistry.getAllServices(),
    getGitStates: () => projectRuntime.getGitStates(),
    getWorktrees: () => worktreeCache.get(),
    getMissingProjectIds: () => projectRuntime.getMissingProjectIds(),
  });

  const osc7Lifecycle = new Osc7Lifecycle();
  const createActivityRecord = (
    sessionId: string,
    params: {
      kind: SessionActivityRecord["kind"];
      source: SessionActivitySource;
      summary: string;
      projectId?: string;
      agentLifecycle?: AgentLifecycle;
      endReason?: SessionEndReason;
      metadata?: Record<string, unknown>;
    },
  ): SessionActivityRecord | null => {
    const record: SessionActivityRecord = {
      id: randomUUID(),
      sessionId,
      timestamp: Date.now(),
      kind: params.kind,
      source: params.source,
      summary: params.summary,
      projectId: params.projectId,
      agentLifecycle: params.agentLifecycle,
      endReason: params.endReason,
      metadata: params.metadata,
    };
    const accepted = sessionActivityStore.append(record);
    return accepted ? record : null;
  };
  const manualAgentTracker = new ManualAgentTracker({
    onDebug: (sessionId, message) => {
      debugRecorder?.record("manual-tracker", { message }, sessionId);
    },
  });
  const originalBroadcast = eventBus.broadcast.bind(eventBus);
  eventBus.broadcast = (message) => {
    let activityRecord: SessionActivityRecord | null = null;
    if (message.type === "session-created") {
      activityRecord = createActivityRecord(message.session.id, {
        kind: "session-created",
        source: "daemon",
        projectId: message.session.projectId,
        summary: "Session created",
      });
    } else if (message.type === "session-restarted") {
      activityRecord = createActivityRecord(message.session.id, {
        kind: "session-restarted",
        source: "daemon",
        projectId: message.session.projectId,
        summary: "Session restarted",
      });
    } else if (message.type === "session-ended") {
      const session = ptyManager.get(message.sessionId);
      terminalPresenceManager.resetSession(message.sessionId);
      activityRecord = createActivityRecord(message.sessionId, {
        kind: "session-ended",
        source: "daemon",
        projectId: session?.projectId,
        endReason: message.endReason,
        summary: "Session ended",
      });
    } else if (message.type === "session-closed") {
      terminalPresenceManager.resetSession(message.sessionId);
      activityRecord = createActivityRecord(message.sessionId, {
        kind: "session-closed",
        source: "daemon",
        projectId: message.projectId,
        summary: "Session closed",
      });
    } else if (message.type === "agent-state") {
      activityRecord = createActivityRecord(message.state.sessionId, {
        kind: "agent-transition",
        source: message.state.source,
        agentLifecycle: message.state.lifecycle,
        projectId: ptyManager.get(message.state.sessionId)?.projectId,
        summary: `Agent: ${message.state.lifecycle}`,
      });
    }

    if (message.type === "session-restarted") {
      terminalPresenceManager.resetSession(message.session.id);
    }

    // Cache mutations must happen BEFORE broadcast so that a client
    // hydrating in the same tick (post-broadcast addClient) reads the
    // updated cache. Snapshot is sync inside `addClient`, so a
    // broadcast-then-snapshot ordering is consistent only when cache is
    // already updated by the broadcast wrapper here.
    if (message.type === "worktree-created") {
      worktreeCache.appendWorktree(message.projectId, message.worktree);
    } else if (message.type === "worktree-removed") {
      worktreeCache.removeWorktree(message.projectId, message.worktreePath);
    } else if (message.type === "project-deleted") {
      worktreeCache.removeProject(message.projectId);
    } else if (message.type === "project-created") {
      // Refresh asynchronously: a freshly imported project may already
      // have linked worktrees on disk that the cache has never seen.
      // Each discovered worktree is re-broadcast so live clients update
      // their store; new clients will hydrate the cache directly.
      const projectId = message.project.id;
      void projectQueries
        .getProjectWorktrees(projectId)
        .then((result) => {
          // Race guard: a project-deleted may have arrived during the
          // git enumeration. Skip the cache update + re-broadcast so
          // orphan worktrees do not resurface server- or client-side.
          const project = projectManager.get(projectId);
          if (!project) return;
          if (result.status === "ok") {
            worktreeCache.setProject(projectId, result.worktrees);
            for (const worktree of result.worktrees) {
              eventBus.broadcast({
                type: "worktree-created",
                projectId,
                worktree,
              });
            }
            return;
          }
          if (result.status === "missing-path") {
            projectPresence?.markMissing(
              projectId,
              project.path,
              "project-created",
            );
          }
        })
        .catch(() => {
          /* git-error / missing-path: leave cache unchanged */
        });
    }
    originalBroadcast(message);
    if (activityRecord) {
      originalBroadcast({
        type: "activity-recorded",
        record: activityRecord,
      });
    }
    if (
      message.type === "panes-updated" ||
      message.type === "session-created" ||
      message.type === "session-restarted" ||
      message.type === "session-ended" ||
      message.type === "session-closed" ||
      message.type === "agent-state"
    ) {
      const snapshots = buildMobileSessionSnapshots({
        state: buildHydrationStateSnapshot({ appStateStore, ptyManager }),
        agentStates: agentStateStore.getStates({
          liveSessionIds: getLiveSessionIds(),
        }),
        terminalPresences: terminalPresenceManager.getAll(),
      });
      if (message.type === "panes-updated") {
        for (const snapshot of snapshots[message.projectId] ?? []) {
          originalBroadcast({
            type: "mobile-session-snapshot",
            projectId: snapshot.projectId,
            worktreePath: snapshot.worktreePath,
            snapshot,
          });
        }
      } else {
        const sessionId =
          message.type === "session-created" ||
          message.type === "session-restarted"
            ? message.session.id
            : message.type === "agent-state"
              ? message.state.sessionId
              : message.sessionId;
        const projectId =
          message.type === "session-closed"
            ? message.projectId
            : ptyManager.get(sessionId)?.projectId;
        if (projectId) {
          for (const snapshot of snapshots[projectId] ?? []) {
            originalBroadcast({
              type: "mobile-session-snapshot",
              projectId: snapshot.projectId,
              worktreePath: snapshot.worktreePath,
              snapshot,
            });
          }
        }
      }
    }
    if (message.type === "session-closed") {
      osc7Lifecycle.removeSession(message.sessionId);
      agentDetector.removeSession(message.sessionId);
      agentStateStore.remove(message.sessionId);
      manualAgentTracker.removeSession(message.sessionId);
      advertisedUrlWatcher.removeSession(message.sessionId);
    }
    projectRuntime.handleBroadcast(message);
  };

  ptyManager.onSessionInput((sessionId, data) => {
    manualAgentTracker.observeInput(sessionId, data);
  });

  ptyManager.onSessionData((sessionId, data, generation) => {
    const detectorSession = ptyManager.get(sessionId);
    /*
     * PTY generation gate: drop stale-gen DATA at the listener boundary.
     * After auto-resume, an old PTY can still emit a residual OSC7 cwd
     * report or agent-output marker. The per-client / scrollback fanout
     * already gates on generation, but every onSessionData listener used
     * to be invoked with stale bytes -- corrupting agent detection state
     * and broadcasting `session-cwd-changed` for the new shell with the
     * old PTY's cwd. Skip every derived state mutation when the chunk's
     * emit-time generation no longer matches the live session.
     */
    if (detectorSession && generation < detectorSession.generation) {
      return;
    }
    const foregroundProcess = ptyManager.getForegroundProcess(sessionId);
    const allowManualFallback =
      shouldAllowManualAgentOutputFallback(detectorSession);
    const observeOutput =
      shouldObserveAgentOutput(detectorSession, foregroundProcess) ||
      (allowManualFallback && manualAgentTracker.shouldObserve(sessionId));
    agentDetector.feed(sessionId, data, {
      observeOutput,
    });
    manualAgentTracker.observeOutput(sessionId, data);
    if (detectorSession) {
      advertisedUrlWatcher.feed(
        sessionId,
        data,
        sessionBindingFor(detectorSession, appStateStore, worktreeCache),
      );
    }

    const newCwd = osc7Lifecycle.feed(sessionId, data);
    if (!newCwd) return;

    const session = ptyManager.get(sessionId);
    if (!session || session.cwd === newCwd) return;

    /*
     * In remote daemon mode the session domain is owned by the daemon
     * (daemon state ownership). The server's `state.sessions` is empty/stale
     * -- sessions live in `RemotePtyHost.mirror` -- so the in-process
     * persistence path doesn't apply. The daemon does not currently run
     * osc7 detection on its side; the cwd-change broadcast is still
     * useful for live UI even without persistence, so emit it
     * unconditionally and skip the mutate when the session domain is
     * read-only.
     */
    if (!appStateStore.isSessionsReadOnly()) {
      appStateStore.mutateSessions((state) => {
        const target = state.sessions.find(
          (candidate) => candidate.id === sessionId,
        );
        if (target) target.cwd = newCwd;
      });
    }
    eventBus.broadcast({
      type: "session-cwd-changed",
      sessionId,
      cwd: newCwd,
    });
  });

  ptyManager.onSessionExit = (sessionId, generation, endReason) => {
    eventBus.broadcast({
      type: "session-ended",
      sessionId,
      generation,
      endReason,
    });
    osc7Lifecycle.removeSession(sessionId);
    agentDetector.removeSession(sessionId);
    agentStateStore.remove(sessionId);
    manualAgentTracker.removeSession(sessionId);
    advertisedUrlWatcher.removeSession(sessionId);
    const session = ptyManager.get(sessionId);
    if (session) {
      projectRuntime.handleSessionEnded(session.projectId);
    }
    // L1 GC for upload staging isolation -- drop the session's upload staging dir
    // immediately on PTY exit. Best-effort: a failure here is logged
    // and the L2/L3 sweep will reap it later.
    uploadStaging.releaseSession(sessionId).catch((err) => {
      console.error(
        `[upload-staging] releaseSession(${sessionId}) failed:`,
        err,
      );
    });
  };

  agentDetector.onStateChange((state) => {
    agentStateStore.set(state);
    debugRecorder?.recordState(state);
    eventBus.broadcast({
      type: "agent-state",
      state,
    });

    if (state.lifecycle !== "waiting" || state.confidence !== "high") return;

    const session = ptyManager.get(state.sessionId);
    const notification = createWaitingNotification(
      state.sessionId,
      session?.projectId ?? "",
    );
    eventBus.addNotification(notification);
    eventBus.broadcast({ type: "notification", notification });
  });

  ipcServer.onCommand("open", (args) => {
    const url = args.url as string;
    if (!url) return { ok: false, error: "url required" };
    eventBus.broadcast({
      type: "browser-url-changed",
      paneId: "__route_open__",
      url,
    });
    return { ok: true };
  });
}

function sessionBindingFor(
  session: {
    projectId: string;
    cwd: string;
  },
  appStateStore: AppStateStore,
  worktreeCache: WorktreeCache,
): {
  projectId: string;
  worktreePath: string;
} {
  const state = appStateStore.get();
  const projectPath =
    state.projects.find((project) => project.id === session.projectId)?.path ??
    "";
  const worktreePaths = [
    projectPath,
    ...(worktreeCache.get()[session.projectId] ?? []).map(
      (worktree) => worktree.path,
    ),
  ].filter((path) => path.trim() !== "");
  const worktreePath = deepestContainingPath(session.cwd, worktreePaths);
  return {
    projectId: session.projectId,
    worktreePath: worktreePath ?? session.cwd,
  };
}

function deepestContainingPath(
  targetPath: string,
  candidatePaths: string[],
): string | undefined {
  const normalizedTarget = normalizePath(targetPath);
  return candidatePaths
    .map((path) => ({ path, normalized: normalizePath(path) }))
    .filter(
      (candidate) =>
        normalizedTarget === candidate.normalized ||
        normalizedTarget.startsWith(`${candidate.normalized}/`),
    )
    .sort((a, b) => b.normalized.length - a.normalized.length)[0]?.path;
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "").replace(/\\/g, "/");
}

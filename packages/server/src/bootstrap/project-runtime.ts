import type { GitState, WsEventMessage } from "@parasor/shared";
import type { ProjectWorktreesResult } from "../application/workspace/project-queries.js";
import { FileWatcher } from "../fs/file-watcher.js";
import { GitWatcher } from "../fs/git-watcher.js";
import { FilesystemService } from "../fs/service.js";
import { WatcherLifecycle } from "../fs/watcher-lifecycle.js";
import { chainWatcherOp } from "../fs/watcher-ops.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { WorktreeCache } from "../state/worktree-cache.js";
import type { EventBus } from "../ws/events.js";
import type { ProjectPresence } from "./project-presence.js";

export interface ProjectRuntime {
  /**
   * Returns the filesystem service for the project's main checkout, or for a
   * specific linked worktree when `worktreePath` is supplied. Worktree paths
   * are validated against {@link WorktreeCache} so callers can route untrusted
   * query input here without separate fence checks. `null` when the project
   * does not exist or the worktree is not registered for that project.
   */
  getFilesystemService(
    projectId: string,
    worktreePath?: string,
  ): FilesystemService | null;
  getGitStates(): Record<string, Record<string, GitState | null>>;
  isMissing(projectId: string): boolean;
  getMissingProjectIds(): string[];
  noteMissingPath(projectId: string, reason: string): void;
  notePresentPath(projectId: string): void;
  isLiveWatched(projectId: string): boolean;
  onClientActiveProject(prev: string | null, next: string | null): void;
  noteLiveSession(projectId: string): void;
  onPathMissing(projectId: string): void;
  onPathRestored(projectId: string): void;
  snapshotInactiveGit(projectId: string): Promise<void>;
  handleBroadcast(message: WsEventMessage): void;
  handleSessionEnded(projectId: string): void;
  pollGitChanges(): Promise<void>;
  refreshGitState(projectId: string, worktreePath: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateProjectRuntimeDeps {
  projectManager: ProjectManager;
  eventBus: EventBus;
  worktreeCache: WorktreeCache;
  presence?: ProjectPresence;
  enumerateWorktrees?: (projectId: string) => Promise<ProjectWorktreesResult>;
}

function watcherKey(projectId: string, worktreePath: string): string {
  return `${projectId}|${worktreePath}`;
}

function warnString(prefix: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`${prefix}: ${message}`);
}

export function createProjectRuntime({
  projectManager,
  eventBus,
  worktreeCache,
  presence,
  enumerateWorktrees,
}: CreateProjectRuntimeDeps): ProjectRuntime {
  const fsServices = new Map<string, FilesystemService>();
  // Per-worktree FS service cache, keyed by `${projectId}|${worktreePath}`.
  // Kept separate from `fsServices` so the project-root service (used by
  // FileWatcher's `.gitignore` reload + isIgnored callback) keeps its
  // simple `projectId`-only key and existing semantics.
  const worktreeFsServices = new Map<string, FilesystemService>();
  const fileWatchers = new Map<string, FileWatcher>();
  const gitWatcher = new GitWatcher();

  // Per-key serialization for watcher start/stop. `worktree-created` and
  // `worktree-removed` can land in either order, even back-to-back for the
  // same path. Without serialization a removal that arrives mid-`start()`
  // would miss the map entry, and a re-creation that arrives mid-`stop()`
  // would spawn a second native subscription before the old one shuts down.
  // Chaining ops by key gives both events a consistent view of the watcher
  // state.
  const watcherOps = new Map<string, Promise<void>>();

  // Debounced per-worktree git-state recompute on regular file changes.
  // FileWatcher only triggers `broadcastGitState` for `.git/HEAD/index/refs`
  // edits, but a plain save (e.g. README.md) also flips dirtyCount and the
  // user expects the counter to update sub-second -- not on the next 10s poll.
  const pendingGitDiff = new Map<string, ReturnType<typeof setTimeout>>();
  const GIT_DIFF_DEBOUNCE_MS = 200;
  function scheduleGitDiff(projectId: string, worktreePath: string): void {
    const key = watcherKey(projectId, worktreePath);
    const existing = pendingGitDiff.get(key);
    if (existing) clearTimeout(existing);
    pendingGitDiff.set(
      key,
      setTimeout(() => {
        pendingGitDiff.delete(key);
        void broadcastGitState(projectId, worktreePath);
      }, GIT_DIFF_DEBOUNCE_MS),
    );
  }

  function getFilesystemService(
    projectId: string,
    worktreePath?: string,
  ): FilesystemService | null {
    const project = projectManager.get(projectId);
    if (!project) return null;

    // No worktree override (or matches project root) -> return the cached
    // project-root service. This is also the watcher-facing path so its
    // `.gitignore` instance is preserved across calls.
    if (!worktreePath || worktreePath === project.path) {
      const cached = fsServices.get(projectId);
      if (cached) return cached;
      const service = new FilesystemService(project.path);
      fsServices.set(projectId, service);
      return service;
    }

    // Untrusted input fence: only resolve to a worktree when it is
    // currently registered for this project. Unknown paths fall back to
    // the project root rather than spawning an arbitrary FS service.
    const worktrees = worktreeCache.get()[projectId] ?? [];
    if (!worktrees.some((w) => w.path === worktreePath)) {
      return getFilesystemService(projectId);
    }

    const key = `${projectId}|${worktreePath}`;
    const cached = worktreeFsServices.get(key);
    if (cached) return cached;
    const service = new FilesystemService(worktreePath);
    worktreeFsServices.set(key, service);
    return service;
  }

  async function broadcastGitState(
    projectId: string,
    worktreePath: string,
  ): Promise<void> {
    const { state, changed } = await gitWatcher.checkAndDiff(
      projectId,
      worktreePath,
    );
    if (changed) {
      eventBus.broadcast({ type: "git-state", projectId, worktreePath, state });
    }
  }

  /**
   * Returns every worktree path that should be watched for `projectId`. The
   * project's main checkout path is always included, even when the worktree
   * cache only lists linked worktrees.
   */
  function projectWorktreePaths(projectId: string): string[] {
    const project = projectManager.get(projectId);
    if (!project) return [];
    const paths = new Set<string>([project.path]);
    for (const wt of worktreeCache.get()[projectId] ?? []) {
      paths.add(wt.path);
    }
    return [...paths];
  }

  function spawnWatcher(
    projectId: string,
    worktreePath: string,
  ): Promise<void> {
    const key = watcherKey(projectId, worktreePath);
    return chainWatcherOp(watcherOps, key, async () => {
      if (fileWatchers.has(key)) return;
      if (presence?.isMissing(projectId)) return;

      try {
        // Filesystem ignore rules live on the project's main worktree (the
        // only one that owns `.gitignore` semantics for parasor's filetree).
        // Linked worktrees share the same FilesystemService instance.
        const fsService = getFilesystemService(projectId);
        const watcher = new FileWatcher(
          worktreePath,
          (batch) => {
            eventBus.broadcast({
              type: "file-changes",
              projectId,
              worktreePath,
              events: batch.events,
              overflow: batch.overflow,
              count: batch.count,
            });
            scheduleGitDiff(projectId, worktreePath);
          },
          () => {
            const service = fsServices.get(projectId);
            service?.reloadIgnore();
            eventBus.broadcast({ type: "gitignore-updated", projectId });
          },
          async () => {
            try {
              await broadcastGitState(projectId, worktreePath);
            } catch (err) {
              warnString(
                `git-state broadcast failed for ${projectId} ${worktreePath}`,
                err,
              );
            }
          },
          (relPath, isDir) => fsService?.isIgnored(relPath, isDir) ?? false,
        );

        await watcher.start();
        fileWatchers.set(key, watcher);
        try {
          await broadcastGitState(projectId, worktreePath);
        } catch (err) {
          warnString(
            `git-state broadcast failed for ${projectId} ${worktreePath}`,
            err,
          );
        }
      } catch (err) {
        warnString(`FileWatcher spawn skipped for ${worktreePath}`, err);
      }
    }).catch((err) => {
      warnString(`FileWatcher spawn skipped for ${worktreePath}`, err);
    });
  }

  function teardownWatcher(
    projectId: string,
    worktreePath: string,
  ): Promise<void> {
    const key = watcherKey(projectId, worktreePath);
    return chainWatcherOp(watcherOps, key, async () => {
      try {
        const watcher = fileWatchers.get(key);
        if (watcher) {
          fileWatchers.delete(key);
          await watcher.stop();
        }
        const pending = pendingGitDiff.get(key);
        if (pending) {
          clearTimeout(pending);
          pendingGitDiff.delete(key);
        }
        worktreeFsServices.delete(key);
        gitWatcher.clearWorktree(projectId, worktreePath);
      } catch (err) {
        warnString(`FileWatcher teardown skipped for ${worktreePath}`, err);
      }
    }).catch((err) => {
      warnString(`FileWatcher teardown skipped for ${worktreePath}`, err);
    });
  }

  async function tearDownWatchers(projectId: string): Promise<void> {
    const prefix = `${projectId}|`;
    for (const [key, timer] of pendingGitDiff) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(timer);
      pendingGitDiff.delete(key);
    }
    const tasks: Promise<void>[] = [];
    for (const [key, watcher] of fileWatchers) {
      if (!key.startsWith(prefix)) continue;
      tasks.push(
        watcher.stop().finally(() => {
          fileWatchers.delete(key);
        }),
      );
    }
    await Promise.all(tasks);
    gitWatcher.clearProject(projectId);
  }

  const watcherLifecycle = new WatcherLifecycle({
    shouldActivate: (projectId) => !presence?.isMissing(projectId),
    onActivate: async (projectId) => {
      try {
        const project = projectManager.get(projectId);
        if (!project) return;
        if (presence?.isMissing(projectId)) return;
        for (const worktreePath of projectWorktreePaths(projectId)) {
          await spawnWatcher(projectId, worktreePath);
        }
      } catch (err) {
        warnString(`watcher activate skipped for ${projectId}`, err);
      }
    },
    onSuspend: async (projectId) => {
      try {
        await tearDownWatchers(projectId);
      } catch (err) {
        warnString(`watcher suspend skipped for ${projectId}`, err);
      }
    },
  });

  function isLiveWatched(projectId: string): boolean {
    return (
      !presence?.isMissing(projectId) && watcherLifecycle.isActive(projectId)
    );
  }

  return {
    getFilesystemService,
    getGitStates: () => gitWatcher.getAllCached(),
    isMissing(projectId) {
      return presence?.isMissing(projectId) ?? false;
    },
    getMissingProjectIds() {
      return presence?.missingIds() ?? [];
    },
    noteMissingPath(projectId, reason) {
      const project = projectManager.get(projectId);
      if (!project) return;
      presence?.markMissing(projectId, project.path, reason);
    },
    notePresentPath(projectId) {
      const project = projectManager.get(projectId);
      if (!project) return;
      presence?.markPresent(projectId, project.path);
    },
    isLiveWatched,
    onClientActiveProject(prev, next) {
      if (prev === next) return;
      if (prev) {
        void watcherLifecycle.onClientFocusLost(prev).catch((err) => {
          warnString(`client focus lost skipped for ${prev}`, err);
        });
      }
      if (next) {
        void watcherLifecycle.onClientFocused(next).catch((err) => {
          warnString(`client focus skipped for ${next}`, err);
        });
      }
    },
    noteLiveSession(projectId) {
      void watcherLifecycle.onSessionCreated(projectId).catch((err) => {
        warnString(`live session watch skipped for ${projectId}`, err);
      });
    },
    onPathMissing(projectId) {
      void watcherLifecycle.forceSuspend(projectId).catch((err) => {
        warnString(`force suspend skipped for ${projectId}`, err);
      });
    },
    onPathRestored(projectId) {
      void (async () => {
        try {
          if (enumerateWorktrees) {
            const result = await enumerateWorktrees(projectId);
            if (result.status === "ok") {
              for (const worktree of result.worktrees) {
                eventBus.broadcast({
                  type: "worktree-created",
                  projectId,
                  worktree,
                });
              }
            }
          }
          if (watcherLifecycle.hasInterest(projectId)) {
            await watcherLifecycle.ensureActive(projectId);
          }
        } catch (err) {
          warnString(`path restore skipped for ${projectId}`, err);
        }
      })();
    },
    async snapshotInactiveGit(projectId) {
      if (isLiveWatched(projectId)) return;
      if (presence?.isMissing(projectId)) return;
      for (const worktreePath of projectWorktreePaths(projectId)) {
        await broadcastGitState(projectId, worktreePath);
      }
    },
    handleBroadcast(message) {
      if (message.type === "project-created") {
        return;
      }

      if (message.type === "worktree-created") {
        if (watcherLifecycle.isActive(message.projectId)) {
          void spawnWatcher(message.projectId, message.worktree.path);
        }
        return;
      }

      if (message.type === "worktree-removed") {
        // Stop the watcher and drop the per-worktree FS service so deleted
        // worktrees do not leak parcel-watcher native handles or cached
        // FilesystemService instances across the daemon's lifetime. The
        // teardown is serialized with any in-flight spawn so a removal
        // landing mid-`watcher.start()` still cleans up after start returns.
        void teardownWatcher(message.projectId, message.worktreePath);
        return;
      }

      if (
        message.type === "session-created" ||
        message.type === "session-restarted"
      ) {
        void watcherLifecycle.onSessionCreated(message.session.projectId);
        return;
      }

      if (message.type === "session-closed") {
        void watcherLifecycle.onSessionEnded(message.projectId);
        return;
      }

      if (message.type === "project-deleted") {
        void watcherLifecycle.onProjectDeleted(message.projectId);
        fsServices.delete(message.projectId);
        presence?.delete(message.projectId);
        const prefix = `${message.projectId}|`;
        for (const key of worktreeFsServices.keys()) {
          if (key.startsWith(prefix)) worktreeFsServices.delete(key);
        }
      }
    },
    handleSessionEnded(projectId) {
      void watcherLifecycle.onSessionEnded(projectId);
    },
    async pollGitChanges() {
      for (const project of projectManager.list()) {
        if (!isLiveWatched(project.id)) continue;
        for (const worktreePath of projectWorktreePaths(project.id)) {
          await broadcastGitState(project.id, worktreePath);
        }
      }
    },
    async refreshGitState(projectId, worktreePath) {
      await broadcastGitState(projectId, worktreePath);
    },
    async dispose() {
      watcherLifecycle.dispose();
      for (const timer of pendingGitDiff.values()) clearTimeout(timer);
      pendingGitDiff.clear();
      const tasks: Promise<void>[] = [];
      for (const watcher of fileWatchers.values()) {
        tasks.push(watcher.stop());
      }
      await Promise.all(tasks);
      fileWatchers.clear();
      fsServices.clear();
      worktreeFsServices.clear();
    },
  };
}

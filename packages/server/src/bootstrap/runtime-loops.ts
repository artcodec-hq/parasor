import { randomUUID } from "node:crypto";
import type { Notification, PortInfo, ServiceConfig } from "@parasor/shared";
import type { UploadStaging } from "../fs/upload-staging.js";
import { resolveForwarderBindHost } from "../net/reachable-host.js";
import { PortForwarder } from "../port-forwarder/forwarder.js";
import type { PortScanner } from "../port-scanner/scanner.js";
import type { PtyHost } from "../pty/host.js";
import type { AppStateStore } from "../state/app-state.js";
import type { EventBus } from "../ws/events.js";
import type { ProjectRuntime } from "./project-runtime.js";

const DEFAULT_TITLE_POLL_INTERVAL_MS = 1000;
/**
 * git-state poll cadence. Runs across every worktree of every active
 * project so it scales linearly with worktree count. FileWatcher events
 * remain the primary diff signal -- this loop is the safety net for cases
 * the watcher misses (network filesystems, timer-coalesced events).
 */
const DEFAULT_GIT_POLL_INTERVAL_MS = 10_000;
/**
 * L3 upload-staging sweep cadence (upload staging isolation). 60 minutes is enough to
 * keep the cleanup obligation off the critical path while still bounding
 * worst-case dir age to ttl + 1h on a long-running server.
 */
const DEFAULT_UPLOAD_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface StartRuntimeLoopsDeps {
  appStateStore: AppStateStore;
  eventBus: EventBus;
  portScanner: PortScanner;
  ptyManager: PtyHost;
  projectRuntime: ProjectRuntime;
  uploadStaging: UploadStaging;
  reconcileWorktrees?: (
    projectId: string,
    prefetched?: import("@parasor/shared").Worktree[],
  ) => Promise<void>;
  /**
   * The address parasor's own HTTP server is bound to (`hostname` from
   * `selectBindAddress` in `index.ts`). Used to derive the per-port TCP
   * forwarder's bind address via `resolveForwarderBindHost` -- loopback ⇒
   * no forwarder. Defaults to `0.0.0.0` for callers that don't pass it.
   * Ignored when `portForwarder` is supplied.
   */
  bindHost?: string;
  /** Injectable for tests; defaults to one built from `bindHost`. */
  portForwarder?: PortForwarder;
  titlePollIntervalMs?: number;
  gitPollIntervalMs?: number;
  uploadSweepIntervalMs?: number;
}

export function createPortDetectedNotification(
  projectId: string,
  projectName: string,
  port: PortInfo,
  now = Date.now(),
): Notification {
  return {
    id: randomUUID(),
    projectId,
    type: "port-detected",
    title: "Port detected",
    message: `Port ${port.port} is listening in ${projectName}`,
    timestamp: now,
    read: false,
    port: port.port,
    bindsAll: port.bindsAll,
    reachable: port.reachable ?? port.bindsAll,
    ...(port.reachablePort !== undefined
      ? { reachablePort: port.reachablePort }
      : {}),
  };
}

/**
 * Annotate each port with `reachable` (does the viewer device need nothing
 * extra: dev server binds all interfaces, parasor is loopback-bound, or a TCP
 * forwarder is up) and `reachablePort` (the forwarder's OS-assigned listen
 * port when one fronts this dev port).
 */
export function enrichPorts(
  ports: PortInfo[],
  projectId: string,
  forwarder: PortForwarder,
): PortInfo[] {
  return ports.map((info) => {
    const reachablePort = forwarder.getReachablePort(projectId, info.port);
    const reachable =
      info.bindsAll || forwarder.isInert() || reachablePort !== null;
    return {
      ...info,
      reachable,
      ...(reachablePort !== null ? { reachablePort } : {}),
    };
  });
}

export function broadcastForegroundTitles(
  ptyManager: PtyHost,
  eventBus: EventBus,
): void {
  for (const session of ptyManager.list()) {
    if (session.state !== "running") continue;
    if (session.titleManual === true) continue;
    const name = ptyManager.getForegroundProcess(session.id);
    if (!name || name === session.title) continue;
    if (!ptyManager.setTitle(session.id, name)) continue;
    eventBus.broadcast({
      type: "session-title-changed",
      sessionId: session.id,
      title: name,
      titleManual: false,
    });
  }
}

export function startRuntimeLoops({
  appStateStore,
  eventBus,
  portScanner,
  ptyManager,
  projectRuntime,
  uploadStaging,
  reconcileWorktrees,
  bindHost = "0.0.0.0",
  portForwarder,
  titlePollIntervalMs = DEFAULT_TITLE_POLL_INTERVAL_MS,
  gitPollIntervalMs = DEFAULT_GIT_POLL_INTERVAL_MS,
  uploadSweepIntervalMs = DEFAULT_UPLOAD_SWEEP_INTERVAL_MS,
}: StartRuntimeLoopsDeps) {
  // Tracks the last-seen `reachable` value for each port per project so we can
  // re-notify when a port becomes reachable from the viewer device -- either it
  // flips from loopback-only to public, or the TCP forwarder finishes binding
  // (the forwarder's `listen` is async, so a freshly-detected loopback port is
  // not yet reachable on the tick it first appears) -- without spamming on
  // every tick.
  const knownPorts = new Map<string, Map<number, boolean>>();
  // Last raw `PortInfo[]` per project (no `reachable`/`reachablePort`) so we
  // can re-derive the enriched view when the forwarder changes out-of-band
  // (async bind completes/errors) or the `portDetection` setting flips.
  const lastPorts = new Map<string, PortInfo[]>();
  const forwarder =
    portForwarder ?? new PortForwarder(resolveForwarderBindHost(bindHost));

  // Derive the enriched ports for `projectId` from `ports`, broadcast
  // `ports-updated`, update the seen-reachability bookkeeping, and emit a
  // `port-detected` notification for any port that just became reachable.
  function reemitPorts(projectId: string, ports: PortInfo[]): void {
    const mode = appStateStore.get().serviceConfig.portDetection;
    const enriched = enrichPorts(ports, projectId, forwarder);
    eventBus.broadcast({ type: "ports-updated", projectId, ports: enriched });

    const previous = knownPorts.get(projectId) ?? new Map<number, boolean>();
    const next = new Map(enriched.map((p) => [p.port, p.reachable === true]));
    if (next.size === 0) knownPorts.delete(projectId);
    else knownPorts.set(projectId, next);

    if (mode === "off") return;
    const project = appStateStore
      .get()
      .projects.find((p) => p.id === projectId);
    if (!project) return;

    for (const info of enriched) {
      // mode === "all-interfaces" is the only notify-mode left (see local notify-mode cleanup).
      // Notify only for ports the viewer can actually open.
      if (!info.reachable) continue;
      const wasReachable = previous.get(info.port) === true;
      if (wasReachable) continue;
      const notification = createPortDetectedNotification(
        projectId,
        project.name,
        info,
      );
      eventBus.addNotification(notification);
      eventBus.broadcast({ type: "notification", notification });
    }
  }

  // The forwarder's listen is async -- re-emit when it finishes binding (or its
  // bind errored) so the now-reachable port reaches clients (and fires the
  // toast). Registered unconditionally so it works for an injected test
  // forwarder too.
  forwarder.setOnChange((projectId) => {
    const ports = lastPorts.get(projectId);
    if (ports) reemitPorts(projectId, ports);
  });

  portScanner.onPortsChanged((projectId, ports) => {
    const mode = appStateStore.get().serviceConfig.portDetection;
    // `portDetection === "off"` ⇒ no forwarder ever started (the user opted
    // out of port detection entirely). The next non-"off" tick will sync.
    forwarder.sync(projectId, mode === "off" ? [] : ports);

    if (ports.length === 0) lastPorts.delete(projectId);
    else lastPorts.set(projectId, ports);

    reemitPorts(projectId, ports);
  });
  portScanner.start(() => ptyManager.list());

  const titlePollTimer = setInterval(() => {
    broadcastForegroundTitles(ptyManager, eventBus);
  }, titlePollIntervalMs);

  const gitPollTimer = setInterval(() => {
    void projectRuntime.pollGitChanges();
    if (reconcileWorktrees) {
      for (const project of appStateStore.get().projects) {
        void reconcileWorktrees(project.id);
      }
    }
  }, gitPollIntervalMs);

  const uploadSweepTimer = setInterval(() => {
    uploadStaging.sweepStale().then(
      ({ swept }) => {
        if (swept.length > 0) {
          console.log(
            `[upload-staging] L3 periodic sweep: removed ${swept.length} stale entries`,
          );
        }
      },
      (err) => {
        console.error("[upload-staging] L3 periodic sweep failed:", err);
      },
    );
  }, uploadSweepIntervalMs);
  // Same idiom as startupCheckTimer in other loops -- `unref()` so a
  // pending tick never holds the event loop open during graceful exit.
  uploadSweepTimer.unref();

  let lastPortDetection: ServiceConfig["portDetection"] =
    appStateStore.get().serviceConfig.portDetection;

  return {
    stop() {
      clearInterval(titlePollTimer);
      clearInterval(gitPollTimer);
      clearInterval(uploadSweepTimer);
      portScanner.stop();
      forwarder.stop();
    },
    /**
     * React to a `serviceConfig` change. On a `portDetection` transition,
     * re-sync the forwarder for every known project (`off` ⇒ tear all
     * forwarders down; back to `all-interfaces` ⇒ recreate them for the
     * currently-known ports) and re-emit so clients see the updated
     * `reachable`/`reachablePort`. Other fields are no-ops here.
     */
    onServiceConfigChanged(config: ServiceConfig) {
      if (config.portDetection === lastPortDetection) return;
      lastPortDetection = config.portDetection;
      for (const projectId of new Set(lastPorts.keys())) {
        const ports = lastPorts.get(projectId) ?? [];
        forwarder.sync(projectId, config.portDetection === "off" ? [] : ports);
        reemitPorts(projectId, ports);
      }
    },
  };
}

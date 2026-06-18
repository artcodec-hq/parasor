import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { AgentStateStore } from "./agent-detector/agent-state-store.js";
import {
  AgentDetector,
  type DetectorTraceEvent,
} from "./agent-detector/detector.js";
import { createProjectQueries } from "./application/workspace/project-queries.js";
import { createWorktreeReconciler } from "./application/workspace/worktree-reconcile.js";
import {
  buildAllowedOrigins,
  normalizeOrigin,
  parseAllowedOriginsEnv,
} from "./auth/origin.js";
import { PairingTokenStore } from "./auth/pairing-token.js";
import { TokenAuth } from "./auth/token.js";
import { createAppServer } from "./bootstrap/create-app-server.js";
import { createProjectRuntime } from "./bootstrap/project-runtime.js";
import { buildStaticPtyEnv } from "./bootstrap/pty-env.js";
import { reconcileStartupState } from "./bootstrap/reconcile-state.js";
import { startRuntimeLoops } from "./bootstrap/runtime-loops.js";
import {
  probePort,
  removeRuntimeFile,
  writeRuntimeFile,
} from "./bootstrap/runtime-port.js";
import {
  enforceSafetyGate,
  selectBindAddress,
} from "./bootstrap/safety-gate.js";
import { readAndClearShutdownMarker } from "./bootstrap/shutdown-marker.js";
import {
  createShutdownHandler,
  registerShutdownSignals,
} from "./bootstrap/shutdown-runtime.js";
import { printStartupBanner } from "./bootstrap/startup-banner.js";
import { wireRuntime } from "./bootstrap/wire-runtime.js";
import { installShims } from "./cli/shim-installer.js";
import { AgentStatusRecorder } from "./debug/agent-status-recorder.js";
import { TerminalTraceRecorder } from "./debug/terminal-trace-recorder.js";
import { removeLegacyDropsDir, UploadStaging } from "./fs/upload-staging.js";
import { IpcServer } from "./ipc/socket-server.js";
import { notifyReady, notifyWatchdog } from "./lib/sd-notify.js";
import { resolveForwarderBindHost } from "./net/reachable-host.js";
import {
  checkTailscale,
  classifyInterfaces,
  withMagicDNS,
} from "./network/endpoints.js";
import { buildPairingUrl } from "./network/qr.js";
import { PortForwarder } from "./port-forwarder/forwarder.js";
import { PortScanner } from "./port-scanner/scanner.js";
import { createPtyHost, type PtyHost, resolvePtyHostMode } from "./pty/host.js";
import {
  type AppStateOwner,
  AppStateOwnerConflictError,
  acquireAppStateOwnership,
  markerFileFor,
} from "./pty/host-daemon/mode-marker.js";
import { ScrollbackLog } from "./pty/scrollback-log.js";
import { CaffeinateController } from "./service/caffeinate.js";
import { AppStateStore } from "./state/app-state.js";
import { ProjectManager } from "./state/project-manager.js";
import { ServerNoticesStore } from "./state/server-notices.js";
import { WorktreeCache } from "./state/worktree-cache.js";
import { EventBus } from "./ws/events.js";
import { SessionActivityStore } from "./session-activity-store.js";

function summarizeDetectorTrace(
  event: DetectorTraceEvent,
): Record<string, unknown> {
  switch (event.kind) {
    case "feed-skip-source":
      return {
        reason: event.kind,
        current: event.current,
        currentLifecycle: event.currentLifecycle,
      };
    case "feed-control-only":
      return { reason: event.kind };
    case "applied-skip-source":
      return {
        reason: event.kind,
        incoming: event.incoming,
        incomingLifecycle: event.incomingLifecycle,
        current: event.current,
        currentLifecycle: event.currentLifecycle,
      };
    case "feed-observed":
      // feed-observed is handled by the detector-feed branch in the
      // onTrace callback and never reaches this serializer; the case is
      // listed so TS exhaustiveness flags a future kind that isn't routed.
      return { reason: event.kind };
  }
}

// Web assets -- resolved relative to this file so both the monorepo layout
// (packages/server/dist/index.js + packages/web/dist) and the packaged layout
// (dist/server/index.js + dist/web) work without env configuration.
function resolveWebDistPath(): string {
  const envOverride = process.env.PARASOR_WEB_DIST;
  if (envOverride) return envOverride;
  const candidates: [string, string] = [
    new URL("../../web/dist", import.meta.url).pathname, // monorepo
    new URL("../web", import.meta.url).pathname, // packaged
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

// Config dir

const rawConfigDir =
  process.env.PARASOR_CONFIG_DIR ?? join(homedir(), ".config", "parasor");
const configDir = resolve(rawConfigDir);
if (!isAbsolute(configDir))
  throw new Error("PARASOR_CONFIG_DIR must be an absolute path");
mkdirSync(configDir, { recursive: true });

// Auth
const authMode = (process.env.PARASOR_AUTH ?? "token") as
  | "token"
  | "allowlist"
  | "none";
const ephemeral = process.env.PARASOR_EPHEMERAL_TOKEN === "1";
const tokenAuth = new TokenAuth({ dir: configDir, ephemeral });
const pairingTokens = new PairingTokenStore();

// Bind address: explicit (CLI/env) > default 0.0.0.0 (all interfaces).
// `bin/parasor.ts` translates `--host` into env HOST before we get here.
const explicitHost = process.env.HOST;
const hostname = selectBindAddress({ explicit: explicitHost });
const explicitBind = !!(explicitHost && explicitHost.length > 0);

enforceSafetyGate({
  authMode,
  bindHost: hostname,
  allowUnsafe: process.env.PARASOR_ALLOW_UNSAFE === "1",
});

// IPC
const ipcServer = new IpcServer({ dir: configDir });

// Port Scanner + per-port TCP forwarder (Tier A .). One
// shared instance: `startRuntimeLoops` drives it from port-scan ticks and the
// `portDetection` setting; `wireRuntime` reads it to enrich the hydration
// snapshot's ports. Loopback-bound parasor ⇒ inert (no forwarders).
const portScanner = new PortScanner();
const portForwarder = new PortForwarder(resolveForwarderBindHost(hostname));

// Shims
const shims = installShims(configDir);

/*
 * Image / file drops attached from the chat composer are persisted under
 * `<rootDir>/uploads/<sessionId>/`, NOT inside any project tree
 * (upload staging isolation). Each PTY only sees its own per-session subdir
 * via the env var `PARASOR_UPLOAD_DIR` injected by
 * `InProcessPtyHost.buildSessionEnv` -- never the shared root -- so an agent
 * runner's `--add-dir` cannot widen one PTY's cwd allowlist to a sibling
 * session's drops.
 *
 * Boot performs an L2 sweep of stale entries (>24h old) to clean up
 * after a SIGKILL'd predecessor that never got to run L1. Awaited so
 * stale entries are gone before any PTY is spawned.
 */
const uploadStaging = new UploadStaging({
  rootDir: process.env.PARASOR_UPLOAD_ROOT_DIR,
});
try {
  const { swept } = await uploadStaging.sweepStale();
  if (swept.length > 0) {
    console.log(
      `[upload-staging] L2 boot sweep: removed ${swept.length} stale entries`,
    );
  }
} catch (err) {
  console.error("[upload-staging] L2 boot sweep failed:", err);
}

/*
 * -- cross-mode mutual exclusion. The marker check
 * runs BEFORE `new AppStateStore` so the store's `load()` (which renames
 * a corrupted state.json out of the way) cannot fire while a live daemon
 * still owns the same `state.json`.  *
 * The marker file lives next to `state.json` (i.e. inside `configDir`)
 * so any process that opens the same AppState -- regardless of
 * `XDG_RUNTIME_DIR` or `PARASOR_PTY_SOCK` overrides -- collides on the
 * same marker. In remote mode the daemon owns the marker, so the server
 * skips the write entirely; the `RemotePtyHost.connect()` socket probe
 * is the interlock for that direction.
 */
const ptyHostMode = resolvePtyHostMode();
let appStateOwner: AppStateOwner | null = null;
if (ptyHostMode === "in-process") {
  const modeMarkerFile = markerFileFor(configDir);
  try {
    appStateOwner = await acquireAppStateOwnership(
      modeMarkerFile,
      "in-process",
    );
  } catch (err) {
    if (err instanceof AppStateOwnerConflictError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

// State

const appStateStore = new AppStateStore({ dir: configDir });
const sessionActivityStore = new SessionActivityStore({ dir: configDir });

if (appStateOwner) {
  /*
   * `reconcileStartupState` mutates the store; running it inside the
   * owner-lock gate means a daemon that races for the marker after us
   * cannot observe a half-reconciled state.json. We *also* defer past
   * the in-process branch so remote mode never reconciles --
   * `createPtyHost("remote")` flips the store to read-only and the
   * daemon owns reconciliation in that path (reviewed for correctness).
   */
  await reconcileStartupState(appStateStore);
}

// Services

const scrollbackLog = new ScrollbackLog(configDir);
// Pick the PTY host implementation from PARASOR_PTY_DAEMON.
/*
 * In remote mode `createPtyHost()` pivots the AppStateStore session
 * domain into read-only mirror BEFORE returning (daemon state ownership: project /
 * projectStates / serviceConfig stay writable). Any subsequent server-
 * side `mutateSessions()` call (notably `reconcileStartupState`) would
 * throw. That's intentional -- the daemon is the writer for sessions
 * and runs its own orphan reconciliation at boot. The in-process
 * branch above already ran `reconcileStartupState` while the store
 * session domain was still writable.
 */
/*
 * -- even in-process mode persists SessionRecord
 * so `parasor pty-host doctor` returns a meaningful list regardless of
 * whether the user has opted into the daemon. The (pid, startedAt)
 * tuple identifies *this* server generation; orphan-cleanup at next
 * boot uses it to detect inherited PTYs from a crashed predecessor.
 */
const ptyHostDaemonContext = {
  pid: process.pid,
  startedAt: new Date().toISOString(),
};
const serverNoticesStore = new ServerNoticesStore();
let ptyManager: PtyHost;
try {
  ptyManager = await createPtyHost({
    store: appStateStore,
    scrollbackLog,
    daemonContext: ptyHostDaemonContext,
    uploadsDir: uploadStaging.uploadsDir,
    onDaemonAutoRestarted: (detail) => {
      serverNoticesStore.recordDaemonAutoRestarted(detail);
    },
  });
} catch (err) {
  /*
   * daemon protocol mismatch recovery -- keep the failure surface a single user-readable line instead
   * of a node stack trace at module top-level. createPtyHost already
   * translates known cases (handshake-timeout, version-mismatch
   * recovery failures) into actionable Errors; everything else falls
   * through here.
   */
  process.stderr.write(
    `parasor: failed to start pty host -- ${(err as Error).message}\n`,
  );
  process.exit(1);
}

ptyManager.setPtyEnv(buildStaticPtyEnv(shims, configDir));
// PARASOR_UPLOAD_DIR is intentionally NOT here -- InProcessPtyHost
// injects it per-session in `buildSessionEnv` so each PTY only sees its
// own subdir (upload staging isolation reviewed for correctness 1).

const eventBus = new EventBus();
// Persistent JSONL debug logging is opt-in because hook/debug payloads and
// detector samples can contain snippets of terminal output. Set
// PARASOR_AGENT_STATUS_LOG=default to write under configDir, or set it to an
// absolute/relative path. Empty or unset keeps logs memory-only.
const debugLogPath: string | undefined = (() => {
  const override = process.env.PARASOR_AGENT_STATUS_LOG;
  if (!override) return undefined;
  if (override === "default")
    return join(configDir, "debug", "agent-status.jsonl");
  return isAbsolute(override) ? override : resolve(override);
})();
const debugRecorder = new AgentStatusRecorder({ logPath: debugLogPath });
const terminalTraceRecorder = new TerminalTraceRecorder({
  enabled: process.env.PARASOR_TERMINAL_TRACE === "1",
});
const agentDetector = new AgentDetector({
  onTrace: (event) => {
    // Route detector silent-return paths through the same recorder used by
    // /hook/notify so /api/debug/agent-status is the single audit surface.
    if (event.kind === "feed-observed") {
      debugRecorder.record(
        "detector-feed",
        {
          lifecycle: event.lifecycle,
          sampleTail: event.sampleTail,
        },
        event.sessionId,
      );
      return;
    }
    debugRecorder.record(
      "detector-skip",
      summarizeDetectorTrace(event),
      event.sessionId,
    );
  },
});
const agentStateStore = new AgentStateStore({ dir: configDir });
const projectManager = new ProjectManager(appStateStore);

const caffeinate = new CaffeinateController();
caffeinate.setEnabled(appStateStore.get().serviceConfig.preventIdleSleep);
caffeinate.setClientCount(eventBus.getClientCount());
eventBus.onClientCountChanged((count) => caffeinate.setClientCount(count));

// Detect whether the previous exit was graceful (marker present) or a
// crash (marker absent). Sessions restored without a prior endReason are
// labeled accordingly so the UI can decide whether a silent re-spawn is
// safe or the pane should surface an error instead.
const wasGracefulShutdown = readAndClearShutdownMarker(configDir);

// Load persisted sessions into the in-process PTY host
for (const session of appStateStore.get().sessions) {
  ptyManager.loadPersistedSession(session, wasGracefulShutdown);
}

const liveAgentSessionIds = () =>
  ptyManager
    .list()
    .flatMap((session) => (session.state === "ended" ? [] : [session.id]));
agentDetector.restoreStates(
  agentStateStore.getStates({ liveSessionIds: liveAgentSessionIds() }),
);
agentStateStore.replace(agentDetector.getStates());

// Prime the worktree cache before wiring so the first WS client sees a
// fully populated `getWorktrees()` snapshot. Keeping this sync downstream
// avoids the broadcast/snapshot race that an async `getWorktrees` would
// reintroduce inside `EventBus.addClient`. The project runtime needs the
// cache to enumerate per-worktree FileWatchers on activation, so it is
// created after priming.
const worktreeCache = new WorktreeCache();
worktreeCache.setAll(
  await createProjectQueries({
    projectManager,
    getWorktreeMetadata: (projectId) =>
      appStateStore.get().projectStates[projectId]?.worktreeMetadata ?? {},
  }).listAllWorktrees(),
);
const projectRuntime = createProjectRuntime({
  projectManager,
  eventBus,
  worktreeCache,
});

wireRuntime({
  appStateStore,
  eventBus,
  sessionActivityStore,
  portScanner,
  portForwarder,
  ptyManager,
  agentDetector,
  agentStateStore,
  debugRecorder,
  ipcServer,
  projectManager,
  projectRuntime,
  worktreeCache,
  uploadStaging,
});
const projectQueriesForReconcile = createProjectQueries({
  projectManager,
  getWorktreeMetadata: (projectId) =>
    appStateStore.get().projectStates[projectId]?.worktreeMetadata ?? {},
});
const worktreeReconciler = createWorktreeReconciler({
  projectManager,
  worktreeCache,
  eventBus,
  liveList: async (projectId) => {
    if (!projectManager.get(projectId)) return null;
    try {
      return await projectQueriesForReconcile.getProjectWorktrees(projectId);
    } catch {
      return null;
    }
  },
});

const runtimeLoops = startRuntimeLoops({
  appStateStore,
  eventBus,
  portScanner,
  ptyManager,
  projectRuntime,
  uploadStaging,
  portForwarder,
  reconcileWorktrees: (projectId, prefetched) =>
    worktreeReconciler.reconcile(projectId, prefetched),
});
projectRuntime.activatePersistedProjects(
  appStateStore.get().projects.map((project) => project.id),
);

/*
 * Upload staging isolation -- retire the in-tree drop layout. For every project we know
 * about, best-effort delete the legacy `<projectRoot>/.parasor/drops/`
 * tree (and the now-empty `.parasor/` namespace). Errors are swallowed
 * (logged) because the dir is already `.gitignore`d and a failed
 * delete is non-fatal.
 */
for (const project of appStateStore.get().projects) {
  removeLegacyDropsDir(project.path).then(
    ({ removed }) => {
      if (removed) {
        console.log(
          `[upload-staging] removed legacy .parasor/ from ${project.path}`,
        );
      }
    },
    (err) => {
      console.warn(
        `[upload-staging] removeLegacyDropsDir failed for ${project.path}:`,
        err,
      );
    },
  );
}

const webDistPath = resolveWebDistPath();

function parseNonNegativeInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

const wsPingIntervalMs = parseNonNegativeInt(
  process.env.PARASOR_WS_PING_INTERVAL_MS,
  20_000,
);
const wsPongTimeoutMs = parseNonNegativeInt(
  process.env.PARASOR_WS_PONG_TIMEOUT_MS,
  10_000,
);

// Server start

const requestedPort = Number(process.env.PORT ?? 7681);

await ipcServer.start();

const port = await probePort(requestedPort, 10, hostname);
if (port !== requestedPort) {
  console.log(`\nPort ${requestedPort} is in use, falling back to ${port}.`);
}

// Now that we know the actual port, expose it to PTY children so the
// `parasor notify` and `parasor hook` CLIs (called from agent hook
// scripts) can talk back to /hook/notify over loopback HTTP.
ptyManager.setPtyEnv({ PARASOR_PORT: String(port) });

const allowedOrigins = buildAllowedOrigins({
  bindHost: hostname,
  port,
  extra: parseAllowedOriginsEnv(process.env.PARASOR_ALLOWED_ORIGINS),
});

const { app, injectWebSocket } = createAppServer({
  authMode,
  tokenAuth,
  pairingTokens,
  ptyManager,
  agentDetector,
  getAgentStates: () =>
    agentStateStore.getStates({ liveSessionIds: liveAgentSessionIds() }),
  debugRecorder,
  terminalTraceRecorder,
  eventBus,
  projectManager,
  appStateStore,
  serverNoticesStore,
  worktreeCache,
  projectRuntime,
  portScanner,
  portForwarder,
  serverVersion: process.env.npm_package_version,
  uploadStaging,
  reconcileWorktrees: (projectId, prefetched) =>
    worktreeReconciler.reconcile(projectId, prefetched),
  getFilesystemService: (id, worktreePath) =>
    projectRuntime.getFilesystemService(id, worktreePath),
  webDistPath,
  allowedOrigins,
  wsKeepalive: {
    pingIntervalMs: wsPingIntervalMs,
    pongTimeoutMs: wsPongTimeoutMs,
  },
  onServiceConfigChanged: (config) => {
    caffeinate.setEnabled(config.preventIdleSleep);
    runtimeLoops.onServiceConfigChanged(config);
  },
});

/*
 * Runtime file: the single source of truth for "how do local tooling/processes
 * reach this backend?". Written synchronously after listen() confirms and
 * removed on graceful shutdown. The Vite dev proxy and (eventually) Electron
 * main process read this file to route requests to the right port regardless
 * of what auto-bump chose.
 *
 * Remote / Tailscale clients do NOT consume this file -- they pick a URL from
 * the startup banner's classifyInterfaces() output. runtime.json is loopback-
 * only by design (consumers always construct http://127.0.0.1:${port}).
 */
const runtimeFile = join(configDir, "runtime.json");

const qrEnabled = process.env.PARASOR_QR !== "0";
const qrIface = process.env.PARASOR_QR_IFACE || undefined;

ipcServer.onCommand("qr", async (args) => {
  const ifaceArg =
    typeof args.iface === "string" && args.iface.length > 0
      ? args.iface
      : undefined;
  const tailscaleStatus = await checkTailscale();
  return {
    ok: true,
    port,
    token: authMode === "token" ? pairingTokens.issue().token : tokenAuth.token,
    tokenKind: authMode === "token" ? "pairing" : "auth",
    authMode,
    endpoints: withMagicDNS(classifyInterfaces(), tailscaleStatus.magicDNS),
    tailscaleStatus,
    iface: ifaceArg,
  };
});

const server = serve({ fetch: app.fetch, port, hostname }, async (info) => {
  writeRuntimeFile(runtimeFile, hostname, info.port);
  const tailscaleStatus = await checkTailscale();
  if (tailscaleStatus.magicDNS) {
    // Tailscale MagicDNS hostname is a legitimate Origin for mobile clients
    // that bookmark or manually open the friendly URL. Inject it into the
    // allowlist post-listen so operators don't need PARASOR_ALLOWED_ORIGINS.
    for (const scheme of ["http", "https"] as const) {
      const origin = normalizeOrigin(
        `${scheme}://${tailscaleStatus.magicDNS}:${info.port}`,
      );
      if (origin) allowedOrigins.add(origin);
    }
  }
  printStartupBanner({
    authMode,
    configDir,
    endpoints: withMagicDNS(classifyInterfaces(), tailscaleStatus.magicDNS),
    port: info.port,
    tailscaleStatus,
    makeAccessUrl:
      authMode === "token"
        ? (endpoint) =>
            buildPairingUrl(
              endpoint.address,
              info.port,
              pairingTokens.issue().token,
            )
        : undefined,
    token: authMode === "token" ? undefined : tokenAuth.token,
    qr: { enabled: qrEnabled, iface: qrIface },
    bind: { explicit: explicitBind, host: hostname },
  });
  /*
   * Tell systemd the server is up. WatchdogSec=30 in the unit file means
   * we must ping every 30s or systemd assumes we hung. 10s gives us 3x
   * margin per systemd's own recommendation.
   */
  notifyReady();
});

/*
 * Hold a reference so the timer isn't GC'd; we clear it on shutdown below.
 */
const watchdogTimer: NodeJS.Timeout = setInterval(() => {
  notifyWatchdog();
}, 10_000);
watchdogTimer.unref();

injectWebSocket(server);

// Graceful shutdown

const shutdown = createShutdownHandler({
  appStateStore,
  caffeinate,
  configDir,
  ipcServer,
  projectRuntime,
  ptyManager,
  removeRuntime: removeRuntimeFile,
  runtimeFile,
  runtimeLoops,
  releaseModeMarker: appStateOwner
    ? async () => {
        await appStateOwner.release();
      }
    : undefined,
});

registerShutdownSignals(shutdown);

// `parasor restart` sends this. Flush the response before tearing the socket
// down so the CLI client sees `{ok:true}` rather than an ECONNRESET.
ipcServer.onCommand("shutdown", () => {
  setImmediate(() => {
    void shutdown();
  });
  return { ok: true };
});

// Exports

export {
  app,
  appStateStore,
  eventBus,
  ipcServer,
  portScanner,
  projectManager,
  ptyManager,
  tokenAuth,
};

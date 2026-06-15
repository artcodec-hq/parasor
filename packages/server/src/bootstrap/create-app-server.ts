import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import type { AgentState } from "@parasor/shared";
import { type Context, Hono } from "hono";
import type { AgentDetector } from "../agent-detector/detector.js";
import { originMiddleware } from "../auth/origin.js";
import type { PairingTokenStore } from "../auth/pairing-token.js";
import type { TokenAuth } from "../auth/token.js";
import { createTokenExchangeMiddleware } from "../auth/token-exchange.js";
import type { AgentStatusRecorder } from "../debug/agent-status-recorder.js";
import type { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";
import { FontInstaller } from "../fonts/installer.js";
import { createFontRoutes } from "../fonts/routes.js";
import type { FilesystemService } from "../fs/service.js";
import type { UploadStaging } from "../fs/upload-staging.js";
import type { PortForwarder } from "../port-forwarder/forwarder.js";
import type { PortScanner } from "../port-scanner/scanner.js";
import type { PtyHost } from "../pty/host.js";
import { createDebugAgentStatusRoute } from "../routes/debug-agent-status.js";
import { createDebugDiagnosticsRoute } from "../routes/debug-diagnostics.js";
import { createDebugTerminalTraceRoute } from "../routes/debug-terminal-trace.js";
import { createDropRoutes } from "../routes/drops.js";
import { createFileUploadRoutes } from "../routes/file-uploads.js";
import { createFileRoutes } from "../routes/files.js";
import { createFilesystemRoutes } from "../routes/filesystem.js";
import { createGitRoutes } from "../routes/git.js";
import { createHealthzRoute } from "../routes/healthz.js";
import { createHookRoute } from "../routes/hook.js";
import { createIdeCommandRoutes } from "../routes/ide-commands.js";
import { createOpenRoute } from "../routes/open.js";
import { createPaneCommandRoutes } from "../routes/pane-commands.js";
import { createProjectRoutes } from "../routes/projects.js";
import { createRuntimeRoutes } from "../routes/runtime.js";
import { createServerNoticesRoutes } from "../routes/server-notices.js";
import { createServiceConfigRoutes } from "../routes/service-config.js";
import { createSessionRoutes } from "../routes/sessions.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { ServerNoticesStore } from "../state/server-notices.js";
import type { WorktreeCache } from "../state/worktree-cache.js";
import { type EventBus, handleEventClientMessage } from "../ws/events.js";
import { attachKeepalive } from "../ws/keepalive.js";
import {
  cleanupTerminalRelay,
  handleTerminalMessage,
  setupTerminalRelay,
} from "../ws/terminal.js";
import type { ProjectRuntime } from "./project-runtime.js";
import { enrichPorts } from "./runtime-loops.js";

export type AuthMode = "token" | "allowlist" | "none";

export interface WsKeepaliveConfig {
  pingIntervalMs: number;
  pongTimeoutMs: number;
}

export interface CreateAppServerDeps {
  authMode: AuthMode;
  tokenAuth: TokenAuth;
  pairingTokens: PairingTokenStore;
  ptyManager: PtyHost;
  agentDetector: AgentDetector;
  getAgentStates: () => Record<string, AgentState>;
  debugRecorder: AgentStatusRecorder;
  terminalTraceRecorder: TerminalTraceRecorder;
  eventBus: EventBus;
  projectManager: ProjectManager;
  appStateStore: AppStateStore;
  serverNoticesStore: ServerNoticesStore;
  worktreeCache: WorktreeCache;
  projectRuntime: ProjectRuntime;
  portScanner: PortScanner;
  portForwarder: PortForwarder;
  serverVersion?: string;
  uploadStaging: UploadStaging;
  reconcileWorktrees?: (
    projectId: string,
    prefetched?: import("@parasor/shared").Worktree[],
  ) => Promise<void>;
  getFilesystemService: (
    projectId: string,
    worktreePath?: string,
  ) => FilesystemService | null;
  webDistPath: string;
  allowedOrigins: Set<string>;
  wsKeepalive?: WsKeepaliveConfig;
  onServiceConfigChanged: (
    config: import("@parasor/shared").ServiceConfig,
  ) => void;
}

export function createAppServer({
  authMode,
  tokenAuth,
  pairingTokens,
  ptyManager,
  agentDetector,
  getAgentStates,
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
  serverVersion = "0.0.0",
  uploadStaging,
  reconcileWorktrees,
  getFilesystemService,
  webDistPath,
  allowedOrigins,
  wsKeepalive,
  onServiceConfigChanged,
}: CreateAppServerDeps) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  const keepaliveConfig = wsKeepalive ?? {
    pingIntervalMs: 20_000,
    pongTimeoutMs: 10_000,
  };

  app.use(
    "*",
    createTokenExchangeMiddleware({
      mode: authMode,
      tokenAuth,
      pairingTokens,
    }),
  );
  app.route("/healthz", createHealthzRoute());
  app.route(
    "/hook",
    createHookRoute({ ptyManager, agentDetector, debugRecorder }),
  );

  app.use("/api/*", tokenAuth.middleware(authMode));
  app.use("/ws/*", originMiddleware({ allowed: allowedOrigins }));
  app.use("/ws/*", tokenAuth.middleware(authMode));

  app.use("/api/*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    const contentType = c.res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/pdf")) {
      c.header("X-Frame-Options", "DENY");
    }
  });

  app.route(
    "/api/projects",
    createProjectRoutes(
      projectManager,
      eventBus,
      ptyManager,
      appStateStore,
      worktreeCache,
      reconcileWorktrees,
    ),
  );
  app.route(
    "/api/projects",
    createDropRoutes({
      projectManager,
      appStateStore,
      ptyManager,
      uploadStaging,
    }),
  );
  app.route(
    "/api/projects",
    createFileUploadRoutes({ projectManager, appStateStore }),
  );
  app.route(
    "/api/projects",
    createGitRoutes({ projectManager, worktreeCache, projectRuntime }),
  );
  app.route(
    "/api/sessions",
    createSessionRoutes(
      ptyManager,
      eventBus,
      appStateStore,
      terminalTraceRecorder,
    ),
  );
  app.route("/api/fs", createFilesystemRoutes());
  app.route("/api/open", createOpenRoute(eventBus));
  app.route(
    "/api/pane-commands",
    createPaneCommandRoutes({ appStateStore, eventBus }),
  );
  app.route(
    "/api/ide-commands",
    createIdeCommandRoutes({ appStateStore, eventBus }),
  );
  app.route(
    "/api/debug/agent-status",
    createDebugAgentStatusRoute(debugRecorder, getAgentStates),
  );
  app.route(
    "/api/debug/diagnostics",
    createDebugDiagnosticsRoute({
      terminalTraceRecorder,
    }),
  );
  app.route(
    "/api/debug/terminal-trace",
    createDebugTerminalTraceRoute({
      recorder: terminalTraceRecorder,
      ptyManager,
      eventBus,
      appStateStore,
      projectManager,
    }),
  );
  app.route(
    "/api/files",
    createFileRoutes(projectManager, getFilesystemService, {
      isWritable: (projectId) => !projectManager.get(projectId)?.readOnly,
    }),
  );
  app.route("/api/fonts", createFontRoutes(new FontInstaller()));
  app.route(
    "/api/service-config",
    createServiceConfigRoutes({
      appStateStore,
      eventBus,
      onConfigChanged: onServiceConfigChanged,
    }),
  );

  app.route("/api/notices", createServerNoticesRoutes(serverNoticesStore));
  app.route(
    "/api/runtime",
    createRuntimeRoutes({
      appStateStore,
      eventBus,
      getAgentStates,
      getPorts: () => {
        const out: Record<string, import("@parasor/shared").PortInfo[]> = {};
        for (const [projectId, ports] of Object.entries(
          portScanner.getAllPorts(),
        )) {
          out[projectId] = enrichPorts(ports, projectId, portForwarder);
        }
        return out;
      },
      projectManager,
      projectRuntime,
      ptyManager,
      serverVersion,
      worktreeCache,
    }),
  );

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/api/auth/verify", (c) => {
    const startedAt = performance.now();
    const traceId = c.req.header("x-parasor-auth-trace-id");
    terminalTraceRecorder.record("auth-verify", {
      phase: "server-received",
      ...(traceId ? { traceId } : {}),
      path: c.req.path,
    });
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    terminalTraceRecorder.record("auth-verify", {
      phase: "server-complete",
      ...(traceId ? { traceId } : {}),
      status: 200,
      durationMs,
    });
    return c.json({ ok: true });
  });

  app.get(
    "/ws/terminal/:id",
    upgradeWebSocket((c) => {
      const sessionId = c.req.param("id");
      if (!sessionId) throw new Error("missing terminal session id");
      const clientId = c.req.query("clientId") ?? randomUUID();
      let wsInstance: object | undefined;
      let disposeKeepalive: (() => void) | null = null;
      return {
        onOpen(_event, ws) {
          wsInstance = ws;
          const raw = ws.raw;
          if (raw) disposeKeepalive = attachKeepalive(raw, keepaliveConfig);
          setupTerminalRelay(
            ws,
            sessionId,
            clientId,
            ptyManager,
            terminalTraceRecorder,
          );
        },
        onMessage(event, ws) {
          void handleTerminalMessage(
            ws,
            sessionId,
            clientId,
            ptyManager,
            event,
            terminalTraceRecorder,
          );
        },
        onClose() {
          disposeKeepalive?.();
          disposeKeepalive = null;
          if (wsInstance) {
            cleanupTerminalRelay(
              wsInstance,
              sessionId,
              clientId,
              ptyManager,
              terminalTraceRecorder,
            );
          }
        },
      };
    }),
  );

  app.get(
    "/ws/events",
    upgradeWebSocket(() => {
      let disposeKeepalive: (() => void) | null = null;
      return {
        async onOpen(_event, ws) {
          const raw = ws.raw;
          if (raw) disposeKeepalive = attachKeepalive(raw, keepaliveConfig);
          await eventBus.addClient(ws);
        },
        onMessage(event, ws) {
          handleEventClientMessage(ws, event.data);
        },
        onClose(_event, ws) {
          disposeKeepalive?.();
          disposeKeepalive = null;
          eventBus.removeClient(ws);
        },
      };
    }),
  );

  const serveIndex = async (c: Context) => {
    const html = await readFile(join(webDistPath, "index.html"), "utf8");
    // Clickjacking defense for the app shell. sameSite=Strict already stops a
    // cross-site frame from carrying the token, but deny framing outright too.
    // `frame-ancestors 'none'` is the only CSP directive set here, so it does
    // not constrain the app's own script/style/font/WebGL loading.
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", "frame-ancestors 'none'");
    return c.html(html);
  };

  app.get("/", serveIndex);
  app.get("/monitor", serveIndex);
  app.get("/sessions/*", serveIndex);
  app.get("/panes/*", serveIndex);
  app.get("/worktree", serveIndex);

  app.use("/*", serveStatic({ root: webDistPath }));

  return { app, injectWebSocket };
}

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitState, Session } from "@parasor/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PairingTokenStore } from "../auth/pairing-token.js";
import { TokenAuth } from "../auth/token.js";
import { createAppServer } from "../bootstrap/create-app-server.js";
import type { ProjectRuntime } from "../bootstrap/project-runtime.js";
import type { AgentStatusRecorder } from "../debug/agent-status-recorder.js";
import type { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";
import type { FilesystemService } from "../fs/service.js";
import type { UploadStaging } from "../fs/upload-staging.js";
import type { PtyHost } from "../pty/host.js";
import type { RuntimeApiDeps } from "../runtime-api/dispatcher.js";
import { RuntimeServiceRegistry } from "../runtime-services/service-registry.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { ServerNoticesStore } from "../state/server-notices.js";
import { WorktreeCache } from "../state/worktree-cache.js";
import type { EventBus } from "../ws/events.js";
import { createRuntimeRoutes } from "./runtime.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? "sess-1",
    projectId: overrides.projectId ?? "proj-1",
    pid: overrides.pid ?? 1234,
    state: overrides.state ?? "running",
    generation: overrides.generation ?? 3,
    title: overrides.title ?? "bash",
    command: overrides.command ?? { type: "shell" },
    cwd: overrides.cwd ?? "/tmp/project",
    shell: overrides.shell ?? "/bin/bash",
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  };
}

function makeDeps(root = mkdtempSync(join(tmpdir(), "parasor-runtime-api-"))) {
  const project = {
    id: "proj-1",
    name: "Project",
    path: root,
    createdAt: 1,
    lastAccessedAt: 2,
  };
  const sessions = new Map<string, Session>();
  const scrollback = new Map<string, string>();
  const gitStates: Record<string, Record<string, GitState | null>> = {};
  const service = {
    readFile: vi.fn(async () => "file contents"),
  } as unknown as FilesystemService;
  const worktreeCache = new WorktreeCache();
  worktreeCache.setProject(project.id, [
    { path: project.path, head: "abc", branch: "main" },
  ]);

  const ptyManager = {
    list: vi.fn(() => [...sessions.values()]),
    listByProject: vi.fn((projectId: string) =>
      [...sessions.values()].filter(
        (session) => session.projectId === projectId,
      ),
    ),
    get: vi.fn((id: string) => sessions.get(id)),
    getScrollback: vi.fn((id: string) => scrollback.get(id) ?? null),
    create: vi.fn(async (input: { projectId: string; cwd: string }) => {
      const session = makeSession({
        id: "created-1",
        projectId: input.projectId,
        cwd: input.cwd,
      });
      sessions.set(session.id, session);
      return session;
    }),
    write: vi.fn(),
    onSessionInput: vi.fn(),
    onSessionData: vi.fn(),
  } as unknown as PtyHost;

  const appStateStore = {
    get: vi.fn(() => ({
      version: 1,
      projects: [project],
      projectStates: {
        [project.id]: {
          projectId: project.id,
          layout: { type: "empty", id: "browser-only-layout" },
          worktrees: [],
          openFiles: [],
          lastFocusedPaneId: null,
          focusedPaneId: null,
          sidebar: {
            paneOrder: { [project.path]: ["files"] },
            worktreeOpen: {},
          },
          worktreeMetadata: {},
          lastAccessedAt: 2,
        },
      },
      sessions: [...sessions.values()],
      sessionRecords: [],
      serviceConfig: {
        preventIdleSleep: false,
        portDetection: "all-interfaces",
        dropSizeMaxBytes: 1,
        dropSizeHardMaxBytes: 1,
      },
      paneCommands: [],
      ideCommands: [],
    })),
  } as unknown as AppStateStore;

  const eventBus = {
    broadcast: vi.fn(),
    addClient: vi.fn(),
    removeClient: vi.fn(),
    getNotifications: vi.fn(() => []),
  } as unknown as EventBus;

  const projectManager = {
    get: vi.fn((id: string) => (id === project.id ? project : undefined)),
    list: vi.fn(() => [project]),
  } as unknown as ProjectManager;

  const projectRuntime = {
    getFilesystemService: vi.fn((projectId: string) =>
      projectId === project.id ? service : null,
    ),
    isMissing: vi.fn(() => false),
    getMissingProjectIds: vi.fn(() => []),
    noteMissingPath: vi.fn(),
    notePresentPath: vi.fn(),
    isLiveWatched: vi.fn(() => false),
    onClientActiveProject: vi.fn(),
    noteLiveSession: vi.fn(),
    onPathMissing: vi.fn(),
    onPathRestored: vi.fn(),
    snapshotInactiveGit: vi.fn(),
    getGitStates: vi.fn(() => gitStates),
    refreshGitState: vi.fn(async (projectId: string, worktreePath: string) => {
      gitStates[projectId] = {
        ...(gitStates[projectId] ?? {}),
        [worktreePath]: {
          branch: "main",
          dirty: false,
          dirtyCount: 0,
          lastChecked: 10,
        },
      };
    }),
  } as unknown as ProjectRuntime;

  const deps: RuntimeApiDeps = {
    appStateStore,
    eventBus,
    getAgentStates: () => ({
      "sess-1": {
        sessionId: "sess-1",
        lifecycle: "running",
        source: "activity",
        confidence: "low",
        detectedAt: 3,
      },
    }),
    getPorts: () => ({
      [project.id]: [{ port: 5173, pid: 100, bindsAll: true, reachable: true }],
    }),
    getServices: () => ({
      [project.id]: [
        {
          id: "svc",
          kind: "workspace",
          port: 5173,
          pid: 100,
          processName: "vite",
          bindHost: "0.0.0.0",
          connectHost: "localhost",
          bindsAll: true,
          protocol: "http",
          serviceName: "vite",
          attribution: {
            source: "session-process-tree",
            confidence: "high",
            projectId: project.id,
            worktreePath: project.path,
            sessionId: "sess-1",
          },
          reachable: true,
          lifecycle: "reachable",
          firstSeenAt: 1,
          lastSeenAt: 1,
          source: "scanner",
        },
      ],
    }),
    platform: "darwin",
    projectManager,
    projectRuntime,
    ptyManager,
    runGit: vi.fn(async (_cwd: string, args: string[]) => {
      if (args[0] === "worktree") {
        return `worktree ${project.path}\nHEAD abc\nbranch refs/heads/main\n`;
      }
      return "";
    }),
    serverVersion: "9.9.9",
    worktreeCache,
  };

  return {
    deps,
    eventBus,
    gitStates,
    project,
    projectRuntime,
    ptyManager,
    root,
    scrollback,
    service,
    sessions,
  };
}

function makeApp(deps: RuntimeApiDeps) {
  const app = new Hono();
  app.route("/api/runtime", createRuntimeRoutes(deps));
  return app;
}

function makeProductionApp(
  harness: ReturnType<typeof makeDeps>,
  auth: TokenAuth,
) {
  return createAppServer({
    authMode: "token",
    tokenAuth: auth,
    pairingTokens: new PairingTokenStore(),
    ptyManager: harness.ptyManager,
    agentDetector: { feed: vi.fn(), removeSession: vi.fn() } as never,
    getAgentStates: harness.deps.getAgentStates,
    debugRecorder: { record: vi.fn() } as unknown as AgentStatusRecorder,
    terminalTraceRecorder: {
      record: vi.fn(),
    } as unknown as TerminalTraceRecorder,
    eventBus: harness.eventBus,
    projectManager: harness.deps.projectManager,
    appStateStore: harness.deps.appStateStore,
    serverNoticesStore: {
      list: vi.fn(() => []),
    } as unknown as ServerNoticesStore,
    worktreeCache: harness.deps.worktreeCache,
    projectRuntime: harness.deps.projectRuntime,
    serviceRegistry: new RuntimeServiceRegistry(),
    uploadStaging: {} as UploadStaging,
    getFilesystemService: (projectId, worktreePath) =>
      harness.deps.projectRuntime.getFilesystemService(projectId, worktreePath),
    webDistPath: harness.root,
    allowedOrigins: new Set(["http://127.0.0.1:7682"]),
    onServiceConfigChanged: vi.fn(),
  }).app;
}

async function runtimeCall(app: Hono, body: unknown) {
  return await app.request("/api/runtime/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let roots: string[] = [];

describe("runtime API route", () => {
  let harness: ReturnType<typeof makeDeps>;
  let app: Hono;

  beforeEach(() => {
    harness = makeDeps();
    roots.push(harness.root);
    app = makeApp(harness.deps);
  });

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots = [];
  });

  it("returns unknown_method for unsupported methods", async () => {
    const res = await runtimeCall(app, {
      id: "r1",
      method: "missing.nope",
      params: {},
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: false,
      id: "r1",
      error: { code: "unknown_method" },
    });
  });

  it("returns invalid_arguments for malformed params", async () => {
    const res = await runtimeCall(app, {
      id: "r2",
      method: "terminal.send",
      params: { sessionId: "sess-1", data: "x" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: false,
      id: "r2",
      error: { code: "invalid_arguments" },
    });
  });

  it("can be protected by the existing token middleware", async () => {
    const authDir = mkdtempSync(join(tmpdir(), "parasor-runtime-auth-"));
    roots.push(authDir);
    const auth = new TokenAuth({ dir: authDir, ephemeral: true });
    const protectedApp = new Hono();
    protectedApp.use("/api/*", auth.middleware("token"));
    protectedApp.route("/api/runtime", createRuntimeRoutes(harness.deps));

    const rejected = await runtimeCall(protectedApp, {
      method: "runtime.describe",
    });
    expect(rejected.status).toBe(401);

    const accepted = await protectedApp.request("/api/runtime/call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `parasor_token=${auth.token}`,
      },
      body: JSON.stringify({ method: "runtime.describe" }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true });
  });

  it("is protected by the production app /api auth middleware", async () => {
    const authDir = mkdtempSync(join(tmpdir(), "parasor-runtime-app-auth-"));
    roots.push(authDir);
    const auth = new TokenAuth({ dir: authDir, ephemeral: true });
    const productionApp = makeProductionApp(harness, auth);

    const rejected = await runtimeCall(productionApp, {
      method: "runtime.describe",
    });
    expect(rejected.status).toBe(401);

    const accepted = await productionApp.request("/api/runtime/call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `parasor_token=${auth.token}`,
      },
      body: JSON.stringify({ method: "runtime.describe" }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true });
  });

  it("describes v1 methods and capabilities", async () => {
    const res = await runtimeCall(app, {
      id: "describe",
      method: "runtime.describe",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      ok: true,
      id: "describe",
      result: {
        contractVersion: "runtime.v1",
        serverVersion: "9.9.9",
        capabilities: {
          oneShotCalls: true,
          terminalRead: { maxBytes: 4194304, maxCols: 512, maxRows: 200 },
          terminalSend: { generationRequired: true, maxInputBytes: 65536 },
        },
      },
    });
    expect(data.result.methods).toEqual(
      expect.arrayContaining([
        {
          name: "terminal.send",
          version: 1,
          access: "write",
          stability: "experimental",
        },
        {
          name: "files.read",
          version: 1,
          access: "read",
          stability: "experimental",
        },
      ]),
    );
  });

  it("returns a stable runtime status projection without browser layout state", async () => {
    harness.sessions.set("sess-1", makeSession({ id: "sess-1" }));
    const res = await runtimeCall(app, {
      method: "runtime.status",
      params: { projectId: harness.project.id },
    });
    const data = await res.json();
    expect(data.result.projects).toHaveLength(1);
    expect(data.result.sessions).toHaveLength(1);
    expect(data.result.agentStates["sess-1"]).toBeTruthy();
    expect(data.result.worktrees[harness.project.id]).toHaveLength(1);
    expect(data.result.ports[harness.project.id][0].reachable).toBe(true);
    expect(data.result.services[harness.project.id][0]).toMatchObject({
      port: 5173,
      serviceName: "vite",
    });
    expect(data.result.projectStates).toBeUndefined();
    expect(data.result.serviceConfig).toBeUndefined();
  });

  it("lists and creates terminal sessions through the session application service", async () => {
    harness.sessions.set("sess-1", makeSession({ id: "sess-1" }));
    const listed = await runtimeCall(app, {
      method: "terminal.list",
      params: { projectId: harness.project.id },
    });
    expect((await listed.json()).result.sessions).toHaveLength(1);

    const created = await runtimeCall(app, {
      method: "terminal.create",
      params: {
        projectId: harness.project.id,
        cwd: harness.project.path,
        title: "Runtime",
        bootstrapInput: "echo ok\r",
      },
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      ok: true,
      result: { session: { id: "created-1", projectId: harness.project.id } },
    });
    expect(harness.eventBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session-created" }),
    );
  });

  it("rejects oversized terminal bootstrap input", async () => {
    const res = await runtimeCall(app, {
      method: "terminal.create",
      params: {
        projectId: harness.project.id,
        bootstrapInput: "x".repeat(64 * 1024 + 1),
      },
    });
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" },
    });
    expect(harness.ptyManager.create).not.toHaveBeenCalled();
  });

  it("reads bounded terminal scrollback", async () => {
    harness.sessions.set(
      "sess-1",
      makeSession({ id: "sess-1", generation: 7 }),
    );
    harness.scrollback.set("sess-1", "hello\nworld\n");
    const res = await runtimeCall(app, {
      method: "terminal.read",
      params: { sessionId: "sess-1", maxBytes: 1024 },
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      result: {
        sessionId: "sess-1",
        generation: 7,
        maxBytes: 1024,
        hasMore: false,
      },
    });
  });

  it("clamps terminal read byte limits and reports truncated output", async () => {
    harness.sessions.set(
      "sess-1",
      makeSession({ id: "sess-1", generation: 7 }),
    );
    harness.scrollback.set("sess-1", `${"line\n".repeat(2000)}`);
    const res = await runtimeCall(app, {
      method: "terminal.read",
      params: {
        sessionId: "sess-1",
        rows: 24,
        cols: 80,
        maxBytes: Number.MAX_SAFE_INTEGER,
      },
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      result: {
        sessionId: "sess-1",
        generation: 7,
        maxBytes: 4 * 1024 * 1024,
      },
    });

    const truncated = await runtimeCall(app, {
      method: "terminal.read",
      params: { sessionId: "sess-1", maxBytes: 64 },
    });
    expect(await truncated.json()).toMatchObject({
      ok: true,
      result: { maxBytes: 64, hasMore: true },
    });
  });

  it("rejects oversized terminal read dimensions", async () => {
    const res = await runtimeCall(app, {
      method: "terminal.read",
      params: { sessionId: "sess-1", cols: 513, rows: 24 },
    });
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" },
    });
  });

  it("requires current generation before sending terminal input", async () => {
    harness.sessions.set(
      "sess-1",
      makeSession({ id: "sess-1", generation: 7 }),
    );
    const stale = await runtimeCall(app, {
      method: "terminal.send",
      params: { sessionId: "sess-1", data: "x", generation: 6 },
    });
    expect(await stale.json()).toMatchObject({
      ok: false,
      error: { code: "stale_generation" },
    });
    expect(harness.ptyManager.write).not.toHaveBeenCalled();

    const accepted = await runtimeCall(app, {
      method: "terminal.send",
      params: { sessionId: "sess-1", data: "x", generation: 7 },
    });
    expect(await accepted.json()).toMatchObject({
      ok: true,
      result: { accepted: true, sessionId: "sess-1", generation: 7 },
    });
    expect(harness.ptyManager.write).toHaveBeenCalledWith("sess-1", "x", 7);
  });

  it("rejects sends to ended sessions", async () => {
    harness.sessions.set(
      "sess-1",
      makeSession({ id: "sess-1", state: "ended", generation: 7 }),
    );
    const res = await runtimeCall(app, {
      method: "terminal.send",
      params: { sessionId: "sess-1", data: "x", generation: 7 },
    });
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: "terminal_unavailable" },
    });
  });

  it("maps worktree.list missing path to conflict not worktree_not_found", async () => {
    harness.deps.runGit = vi.fn(async () => {
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    });
    const res = await runtimeCall(app, {
      method: "worktree.list",
      params: { projectId: harness.project.id },
    });
    expect(await res.json()).toMatchObject({
      ok: false,
      error: {
        code: "conflict",
        message: "Project directory is missing",
      },
    });
  });

  it("maps worktree.list git failure to retryable internal_error", async () => {
    harness.deps.runGit = vi.fn(async () => {
      throw new Error("fatal: not a git repository");
    });
    const res = await runtimeCall(app, {
      method: "worktree.list",
      params: { projectId: harness.project.id },
    });
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: "internal_error", retryable: true },
    });
  });

  it("lists worktrees using the project query service", async () => {
    const res = await runtimeCall(app, {
      method: "worktree.list",
      params: { projectId: harness.project.id },
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      result: {
        worktrees: [{ path: harness.project.path, branch: "main" }],
      },
    });
  });

  it("reads project files through the filesystem query service", async () => {
    const res = await runtimeCall(app, {
      method: "files.read",
      params: { projectId: harness.project.id, path: "README.md" },
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      result: {
        projectId: harness.project.id,
        path: "README.md",
        content: "file contents",
        encoding: "utf-8",
        truncated: false,
      },
    });
    expect(harness.service.readFile).toHaveBeenCalledWith("README.md");
  });

  it("rejects unknown worktree selectors before reading files", async () => {
    const res = await runtimeCall(app, {
      method: "files.read",
      params: {
        projectId: harness.project.id,
        worktreePath: join(harness.project.path, "missing-worktree"),
        path: "README.md",
      },
    });
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: "worktree_not_found" },
    });
    expect(harness.service.readFile).not.toHaveBeenCalled();
  });

  it("refreshes and returns git status for a fenced worktree", async () => {
    const res = await runtimeCall(app, {
      method: "git.status",
      params: {
        projectId: harness.project.id,
        worktreePath: harness.project.path,
      },
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      result: { state: { branch: "main", dirty: false } },
    });
    expect(harness.projectRuntime.refreshGitState).toHaveBeenCalledWith(
      harness.project.id,
      realpathSync(harness.project.path),
    );
  });

  it("returns enriched port snapshots", async () => {
    const res = await runtimeCall(app, {
      method: "ports.list",
      params: { projectId: harness.project.id },
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      result: {
        ports: {
          [harness.project.id]: [
            { port: 5173, pid: 100, bindsAll: true, reachable: true },
          ],
        },
      },
    });
  });

  it("returns attributed service snapshots", async () => {
    const res = await runtimeCall(app, {
      method: "services.list",
      params: { projectId: harness.project.id },
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      result: {
        services: {
          [harness.project.id]: [
            {
              kind: "workspace",
              port: 5173,
              serviceName: "vite",
              attribution: { worktreePath: harness.project.path },
            },
          ],
        },
      },
    });
  });
});

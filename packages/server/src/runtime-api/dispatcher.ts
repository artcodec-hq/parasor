import {
  type AgentState,
  type FilesReadParams,
  type FilesReadResult,
  type GitStatusParams,
  type GitStatusResult,
  normalizeRuntimeMethodParams,
  type PortInfo,
  type PortsListParams,
  type PortsListResult,
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_FILES_READ_MAX_BYTES,
  RUNTIME_METHOD_DESCRIPTORS,
  RUNTIME_TERMINAL_READ_DEFAULT_MAX_BYTES,
  RUNTIME_TERMINAL_READ_MAX_BYTES,
  RUNTIME_TERMINAL_READ_MAX_COLS,
  RUNTIME_TERMINAL_READ_MAX_ROWS,
  RUNTIME_TERMINAL_SEND_MAX_BYTES,
  type RuntimeCallFailure,
  type RuntimeCallRequest,
  type RuntimeCallResponse,
  type RuntimeDescribeResult,
  type RuntimeMethodName,
  type RuntimeMethodParams,
  type RuntimeServiceInfo,
  type RuntimeStatusParams,
  type RuntimeStatusResult,
  type ServicesListParams,
  type ServicesListResult,
  type TerminalCreateParams,
  type TerminalCreateResult,
  type TerminalListParams,
  type TerminalListResult,
  type TerminalReadParams,
  type TerminalReadResult,
  type TerminalSendParams,
  type TerminalSendResult,
  type WorktreeListParams,
  type WorktreeListResult,
} from "@parasor/shared";
import { createProjectFileQueries } from "../application/files/project-file-queries.js";
import { createProjectQueries } from "../application/workspace/project-queries.js";
import { createSessionCommands } from "../application/workspace/session-commands.js";
import { createSessionQueries } from "../application/workspace/session-queries.js";
import { fenceWorktreePathWith } from "../application/workspace/worktree-commands.js";
import type { ProjectRuntime } from "../bootstrap/project-runtime.js";
import { buildHeadlessReplaySnapshot } from "../pty/headless-replay-snapshot.js";
import type { PtyHost } from "../pty/host.js";
import type { TerminalPresenceManager } from "../pty/terminal-presence-manager.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { WorktreeCache } from "../state/worktree-cache.js";
import type { EventBus } from "../ws/events.js";
import { mapRuntimeApiError, RuntimeApiError } from "./errors.js";

const DEFAULT_SCROLLBACK_SNAPSHOT_COLS = 80;
const DEFAULT_SCROLLBACK_SNAPSHOT_ROWS = 24;
const DEFAULT_SCROLLBACK_SNAPSHOT_LINES = 10_000;
const MAX_SCROLLBACK_SNAPSHOT_LINES = 160_000;

export interface RuntimeApiDeps {
  appStateStore: AppStateStore;
  eventBus: EventBus;
  getAgentStates: () => Record<string, AgentState>;
  getPorts: () => Record<string, PortInfo[]>;
  getServices: () => Record<string, RuntimeServiceInfo[]>;
  platform?: NodeJS.Platform;
  projectManager: ProjectManager;
  projectRuntime: ProjectRuntime;
  ptyManager: PtyHost;
  terminalPresenceManager?: TerminalPresenceManager;
  runGit?: (projectPath: string, args: string[]) => Promise<string>;
  serverVersion?: string;
  worktreeCache: WorktreeCache;
}

export interface RuntimeDispatcher {
  call(request: RuntimeCallRequest): Promise<RuntimeCallResponse>;
}

export function createRuntimeDispatcher(
  deps: RuntimeApiDeps,
): RuntimeDispatcher {
  return {
    async call(request) {
      const params = normalizeRuntimeMethodParams(
        request.method,
        request.params,
      );
      if (!params.ok) {
        return runtimeFailure(request.id, "invalid_arguments", params.message);
      }
      try {
        const result = await executeMethod(deps, request.method, params.value);
        return {
          ok: true,
          ...(request.id !== undefined && { id: request.id }),
          result,
        };
      } catch (error) {
        const mapped = mapRuntimeApiError(error);
        return runtimeFailure(
          request.id,
          mapped.code,
          mapped.message,
          mapped.details,
          mapped.retryable,
        );
      }
    },
  };
}

export function runtimeFailure(
  id: string | undefined,
  code: RuntimeCallFailure["error"]["code"],
  message: string,
  details?: Record<string, unknown>,
  retryable?: boolean,
): RuntimeCallFailure {
  return {
    ok: false,
    ...(id !== undefined && { id }),
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      ...(retryable !== undefined && { retryable }),
    },
  };
}

async function executeMethod(
  deps: RuntimeApiDeps,
  method: RuntimeMethodName,
  params: RuntimeMethodParams[RuntimeMethodName],
): Promise<unknown> {
  switch (method) {
    case "runtime.describe":
      return runtimeDescribe(deps);
    case "runtime.status":
      return runtimeStatus(deps, params as RuntimeStatusParams);
    case "terminal.list":
      return terminalList(deps, params as TerminalListParams);
    case "terminal.create":
      return terminalCreate(deps, params as TerminalCreateParams);
    case "terminal.read":
      return terminalRead(deps, params as TerminalReadParams);
    case "terminal.send":
      return terminalSend(deps, params as TerminalSendParams);
    case "worktree.list":
      return worktreeList(deps, params as WorktreeListParams);
    case "files.read":
      return filesRead(deps, params as FilesReadParams);
    case "git.status":
      return gitStatus(deps, params as GitStatusParams);
    case "ports.list":
      return portsList(deps, params as PortsListParams);
    case "services.list":
      return servicesList(deps, params as ServicesListParams);
  }
}

function runtimeDescribe({
  platform = process.platform,
  serverVersion = "0.0.0",
}: RuntimeApiDeps): RuntimeDescribeResult {
  return {
    contractVersion: RUNTIME_CONTRACT_VERSION,
    serverVersion,
    hostPlatform: platform,
    methods: [...RUNTIME_METHOD_DESCRIPTORS],
    capabilities: {
      oneShotCalls: true,
      eventWebSocket: { available: true, path: "/ws/events" },
      terminalWebSocket: {
        available: true,
        pathTemplate: "/ws/terminal/{sessionId}",
        binary: true,
        chunkedReplay: "capability-negotiated",
      },
      terminalRead: {
        boundedSnapshot: true,
        defaultMaxBytes: RUNTIME_TERMINAL_READ_DEFAULT_MAX_BYTES,
        maxBytes: RUNTIME_TERMINAL_READ_MAX_BYTES,
        maxCols: RUNTIME_TERMINAL_READ_MAX_COLS,
        maxRows: RUNTIME_TERMINAL_READ_MAX_ROWS,
      },
      terminalSend: {
        generationRequired: true,
        maxInputBytes: RUNTIME_TERMINAL_SEND_MAX_BYTES,
      },
      filesRead: {
        textOnly: true,
        defaultMaxBytes: RUNTIME_FILES_READ_MAX_BYTES,
        maxBytes: RUNTIME_FILES_READ_MAX_BYTES,
      },
    },
  };
}

function runtimeStatus(
  {
    appStateStore,
    getAgentStates,
    getPorts,
    getServices,
    platform = process.platform,
    projectRuntime,
    ptyManager,
    worktreeCache,
  }: RuntimeApiDeps,
  params: RuntimeStatusParams,
): RuntimeStatusResult {
  const projectFilter = params.projectId;
  const state = appStateStore.get();
  const projects = projectFilter
    ? state.projects.filter((project) => project.id === projectFilter)
    : state.projects;
  const projectIds = new Set(projects.map((project) => project.id));
  const sessions = ptyManager
    .list()
    .filter((session) => !projectFilter || session.projectId === projectFilter);
  const sessionIds = new Set(sessions.map((session) => session.id));
  return {
    contractVersion: RUNTIME_CONTRACT_VERSION,
    projects,
    sessions,
    agentStates: filterAgentStates(getAgentStates(), sessionIds),
    worktrees: filterRecord(worktreeCache.get(), projectIds),
    gitStates: filterRecord(projectRuntime.getGitStates(), projectIds),
    ports: filterRecord(getPorts(), projectIds),
    services: filterRecord(getServices(), projectIds),
    hostPlatform: platform,
  };
}

function terminalList(
  { ptyManager }: RuntimeApiDeps,
  params: TerminalListParams,
): TerminalListResult {
  return {
    sessions: createSessionQueries({ ptyManager }).listSessions(
      params.projectId,
    ),
  };
}

async function terminalCreate(
  { appStateStore, eventBus, ptyManager }: RuntimeApiDeps,
  params: TerminalCreateParams,
): Promise<TerminalCreateResult> {
  const session = await createSessionCommands({
    appStateStore,
    eventBus,
    ptyManager,
  }).createSession(params);
  return { session };
}

async function terminalRead(
  { ptyManager }: RuntimeApiDeps,
  params: TerminalReadParams,
): Promise<TerminalReadResult> {
  const session = ptyManager.get(params.sessionId);
  if (!session) {
    throw new RuntimeApiError("session_not_found", "Session not found");
  }
  const scrollback = ptyManager.getScrollback(params.sessionId);
  if (!scrollback) {
    return {
      sessionId: params.sessionId,
      generation: session.generation,
      text: "",
      rawBytes: 0,
      replayBytes: 0,
      maxBytes: 0,
      hasMore: false,
    };
  }
  const cols = params.cols ?? DEFAULT_SCROLLBACK_SNAPSHOT_COLS;
  const rows = params.rows ?? DEFAULT_SCROLLBACK_SNAPSHOT_ROWS;
  const maxBytes = Math.min(
    params.maxBytes ?? RUNTIME_TERMINAL_READ_DEFAULT_MAX_BYTES,
    RUNTIME_TERMINAL_READ_MAX_BYTES,
  );
  const scrollbackLines = scrollbackLinesForMaxBytes(maxBytes);
  const snapshot = await buildHeadlessReplaySnapshot(scrollback, {
    cols,
    rows,
    scrollbackLines,
    maxBytes,
  });
  const hitLineCap = snapshot.bufferLines >= scrollbackLines + rows;
  return {
    sessionId: params.sessionId,
    generation: session.generation,
    text: snapshot.text,
    rawBytes: snapshot.rawBytes,
    replayBytes: snapshot.snapshotBytes,
    maxBytes,
    hasMore: snapshot.snapshotBytes >= maxBytes || hitLineCap,
    bufferLines: snapshot.bufferLines,
    emittedLines: snapshot.emittedLines,
    scrollbackLines,
  };
}

function terminalSend(
  { ptyManager, terminalPresenceManager }: RuntimeApiDeps,
  params: TerminalSendParams,
): TerminalSendResult {
  const session = ptyManager.get(params.sessionId);
  if (!session) {
    throw new RuntimeApiError("session_not_found", "Session not found");
  }
  if (session.state === "ended") {
    throw new RuntimeApiError(
      "terminal_unavailable",
      "Terminal is not running",
    );
  }
  if (session.generation !== params.generation) {
    throw new RuntimeApiError(
      "stale_generation",
      "Terminal generation is stale",
      {
        details: {
          expected: session.generation,
          received: params.generation,
        },
      },
    );
  }
  if (
    terminalPresenceManager &&
    !terminalPresenceManager.canWrite(params.sessionId, {
      kind: "desktop",
      clientId: "runtime-api",
    })
  ) {
    throw new RuntimeApiError(
      "terminal_unavailable",
      "Terminal is currently controlled by a mobile client",
    );
  }
  ptyManager.write(params.sessionId, params.data, params.generation);
  return {
    accepted: true,
    sessionId: params.sessionId,
    generation: params.generation,
  };
}

async function worktreeList(
  { appStateStore, projectManager, runGit }: RuntimeApiDeps,
  params: WorktreeListParams,
): Promise<WorktreeListResult> {
  const queries = createProjectQueries({
    projectManager,
    ...(runGit !== undefined && { runGit }),
    getWorktreeMetadata: (projectId) =>
      appStateStore.get().projectStates[projectId]?.worktreeMetadata ?? {},
  });
  return { worktrees: await queries.getProjectWorktrees(params.projectId) };
}

async function filesRead(
  { projectManager, projectRuntime, worktreeCache }: RuntimeApiDeps,
  params: FilesReadParams,
): Promise<FilesReadResult> {
  const project = projectManager.get(params.projectId);
  if (!project) {
    throw new RuntimeApiError("project_not_found", "Project not found");
  }
  if (
    params.worktreePath !== undefined &&
    params.worktreePath !== project.path &&
    !(worktreeCache.get()[params.projectId] ?? []).some(
      (worktree) => worktree.path === params.worktreePath,
    )
  ) {
    throw new RuntimeApiError("worktree_not_found", "Worktree not found");
  }
  const content = await createProjectFileQueries({
    projectManager,
    getFilesystemService: (projectId, worktreePath) =>
      projectRuntime.getFilesystemService(projectId, worktreePath),
  }).readProjectFile(params.projectId, params.path, params.worktreePath);
  return {
    projectId: params.projectId,
    ...(params.worktreePath !== undefined && {
      worktreePath: params.worktreePath,
    }),
    path: params.path,
    content,
    encoding: "utf-8",
    maxBytes: RUNTIME_FILES_READ_MAX_BYTES,
    truncated: false,
  };
}

async function gitStatus(
  { projectManager, projectRuntime, worktreeCache }: RuntimeApiDeps,
  params: GitStatusParams,
): Promise<GitStatusResult> {
  const { resolved } = await fenceWorktreePathWith(
    {
      projectManager,
      getProjectWorktrees: (id) => worktreeCache.get()[id] ?? [],
    },
    params.projectId,
    params.worktreePath,
  );
  await projectRuntime.refreshGitState(params.projectId, resolved);
  const states = projectRuntime.getGitStates();
  return { state: states[params.projectId]?.[resolved] ?? null };
}

function portsList(
  { getPorts }: RuntimeApiDeps,
  params: PortsListParams,
): PortsListResult {
  const ports = getPorts();
  if (!params.projectId) return { ports };
  return {
    ports: {
      [params.projectId]: ports[params.projectId] ?? [],
    },
  };
}

function servicesList(
  { getServices }: RuntimeApiDeps,
  params: ServicesListParams,
): ServicesListResult {
  const services = getServices();
  if (!params.projectId) return { services };
  return {
    services: {
      [params.projectId]: services[params.projectId] ?? [],
    },
  };
}

function scrollbackLinesForMaxBytes(maxBytes: number): number {
  const multiplier = Math.max(
    1,
    Math.ceil(maxBytes / RUNTIME_TERMINAL_READ_DEFAULT_MAX_BYTES),
  );
  return Math.min(
    DEFAULT_SCROLLBACK_SNAPSHOT_LINES * multiplier,
    MAX_SCROLLBACK_SNAPSHOT_LINES,
  );
}

function filterRecord<T>(
  value: Record<string, T>,
  projectIds: Set<string>,
): Record<string, T> {
  if (projectIds.size === 0) return {};
  const out: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (projectIds.has(key)) out[key] = entry;
  }
  return out;
}

function filterAgentStates(
  value: Record<string, AgentState>,
  sessionIds: Set<string>,
): Record<string, AgentState> {
  if (sessionIds.size === 0) return {};
  const out: Record<string, AgentState> = {};
  for (const [sessionId, state] of Object.entries(value)) {
    if (sessionIds.has(sessionId)) out[sessionId] = state;
  }
  return out;
}

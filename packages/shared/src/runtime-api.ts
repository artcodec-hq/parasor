import type { AgentState, GitState, PortInfo, Worktree } from "./runtime.js";
import {
  normalizeSessionLaunchPreset,
  type SessionLaunchPreset,
} from "./shell-presets.js";
import type { Project, Session } from "./state.js";

export const RUNTIME_CONTRACT_VERSION = "runtime.v1" as const;

export const RUNTIME_METHODS = [
  "runtime.describe",
  "runtime.status",
  "terminal.list",
  "terminal.create",
  "terminal.read",
  "terminal.send",
  "worktree.list",
  "files.read",
  "git.status",
  "ports.list",
] as const;

export type RuntimeMethodName = (typeof RUNTIME_METHODS)[number];

export type RuntimeErrorCode =
  | "invalid_arguments"
  | "unknown_method"
  | "unauthorized"
  | "forbidden"
  | "file_not_found"
  | "project_not_found"
  | "worktree_not_found"
  | "session_not_found"
  | "terminal_unavailable"
  | "stale_generation"
  | "output_truncated"
  | "conflict"
  | "internal_error";

export interface RuntimeCallRequest {
  id?: string;
  method: RuntimeMethodName;
  params?: unknown;
  client?: {
    name?: string;
    version?: string;
    contractVersion?: string;
  };
}

export interface RuntimeCallSuccess<T = unknown> {
  ok: true;
  id?: string;
  result: T;
}

export interface RuntimeCallFailure {
  ok: false;
  id?: string;
  error: {
    code: RuntimeErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  };
}

export type RuntimeCallResponse<T = unknown> =
  | RuntimeCallSuccess<T>
  | RuntimeCallFailure;

export type RuntimeMethodAccess = "read" | "write";

export interface RuntimeMethodDescriptor {
  name: RuntimeMethodName;
  version: 1;
  access: RuntimeMethodAccess;
  stability: "experimental";
}

export const RUNTIME_METHOD_DESCRIPTORS: readonly RuntimeMethodDescriptor[] = [
  {
    name: "runtime.describe",
    version: 1,
    access: "read",
    stability: "experimental",
  },
  {
    name: "runtime.status",
    version: 1,
    access: "read",
    stability: "experimental",
  },
  {
    name: "terminal.list",
    version: 1,
    access: "read",
    stability: "experimental",
  },
  {
    name: "terminal.create",
    version: 1,
    access: "write",
    stability: "experimental",
  },
  {
    name: "terminal.read",
    version: 1,
    access: "read",
    stability: "experimental",
  },
  {
    name: "terminal.send",
    version: 1,
    access: "write",
    stability: "experimental",
  },
  {
    name: "worktree.list",
    version: 1,
    access: "read",
    stability: "experimental",
  },
  {
    name: "files.read",
    version: 1,
    access: "read",
    stability: "experimental",
  },
  {
    name: "git.status",
    version: 1,
    access: "read",
    stability: "experimental",
  },
  {
    name: "ports.list",
    version: 1,
    access: "read",
    stability: "experimental",
  },
];

export const RUNTIME_TERMINAL_READ_DEFAULT_MAX_BYTES = 256 * 1024;
export const RUNTIME_TERMINAL_READ_MAX_BYTES = 4 * 1024 * 1024;
export const RUNTIME_TERMINAL_READ_MAX_COLS = 512;
export const RUNTIME_TERMINAL_READ_MAX_ROWS = 200;
export const RUNTIME_TERMINAL_SEND_MAX_BYTES = 64 * 1024;
export const RUNTIME_FILES_READ_MAX_BYTES = 1024 * 1024;

export interface RuntimeDescribeResult {
  contractVersion: typeof RUNTIME_CONTRACT_VERSION;
  serverVersion: string;
  hostPlatform: NodeJS.Platform;
  methods: RuntimeMethodDescriptor[];
  capabilities: {
    oneShotCalls: true;
    eventWebSocket: {
      available: true;
      path: "/ws/events";
    };
    terminalWebSocket: {
      available: true;
      pathTemplate: "/ws/terminal/{sessionId}";
      binary: true;
      chunkedReplay: "capability-negotiated";
    };
    terminalRead: {
      boundedSnapshot: true;
      defaultMaxBytes: number;
      maxBytes: number;
      maxCols: number;
      maxRows: number;
    };
    terminalSend: {
      generationRequired: true;
      maxInputBytes: number;
    };
    filesRead: {
      textOnly: true;
      defaultMaxBytes: number;
      maxBytes: number;
    };
  };
}

export interface RuntimeStatusParams {
  projectId?: string;
}

export interface RuntimeStatusResult {
  contractVersion: typeof RUNTIME_CONTRACT_VERSION;
  projects: Project[];
  sessions: Session[];
  agentStates: Record<string, AgentState>;
  worktrees: Record<string, Worktree[]>;
  gitStates: Record<string, Record<string, GitState | null>>;
  ports: Record<string, PortInfo[]>;
  hostPlatform: NodeJS.Platform;
}

export interface TerminalListParams {
  projectId?: string;
}

export interface TerminalListResult {
  sessions: Session[];
}

export interface TerminalCreateParams {
  projectId: string;
  cwd?: string;
  title?: string;
  launchPreset?: SessionLaunchPreset;
  bootstrapInput?: string;
}

export interface TerminalCreateResult {
  session: Session;
}

export interface TerminalReadParams {
  sessionId: string;
  cols?: number;
  rows?: number;
  maxBytes?: number;
}

export interface TerminalReadResult {
  sessionId: string;
  generation: number;
  text: string;
  rawBytes: number;
  replayBytes: number;
  maxBytes: number;
  hasMore: boolean;
  bufferLines?: number;
  emittedLines?: number;
  scrollbackLines?: number;
}

export interface TerminalSendParams {
  sessionId: string;
  data: string;
  generation: number;
}

export interface TerminalSendResult {
  accepted: true;
  sessionId: string;
  generation: number;
}

export interface WorktreeListParams {
  projectId: string;
}

export interface WorktreeListResult {
  worktrees: Worktree[];
}

export interface FilesReadParams {
  projectId: string;
  worktreePath?: string;
  path: string;
}

export interface FilesReadResult {
  projectId: string;
  worktreePath?: string;
  path: string;
  content: string;
  encoding: "utf-8";
  maxBytes: number;
  truncated: false;
}

export interface GitStatusParams {
  projectId: string;
  worktreePath: string;
}

export interface GitStatusResult {
  state: GitState | null;
}

export interface PortsListParams {
  projectId?: string;
}

export interface PortsListResult {
  ports: Record<string, PortInfo[]>;
}

export type RuntimeMethodParams = {
  "runtime.describe": undefined;
  "runtime.status": RuntimeStatusParams;
  "terminal.list": TerminalListParams;
  "terminal.create": TerminalCreateParams;
  "terminal.read": TerminalReadParams;
  "terminal.send": TerminalSendParams;
  "worktree.list": WorktreeListParams;
  "files.read": FilesReadParams;
  "git.status": GitStatusParams;
  "ports.list": PortsListParams;
};

export type RuntimeMethodResult = {
  "runtime.describe": RuntimeDescribeResult;
  "runtime.status": RuntimeStatusResult;
  "terminal.list": TerminalListResult;
  "terminal.create": TerminalCreateResult;
  "terminal.read": TerminalReadResult;
  "terminal.send": TerminalSendResult;
  "worktree.list": WorktreeListResult;
  "files.read": FilesReadResult;
  "git.status": GitStatusResult;
  "ports.list": PortsListResult;
};

export type RuntimeValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function isRuntimeMethodName(
  value: unknown,
): value is RuntimeMethodName {
  return (
    typeof value === "string" &&
    (RUNTIME_METHODS as readonly string[]).includes(value)
  );
}

export function normalizeRuntimeCallRequest(
  value: unknown,
): RuntimeValidationResult<RuntimeCallRequest> {
  if (!isPlainObject(value)) {
    return { ok: false, message: "request must be an object" };
  }
  if (!isRuntimeMethodName(value.method)) {
    return { ok: false, message: "method is unknown" };
  }
  const request: RuntimeCallRequest = { method: value.method };
  if (value.id !== undefined) {
    if (typeof value.id !== "string") {
      return { ok: false, message: "id must be a string" };
    }
    request.id = value.id;
  }
  if (value.params !== undefined) request.params = value.params;
  if (value.client !== undefined) {
    const client = normalizeRuntimeClient(value.client);
    if (!client) return { ok: false, message: "client must be an object" };
    request.client = client;
  }
  return { ok: true, value: request };
}

export function normalizeRuntimeMethodParams<M extends RuntimeMethodName>(
  method: M,
  value: unknown,
): RuntimeValidationResult<RuntimeMethodParams[M]> {
  switch (method) {
    case "runtime.describe":
      return noParams(value) as RuntimeValidationResult<RuntimeMethodParams[M]>;
    case "runtime.status":
      return optionalProjectIdParams(value) as RuntimeValidationResult<
        RuntimeMethodParams[M]
      >;
    case "terminal.list":
      return optionalProjectIdParams(value) as RuntimeValidationResult<
        RuntimeMethodParams[M]
      >;
    case "terminal.create":
      return normalizeTerminalCreateParams(value) as RuntimeValidationResult<
        RuntimeMethodParams[M]
      >;
    case "terminal.read":
      return normalizeTerminalReadParams(value) as RuntimeValidationResult<
        RuntimeMethodParams[M]
      >;
    case "terminal.send":
      return normalizeTerminalSendParams(value) as RuntimeValidationResult<
        RuntimeMethodParams[M]
      >;
    case "worktree.list":
      return requiredProjectIdParams(value) as RuntimeValidationResult<
        RuntimeMethodParams[M]
      >;
    case "files.read":
      return normalizeFilesReadParams(value) as RuntimeValidationResult<
        RuntimeMethodParams[M]
      >;
    case "git.status":
      return normalizeGitStatusParams(value) as RuntimeValidationResult<
        RuntimeMethodParams[M]
      >;
    case "ports.list":
      return optionalProjectIdParams(value) as RuntimeValidationResult<
        RuntimeMethodParams[M]
      >;
  }
}

function noParams(
  value: unknown,
): RuntimeValidationResult<RuntimeMethodParams["runtime.describe"]> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (isPlainObject(value) && Object.keys(value).length === 0) {
    return { ok: true, value: undefined };
  }
  return { ok: false, message: "params must be empty" };
}

function optionalProjectIdParams(
  value: unknown,
): RuntimeValidationResult<RuntimeStatusParams> {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (!isPlainObject(value)) {
    return { ok: false, message: "params must be an object" };
  }
  const params: RuntimeStatusParams = {};
  if (value.projectId !== undefined) {
    const projectId = nonEmptyString(value.projectId);
    if (!projectId) return { ok: false, message: "projectId is required" };
    params.projectId = projectId;
  }
  return { ok: true, value: params };
}

function requiredProjectIdParams(
  value: unknown,
): RuntimeValidationResult<WorktreeListParams> {
  if (!isPlainObject(value)) {
    return { ok: false, message: "params must be an object" };
  }
  const projectId = nonEmptyString(value.projectId);
  if (!projectId) return { ok: false, message: "projectId is required" };
  return { ok: true, value: { projectId } };
}

function normalizeTerminalCreateParams(
  value: unknown,
): RuntimeValidationResult<TerminalCreateParams> {
  if (!isPlainObject(value)) {
    return { ok: false, message: "params must be an object" };
  }
  const projectId = nonEmptyString(value.projectId);
  if (!projectId) return { ok: false, message: "projectId is required" };
  const params: TerminalCreateParams = { projectId };
  const cwd = optionalNonEmptyString(value.cwd);
  if (cwd === false) return { ok: false, message: "cwd must be a string" };
  if (cwd) params.cwd = cwd;
  const title = optionalString(value.title);
  if (title === false) return { ok: false, message: "title must be a string" };
  if (title !== undefined) params.title = title;
  if (value.launchPreset !== undefined) {
    const launchPreset = normalizeSessionLaunchPreset(value.launchPreset);
    if (!launchPreset) {
      return { ok: false, message: "launchPreset is invalid" };
    }
    params.launchPreset = launchPreset;
  }
  if (value.bootstrapInput !== undefined) {
    if (typeof value.bootstrapInput !== "string") {
      return { ok: false, message: "bootstrapInput must be a string" };
    }
    if (
      Buffer.byteLength(value.bootstrapInput, "utf8") >
      RUNTIME_TERMINAL_SEND_MAX_BYTES
    ) {
      return { ok: false, message: "bootstrapInput is too large" };
    }
    params.bootstrapInput = value.bootstrapInput;
  }
  return { ok: true, value: params };
}

function normalizeTerminalReadParams(
  value: unknown,
): RuntimeValidationResult<TerminalReadParams> {
  if (!isPlainObject(value)) {
    return { ok: false, message: "params must be an object" };
  }
  const sessionId = nonEmptyString(value.sessionId);
  if (!sessionId) return { ok: false, message: "sessionId is required" };
  const params: TerminalReadParams = { sessionId };
  const cols = optionalPositiveInteger(value.cols);
  if (cols === false) return { ok: false, message: "cols must be positive" };
  if (cols !== undefined && cols > RUNTIME_TERMINAL_READ_MAX_COLS) {
    return { ok: false, message: "cols is too large" };
  }
  if (cols !== undefined) params.cols = cols;
  const rows = optionalPositiveInteger(value.rows);
  if (rows === false) return { ok: false, message: "rows must be positive" };
  if (rows !== undefined && rows > RUNTIME_TERMINAL_READ_MAX_ROWS) {
    return { ok: false, message: "rows is too large" };
  }
  if (rows !== undefined) params.rows = rows;
  const maxBytes = optionalPositiveInteger(value.maxBytes);
  if (maxBytes === false) {
    return { ok: false, message: "maxBytes must be positive" };
  }
  if (maxBytes !== undefined) {
    params.maxBytes = Math.min(maxBytes, RUNTIME_TERMINAL_READ_MAX_BYTES);
  }
  return { ok: true, value: params };
}

function normalizeTerminalSendParams(
  value: unknown,
): RuntimeValidationResult<TerminalSendParams> {
  if (!isPlainObject(value)) {
    return { ok: false, message: "params must be an object" };
  }
  const sessionId = nonEmptyString(value.sessionId);
  if (!sessionId) return { ok: false, message: "sessionId is required" };
  if (typeof value.data !== "string" || value.data.length === 0) {
    return { ok: false, message: "data is required" };
  }
  if (Buffer.byteLength(value.data, "utf8") > RUNTIME_TERMINAL_SEND_MAX_BYTES) {
    return { ok: false, message: "data is too large" };
  }
  const generation = value.generation;
  if (
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  ) {
    return { ok: false, message: "generation is required" };
  }
  return {
    ok: true,
    value: {
      sessionId,
      data: value.data,
      generation,
    },
  };
}

function normalizeFilesReadParams(
  value: unknown,
): RuntimeValidationResult<FilesReadParams> {
  if (!isPlainObject(value)) {
    return { ok: false, message: "params must be an object" };
  }
  const projectId = nonEmptyString(value.projectId);
  if (!projectId) return { ok: false, message: "projectId is required" };
  const path = nonEmptyString(value.path);
  if (!path) return { ok: false, message: "path is required" };
  const params: FilesReadParams = { projectId, path };
  const worktreePath = optionalNonEmptyString(value.worktreePath);
  if (worktreePath === false) {
    return { ok: false, message: "worktreePath must be a string" };
  }
  if (worktreePath) params.worktreePath = worktreePath;
  return { ok: true, value: params };
}

function normalizeGitStatusParams(
  value: unknown,
): RuntimeValidationResult<GitStatusParams> {
  if (!isPlainObject(value)) {
    return { ok: false, message: "params must be an object" };
  }
  const projectId = nonEmptyString(value.projectId);
  if (!projectId) return { ok: false, message: "projectId is required" };
  const worktreePath = nonEmptyString(value.worktreePath);
  if (!worktreePath) {
    return { ok: false, message: "worktreePath is required" };
  }
  return { ok: true, value: { projectId, worktreePath } };
}

function normalizeRuntimeClient(
  value: unknown,
): RuntimeCallRequest["client"] | null {
  if (!isPlainObject(value)) return null;
  const client: NonNullable<RuntimeCallRequest["client"]> = {};
  for (const key of ["name", "version", "contractVersion"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string") return null;
    client[key] = value[key];
  }
  return client;
}

function optionalPositiveInteger(value: unknown): number | undefined | false {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return false;
  }
  return value;
}

function optionalString(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return false;
  return value;
}

function optionalNonEmptyString(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  return nonEmptyString(value) ?? false;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

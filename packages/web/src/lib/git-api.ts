import type {
  GitLogResponse,
  GitState,
  IdeCommandConfig,
} from "@parasor/shared";
import { authFetch } from "./auth-fetch.js";

export class GitOperationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitOperationError";
  }
}

async function postJson<TBody extends object>(
  url: string,
  body: TBody,
): Promise<void> {
  await requestJson(url, "POST", body);
}

async function requestJson<TBody extends object>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: TBody,
): Promise<void> {
  const res = await authFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GitOperationError(
      data.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
}

export async function fetchGitStatus(
  projectId: string,
  worktreePath: string,
): Promise<GitState | null> {
  const url = `/api/projects/${encodeURIComponent(projectId)}/git/status?worktreePath=${encodeURIComponent(worktreePath)}`;
  const res = await authFetch(url);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GitOperationError(
      data.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  const data = (await res.json()) as { state: GitState | null };
  return data.state;
}

export interface FetchDiffInput {
  projectId: string;
  worktreePath: string;
  /** When set, fetches that commit's diff instead of the working tree. */
  sha?: string;
}

/**
 * GET `/api/projects/:id/diff`. Returns the diff text, or `null` when the
 * server responds non-ok (mirroring the diff/uncommitted panes' `if (res.ok)`
 * /`if (!res.ok) return` guards). The pane keeps owning its `AbortController`,
 * the post-await `aborted` checks, and the loading-state transitions; the
 * `signal` is forwarded here.
 */
export async function fetchDiff(
  input: FetchDiffInput,
  signal?: AbortSignal,
): Promise<string | null> {
  const wt = `worktreePath=${encodeURIComponent(input.worktreePath)}`;
  const base = `/api/projects/${encodeURIComponent(input.projectId)}/diff`;
  const url = input.sha
    ? `${base}?sha=${encodeURIComponent(input.sha)}&${wt}`
    : `${base}?${wt}`;
  const res = await authFetch(url, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { diff: string };
  return data.diff;
}

export interface CommitInput {
  projectId: string;
  worktreePath: string;
  message: string;
  paths: string[];
}

export function commitChanges(input: CommitInput): Promise<void> {
  return postJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/git/commit`,
    {
      worktreePath: input.worktreePath,
      message: input.message,
      paths: input.paths,
    },
  );
}

export interface PushInput {
  projectId: string;
  worktreePath: string;
  setUpstream?: boolean;
}

export function pushBranch(input: PushInput): Promise<void> {
  return postJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/git/push`,
    {
      worktreePath: input.worktreePath,
      ...(input.setUpstream === true && { setUpstream: true }),
    },
  );
}

export interface PullInput {
  projectId: string;
  worktreePath: string;
  rebase?: boolean;
}

export function pullBranch(input: PullInput): Promise<void> {
  return postJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/git/pull`,
    {
      worktreePath: input.worktreePath,
      ...(input.rebase === true && { rebase: true }),
    },
  );
}

export interface FetchInput {
  projectId: string;
  worktreePath: string;
}

export function fetchRemote(input: FetchInput): Promise<void> {
  return postJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/git/fetch`,
    { worktreePath: input.worktreePath },
  );
}

export interface SwitchBranchInput {
  projectId: string;
  worktreePath: string;
  branch: string;
}

export function switchBranch(input: SwitchBranchInput): Promise<void> {
  return postJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/git/switch`,
    {
      worktreePath: input.worktreePath,
      branch: input.branch,
    },
  );
}

export interface CreateBranchInput {
  projectId: string;
  worktreePath: string;
  branch: string;
  startPoint: string;
}

export function createBranch(input: CreateBranchInput): Promise<void> {
  return postJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/git/branch`,
    {
      worktreePath: input.worktreePath,
      branch: input.branch,
      startPoint: input.startPoint,
    },
  );
}

export interface FetchGitLogInput {
  projectId: string;
  worktreePath: string;
  limit?: number;
  skip?: number;
  includeRemotes?: boolean;
  signal?: AbortSignal;
}

export async function fetchGitLog(
  input: FetchGitLogInput,
): Promise<GitLogResponse> {
  const params = new URLSearchParams({ worktreePath: input.worktreePath });
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.skip !== undefined && input.skip > 0)
    params.set("skip", String(input.skip));
  if (input.includeRemotes) params.set("includeRemotes", "1");
  const url = `/api/projects/${encodeURIComponent(input.projectId)}/git/log?${params.toString()}`;
  const res = await authFetch(url, { signal: input.signal });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GitOperationError(
      data.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return (await res.json()) as GitLogResponse;
}

export function initRepository(projectId: string): Promise<void> {
  return postJson(
    `/api/projects/${encodeURIComponent(projectId)}/git/init`,
    {},
  );
}

export interface OpenWorktreeInOsInput {
  projectId: string;
  worktreePath: string;
}

export function openWorktreeInOs(input: OpenWorktreeInOsInput): Promise<void> {
  return postJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/worktrees/open-os`,
    { worktreePath: input.worktreePath },
  );
}

export const supportedIdeEditors = ["cursor", "vscode"] as const;

export type IdeEditor = string;

export interface OpenWorktreeInIdeInput {
  projectId: string;
  worktreePath: string;
  editor: IdeEditor;
}

export async function fetchLocalIdeCapability(): Promise<{
  canOpenLocalIde: boolean;
}> {
  const res = await authFetch("/api/projects/local-ide-capability");
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GitOperationError(
      data.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  const data = (await res.json()) as { canOpenLocalIde?: unknown };
  return { canOpenLocalIde: data.canOpenLocalIde === true };
}

export function openWorktreeInIde(
  input: OpenWorktreeInIdeInput,
): Promise<void> {
  return postJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/worktrees/open-ide`,
    { worktreePath: input.worktreePath, editor: input.editor },
  );
}

export async function fetchIdeCommands(): Promise<IdeCommandConfig[]> {
  const res = await authFetch("/api/ide-commands");
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GitOperationError(
      data.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  const data = (await res.json()) as { commands?: unknown };
  return Array.isArray(data.commands)
    ? (data.commands as IdeCommandConfig[])
    : [];
}

export async function updateIdeCommands(
  commands: IdeCommandConfig[],
): Promise<IdeCommandConfig[]> {
  const res = await authFetch("/api/ide-commands", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GitOperationError(
      data.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  const data = (await res.json()) as { commands?: unknown };
  return Array.isArray(data.commands)
    ? (data.commands as IdeCommandConfig[])
    : [];
}

export interface RenameWorktreeInput {
  projectId: string;
  worktreePath: string;
  newBranch: string;
}

export function renameWorktree(input: RenameWorktreeInput): Promise<void> {
  return requestJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/worktrees`,
    "PATCH",
    { worktreePath: input.worktreePath, newBranch: input.newBranch },
  );
}

export interface RemoveWorktreeInput {
  projectId: string;
  worktreePath: string;
  force?: boolean;
}

export function removeWorktree(input: RemoveWorktreeInput): Promise<void> {
  return requestJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/worktrees`,
    "DELETE",
    {
      worktreePath: input.worktreePath,
      ...(input.force === true && { force: true }),
    },
  );
}

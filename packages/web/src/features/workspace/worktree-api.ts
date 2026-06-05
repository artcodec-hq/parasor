import type {
  WorktreeLocalFileCandidate,
  WorktreeLocalFileCopyResult,
} from "@parasor/shared";
import { authFetch } from "../../lib/auth-fetch.js";

export interface CreateWorktreeInput {
  branch: string;
  base: string;
  copyLocalFiles: string[];
  rememberLocalFiles: boolean;
}

export interface CreateWorktreeResult {
  path: string;
  localFileCopies?: WorktreeLocalFileCopyResult[];
}

export async function createWorktree(
  projectId: string,
  input: CreateWorktreeInput,
): Promise<CreateWorktreeResult> {
  const res = await authFetch(`/api/projects/${projectId}/worktrees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      branch: input.branch,
      ...(input.base.length > 0 && { base: input.base }),
      ...(input.copyLocalFiles.length > 0 && {
        copyLocalFiles: input.copyLocalFiles,
      }),
      ...(input.rememberLocalFiles && { rememberLocalFiles: true }),
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  const data = (await res.json().catch(() => ({}))) as {
    path?: string;
    localFileCopies?: WorktreeLocalFileCopyResult[];
  };
  const worktreePath = data.path;
  if (!worktreePath) throw new Error("Worktree response missing path");
  return { path: worktreePath, localFileCopies: data.localFileCopies };
}

export interface WorktreeLocalFiles {
  candidates: WorktreeLocalFileCandidate[];
  rememberedPaths: string[];
}

export async function loadWorktreeLocalFiles(
  projectId: string,
): Promise<WorktreeLocalFiles> {
  const res = await authFetch(
    `/api/projects/${encodeURIComponent(projectId)}/worktree-local-files`,
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as WorktreeLocalFiles;
}

/**
 * Fire-and-forget GET that triggers a server-side worktree reconciliation;
 * the response body is consumed by the WS broadcast, not the caller. Forwards
 * the {@link AbortSignal} so App.tsx's effect cleanup can abort in flight.
 */
export function refreshWorktrees(
  projectId: string,
  signal: AbortSignal,
): Promise<Response> {
  return authFetch(`/api/projects/${projectId}/worktrees`, { signal });
}

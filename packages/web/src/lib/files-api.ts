import { authFetch } from "./auth-fetch.js";

/**
 * Client-data transport for the `/api/files/*` endpoints. Each function is a
 * thin wrapper over {@link authFetch}: it builds the exact URL/body the pane
 * components used to construct inline and forwards an optional `AbortSignal`
 * for the read paths. Visual state, retry/backoff, error/empty branches, and
 * `AbortController` lifecycle stay in the pane components -- only transport
 * lives here.
 */

export interface FileReadInput {
  projectId: string;
  path: string;
  worktreePath?: string;
}

function fileScopedQuery(input: FileReadInput): string {
  return (
    `?projectId=${encodeURIComponent(input.projectId)}` +
    `&path=${encodeURIComponent(input.path)}` +
    (input.worktreePath
      ? `&worktreePath=${encodeURIComponent(input.worktreePath)}`
      : "")
  );
}

/**
 * GET `/api/files/read`. Returns the raw {@link Response} so the editor pane
 * keeps its proxy-blip retry loop and ok/!ok/text handling unchanged.
 */
export function readFile(
  input: FileReadInput,
  signal?: AbortSignal,
): Promise<Response> {
  return authFetch(`/api/files/read${fileScopedQuery(input)}`, { signal });
}

export interface FileWriteInput {
  projectId: string;
  path: string;
  content: string;
  worktreePath?: string;
}

/**
 * POST `/api/files/write`. Returns the raw {@link Response}; the editor pane
 * owns the save/error state transitions and reads the body on failure.
 */
export function writeFile(input: FileWriteInput): Promise<Response> {
  return authFetch("/api/files/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      path: input.path,
      content: input.content,
      ...(input.worktreePath ? { worktreePath: input.worktreePath } : {}),
    }),
  });
}

export interface MakeDirectoryInput {
  projectId: string;
  path: string;
  worktreePath?: string;
}

/**
 * POST `/api/files/mkdir`. Mirrors the file-tree pane's create-folder request
 * (lowercase `content-type` header). Returns the raw {@link Response}.
 */
export function makeDirectory(input: MakeDirectoryInput): Promise<Response> {
  const body: Record<string, string> = {
    projectId: input.projectId,
    path: input.path,
  };
  if (input.worktreePath) body.worktreePath = input.worktreePath;
  return authFetch("/api/files/mkdir", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface CopyFileInput {
  projectId: string;
  srcPath: string;
  destPath: string;
  worktreePath?: string;
}

/**
 * POST `/api/files/copy`. Mirrors the file-tree duplicate request (lowercase
 * `content-type` header). Returns the raw {@link Response}; the pane reads the
 * body text on failure for the alert.
 */
export function copyFile(input: CopyFileInput): Promise<Response> {
  const body: Record<string, string> = {
    projectId: input.projectId,
    srcPath: input.srcPath,
    destPath: input.destPath,
  };
  if (input.worktreePath) body.worktreePath = input.worktreePath;
  return authFetch("/api/files/copy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface FileListEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  isGitignored?: boolean;
  isHidden?: boolean;
}

export interface ListDirInput {
  projectId: string;
  path: string;
  worktreePath?: string;
}

/**
 * GET `/api/files/list`. Returns the parsed entries, or `null` when the server
 * responds non-ok (mirroring the file-tree pane's `if (!res.ok) return`/`return
 * null` skip). Network/parse errors propagate so the pane's `try/catch` keeps
 * swallowing them.
 */
export async function listDir(
  input: ListDirInput,
): Promise<FileListEntry[] | null> {
  const res = await authFetch(`/api/files/list${fileScopedQuery(input)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { entries: FileListEntry[] };
  return data.entries;
}

export interface StatFileInput {
  projectId: string;
  path: string;
  worktreePath?: string;
}

/**
 * GET `/api/files/stat`. Returns the raw {@link Response}; the media pane owns
 * the size-gate/error state transitions and parses the JSON body itself. URL
 * built via `URLSearchParams` to match the media pane's prior construction.
 */
export function statFile(
  input: StatFileInput,
  signal?: AbortSignal,
): Promise<Response> {
  const params = new URLSearchParams({
    projectId: input.projectId,
    path: input.path,
  });
  if (input.worktreePath) params.set("worktreePath", input.worktreePath);
  return authFetch(`/api/files/stat?${params.toString()}`, { signal });
}

export function statTemporaryFile(
  path: string,
  signal?: AbortSignal,
): Promise<Response> {
  const params = new URLSearchParams({ path });
  return authFetch(`/api/files/temp-stat?${params.toString()}`, { signal });
}

export function temporaryFileRawUrl(path: string, cacheBuster = 0): string {
  const params = new URLSearchParams({ path });
  if (cacheBuster) params.set("v", String(cacheBuster));
  return `/api/files/temp-raw?${params.toString()}`;
}

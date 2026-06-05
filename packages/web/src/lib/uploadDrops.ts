import type { DropErrorResponse, DropResponse } from "@parasor/shared";
import { authFetch } from "./auth-fetch.js";

export class UploadAbortedError extends Error {
  constructor() {
    super("upload aborted");
    this.name = "UploadAbortedError";
  }
}

export class UploadTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super("upload exceeds size limit");
    this.name = "UploadTooLargeError";
    this.limit = limit;
  }
}

export class UploadInvalidFilenameError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`invalid filename: ${reason}`);
    this.name = "UploadInvalidFilenameError";
    this.reason = reason;
  }
}

export class UploadIoError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "UploadIoError";
  }
}

export interface UploadDropsOptions {
  projectId: string;
  /**
   * PTY session that will receive the dropped paths. The server scopes the
   * staging dir per session (upload staging isolation) so cleanup can fire on session
   * exit; sessionId is required and rejected with HTTP 400 if missing.
   */
  sessionId: string;
  files: readonly File[];
  signal?: AbortSignal;
  /**
   * Fires once when the upload has not resolved within `slowMs` (default 300).
   * The Terminal pane uses it to surface the "uploading..." pill only when the
   * user would otherwise see nothing happen. Pattern cribbed from LibreChat.
   */
  onSlow?: () => void;
  slowMs?: number;
}

/**
 * Post a multipart batch to `/api/projects/:id/drops` and return the
 * server-written absolute paths. Throws one of the typed errors above so the
 * caller can surface the right UX (retry vs. no-op vs. block with a message).
 */
export async function uploadDrops(opts: UploadDropsOptions): Promise<string[]> {
  const { projectId, sessionId, files, signal, onSlow, slowMs = 300 } = opts;
  if (files.length === 0) return [];

  const form = new FormData();
  for (const file of files) {
    form.append("files", file, file.name);
  }

  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  if (onSlow) {
    slowTimer = setTimeout(() => {
      onSlow();
    }, slowMs);
  }

  let res: Response;
  try {
    const init: RequestInit = { method: "POST", body: form };
    if (signal) init.signal = signal;
    res = await authFetch(
      `/api/projects/${encodeURIComponent(projectId)}/drops?sessionId=${encodeURIComponent(sessionId)}`,
      init,
    );
  } catch (err) {
    if (slowTimer !== null) clearTimeout(slowTimer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new UploadAbortedError();
    }
    throw err;
  } finally {
    if (slowTimer !== null) clearTimeout(slowTimer);
  }

  if (res.ok) {
    const body = (await res.json()) as DropResponse;
    return body.paths;
  }

  const body = (await res
    .json()
    .catch(
      () => ({}) as Partial<DropErrorResponse>,
    )) as Partial<DropErrorResponse>;

  if (body && "error" in body) {
    if (body.error === "too-large") {
      throw new UploadTooLargeError(
        typeof body.limit === "number" ? body.limit : 0,
      );
    }
    if (body.error === "invalid-filename") {
      throw new UploadInvalidFilenameError(body.reason ?? "unknown");
    }
    if (body.error === "io-error") {
      throw new UploadIoError("io error");
    }
  }
  throw new UploadIoError(`upload failed: HTTP ${res.status}`);
}

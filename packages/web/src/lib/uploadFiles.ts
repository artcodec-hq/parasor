import type {
  FileUploadDisposition,
  FileUploadErrorResponse,
  FileUploadRejectReason,
  FileUploadResponse,
  FileUploadResultEntry,
} from "@parasor/shared";
import { authFetch } from "./auth-fetch.js";

export class FileUploadAbortedError extends Error {
  constructor() {
    super("upload aborted");
    this.name = "FileUploadAbortedError";
  }
}

export class FileUploadTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super("upload exceeds size limit");
    this.name = "FileUploadTooLargeError";
    this.limit = limit;
  }
}

export class FileUploadInvalidFilenameError extends Error {
  readonly reason: FileUploadRejectReason;
  constructor(reason: FileUploadRejectReason) {
    super(`invalid filename: ${reason}`);
    this.name = "FileUploadInvalidFilenameError";
    this.reason = reason;
  }
}

export class FileUploadInvalidTargetError extends Error {
  readonly reason: "path-traversal" | "not-a-dir" | "missing";
  constructor(reason: "path-traversal" | "not-a-dir" | "missing") {
    super(`invalid target: ${reason}`);
    this.name = "FileUploadInvalidTargetError";
    this.reason = reason;
  }
}

export class FileUploadReadOnlyError extends Error {
  constructor() {
    super("project is read-only");
    this.name = "FileUploadReadOnlyError";
  }
}

export class FileUploadIoError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "FileUploadIoError";
  }
}

/**
 * Conflict signal: thrown by the first upload pass when one or more files
 * already exist at the target. The caller surfaces the Replace/Keep
 * both/Skip modal and retries with an explicit `disposition`.
 */
export class FileUploadConflictError extends Error {
  readonly conflicts: string[];
  constructor(conflicts: string[]) {
    super(`conflict: ${conflicts.join(", ")}`);
    this.name = "FileUploadConflictError";
    this.conflicts = [...conflicts];
  }
}

export interface UploadFilesOptions {
  projectId: string;
  /** Project-relative target subdirectory. Empty = project root. */
  targetPath: string;
  files: readonly File[];
  /** Conflict policy. Omit on the first call to detect conflicts. */
  disposition?: FileUploadDisposition;
  signal?: AbortSignal;
  onSlow?: () => void;
  slowMs?: number;
}

/**
 * `POST /api/projects/:id/files/upload` wrapper.
 *
 * Two-phase flow:
 * 1. Call without `disposition` (defaults to "skip" server-side). If any
 *    file collides this throws `FileUploadConflictError`.
 * 2. Show the conflict modal. Re-call with the user's choice.
 */
export async function uploadFiles(
  opts: UploadFilesOptions,
): Promise<FileUploadResultEntry[]> {
  const {
    projectId,
    targetPath,
    files,
    disposition,
    signal,
    onSlow,
    slowMs = 300,
  } = opts;
  if (files.length === 0) return [];

  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);

  const params = new URLSearchParams();
  if (targetPath) params.set("path", targetPath);
  if (disposition) params.set("disposition", disposition);
  const qs = params.toString();
  const url =
    `/api/projects/${encodeURIComponent(projectId)}/files/upload` +
    (qs ? `?${qs}` : "");

  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  if (onSlow) slowTimer = setTimeout(onSlow, slowMs);

  let res: Response;
  try {
    const init: RequestInit = { method: "POST", body: form };
    if (signal) init.signal = signal;
    res = await authFetch(url, init);
  } catch (err) {
    if (slowTimer !== null) clearTimeout(slowTimer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new FileUploadAbortedError();
    }
    throw err;
  } finally {
    if (slowTimer !== null) clearTimeout(slowTimer);
  }

  if (res.ok) {
    const body = (await res.json()) as FileUploadResponse;
    return body.files;
  }

  const body = (await res
    .json()
    .catch(
      () => ({}) as Partial<FileUploadErrorResponse>,
    )) as Partial<FileUploadErrorResponse>;

  if (body && "error" in body) {
    if (body.error === "conflict") {
      throw new FileUploadConflictError(
        Array.isArray(body.conflicts) ? body.conflicts : [],
      );
    }
    if (body.error === "too-large") {
      throw new FileUploadTooLargeError(
        typeof body.limit === "number" ? body.limit : 0,
      );
    }
    if (body.error === "invalid-filename") {
      throw new FileUploadInvalidFilenameError(
        (body.reason as FileUploadRejectReason | undefined) ?? "control-char",
      );
    }
    if (body.error === "invalid-target") {
      throw new FileUploadInvalidTargetError(
        (body.reason as
          | "path-traversal"
          | "not-a-dir"
          | "missing"
          | undefined) ?? "missing",
      );
    }
    if (body.error === "read-only") {
      throw new FileUploadReadOnlyError();
    }
    if (body.error === "io-error") {
      throw new FileUploadIoError("io error");
    }
  }
  throw new FileUploadIoError(`upload failed: HTTP ${res.status}`);
}

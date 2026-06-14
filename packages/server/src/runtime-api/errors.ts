import type { RuntimeErrorCode } from "@parasor/shared";
import {
  FileAccessError,
  FileNotFoundError,
  FileReadError,
  FilesystemUnavailableError,
  FileTooLargeError,
} from "../application/files/errors.js";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
} from "../application/workspace/errors.js";

export class RuntimeApiError extends Error {
  readonly code: RuntimeErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryable?: boolean;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "RuntimeApiError";
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable;
  }
}

export function mapRuntimeApiError(error: unknown): RuntimeApiError {
  if (error instanceof RuntimeApiError) return error;
  if (error instanceof WorkspaceNotFoundError) {
    return new RuntimeApiError(
      error.kind === "worktree" ? "worktree_not_found" : "project_not_found",
      error.message ||
        (error.kind === "worktree"
          ? "Worktree not found"
          : "Project not found"),
    );
  }
  if (error instanceof WorkspaceConflictError) {
    return new RuntimeApiError("conflict", error.message);
  }
  if (error instanceof FileAccessError) {
    return new RuntimeApiError("forbidden", error.message);
  }
  if (error instanceof FileNotFoundError) {
    return new RuntimeApiError("file_not_found", error.message);
  }
  if (error instanceof FileTooLargeError) {
    return new RuntimeApiError("output_truncated", error.message);
  }
  if (error instanceof FilesystemUnavailableError) {
    return new RuntimeApiError("worktree_not_found", error.message);
  }
  if (error instanceof FileReadError) {
    return new RuntimeApiError("internal_error", error.message);
  }
  return new RuntimeApiError(
    "internal_error",
    error instanceof Error ? error.message : "Runtime call failed",
  );
}

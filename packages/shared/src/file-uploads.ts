/**
 * File-tree upload protocol (file-tree upload).
 *
 * Distinct from `/drops` (terminal pane) which lands files under
 * `.parasor/drops/<timestamp>_<name>` for shell paste. This endpoint
 * writes directly into the user's project tree at a target subdirectory.
 *
 * Conflict semantics are decided per request via `disposition`. The
 * client surfaces a "Replace / Keep both / Skip" modal once per batch
 * and applies the chosen mode to every file in the request.
 */

export type FileUploadDisposition = "replace" | "keep-both" | "skip";

export interface FileUploadResultEntry {
  /** Filename as supplied by the client. */
  originalName: string;
  /** What ended up happening on disk. */
  status: "written" | "renamed" | "skipped";
  /** Final basename written (only when `status !== "skipped"`). */
  finalName?: string;
  /** Server-resolved absolute path (only when `status !== "skipped"`). */
  finalPath?: string;
}

export interface FileUploadResponse {
  files: FileUploadResultEntry[];
}

export type FileUploadRejectReason =
  | "path-traversal"
  | "control-char"
  | "too-long"
  | "empty"
  | "reserved";

export interface FileUploadErrorTooLarge {
  error: "too-large";
  limit: number;
}

export interface FileUploadErrorInvalidFilename {
  error: "invalid-filename";
  reason: FileUploadRejectReason;
}

export interface FileUploadErrorInvalidTarget {
  error: "invalid-target";
  /**
   * `path-traversal` -- `targetDir` resolves outside the project root.
   * `not-a-dir`     -- `targetDir` exists but is a file (or symlink to one).
   * `missing`       -- `targetDir` does not exist on disk.
   */
  reason: "path-traversal" | "not-a-dir" | "missing";
}

export interface FileUploadErrorReadOnly {
  error: "read-only";
}

export interface FileUploadErrorIo {
  error: "io-error";
}

export interface FileUploadErrorConflict {
  error: "conflict";
  /** Existing filenames that prevented the write under `disposition: "skip"`. */
  conflicts: string[];
}

export type FileUploadErrorResponse =
  | FileUploadErrorTooLarge
  | FileUploadErrorInvalidFilename
  | FileUploadErrorInvalidTarget
  | FileUploadErrorReadOnly
  | FileUploadErrorIo
  | FileUploadErrorConflict;

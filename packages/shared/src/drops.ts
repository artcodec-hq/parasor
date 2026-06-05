/**
 * Success payload returned by `POST /api/projects/:id/drops?sessionId=...`.
 * Absolute paths are server-resolved under the per-session staging dir
 * (`<PARASOR_UPLOAD_DIR>/<sessionId>-<ms>/`), which lives outside the
 * project tree (upload staging isolation). The 3-layer GC owns lifetime: L1 on PTY
 * exit, L2 at server boot, L3 every 60 minutes.
 */
export interface DropResponse {
  paths: string[];
}

export type DropRejectReason =
  | "path-traversal"
  | "control-char"
  | "too-long"
  | "empty"
  | "reserved";

export interface DropErrorTooLarge {
  error: "too-large";
  limit: number;
}

export interface DropErrorInvalidFilename {
  error: "invalid-filename";
  reason: DropRejectReason;
}

export interface DropErrorIo {
  error: "io-error";
}

export type DropErrorResponse =
  | DropErrorTooLarge
  | DropErrorInvalidFilename
  | DropErrorIo;

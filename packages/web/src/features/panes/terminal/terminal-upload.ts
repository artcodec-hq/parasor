import {
  UploadAbortedError,
  UploadInvalidFilenameError,
  UploadIoError,
  UploadTooLargeError,
} from "../../../lib/uploadDrops.js";

export type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "slow" }
  | { status: "error"; message: string };

/** Hover label shown over the drop overlay while an upload is in flight. */
export function classifyHoverLabel(state: UploadState): string | null {
  if (state.status === "uploading" || state.status === "slow") {
    return "Uploading files...";
  }
  return null;
}

/**
 * Maps an upload rejection to a user-facing message. Returns `null` for the
 * abort case so the caller resets to idle without surfacing an error.
 */
export function uploadErrorMessage(err: unknown): string | null {
  if (err instanceof UploadAbortedError) return null;
  if (err instanceof UploadTooLargeError) {
    const mb = Math.max(1, Math.round(err.limit / (1024 * 1024)));
    return `File too large (limit ${mb} MB)`;
  }
  if (err instanceof UploadInvalidFilenameError) {
    return `Rejected filename: ${err.reason}`;
  }
  if (err instanceof UploadIoError) return err.message;
  if (err instanceof Error) return err.message;
  return "Upload failed";
}

/**
 * Drops empty and control-char-bearing paths before they are shell-escaped into
 * PTY input. The `\r\n\0` strip is the upload path-injection guard: it prevents
 * a crafted upload response from injecting extra terminal input lines.
 */
export function cleanUploadedPaths(paths: readonly string[]): string[] {
  return paths.filter((p) => p.length > 0 && !/[\r\n\0]/.test(p));
}

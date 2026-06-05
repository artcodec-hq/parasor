import type { WorktreeLocalFileCopyResult } from "@parasor/shared";

/**
 * Render a one-line toast summary of a worktree local-file copy run, e.g.
 * "Copied 2, skipped 1 local files". Returns null when there is nothing to
 * report (undefined or empty results). Only non-zero buckets are listed.
 */
export function summarizeLocalFileCopies(
  results: WorktreeLocalFileCopyResult[] | undefined,
): string | null {
  if (!results || results.length === 0) return null;
  const copied = results.filter((item) => item.status === "copied").length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  const failed = results.filter((item) => item.status === "failed").length;
  const parts: string[] = [];
  if (copied > 0) parts.push(`Copied ${copied}`);
  if (skipped > 0) parts.push(`skipped ${skipped}`);
  if (failed > 0) parts.push(`failed ${failed}`);
  return `${parts.join(", ")} local ${results.length === 1 ? "file" : "files"}`;
}

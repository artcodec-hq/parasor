export interface WorktreeLocalFileCandidate {
  path: string;
  size: number;
}

export type WorktreeLocalFileCopyStatus = "copied" | "skipped" | "failed";

export interface WorktreeLocalFileCopyResult {
  path: string;
  status: WorktreeLocalFileCopyStatus;
  reason?: string;
  size?: number;
}

const MAX_ALLOWLIST_ITEMS = 100;
const MAX_LOCAL_FILE_PATH_LENGTH = 500;

export function normalizeWorktreeLocalFileAllowlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = normalizeWorktreeLocalFilePath(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_ALLOWLIST_ITEMS) break;
  }
  return out;
}

export function normalizeWorktreeLocalFilePath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (
    !trimmed ||
    trimmed.length > MAX_LOCAL_FILE_PATH_LENGTH ||
    trimmed.startsWith("/") ||
    trimmed.includes("\0")
  ) {
    return null;
  }

  const parts: string[] = [];
  for (const part of trimmed.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  if (parts.length === 0) return null;
  return parts.join("/");
}

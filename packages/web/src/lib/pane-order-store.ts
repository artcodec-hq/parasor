/**
 * Per-project pane ordering is persisted in localStorage as
 * `paneOrder:<projectId> = JSON({ [worktreePath]: childId[] })`. The
 * stored value is user-mutable (and survives across versions), so any
 * reader must defensively validate the shape before trusting it -- a
 * `null` literal or a malformed nested value would otherwise crash the
 * sidebar reducer mid-render.
 *
 * Also caps the raw length before `JSON.parse` so a corrupted entry
 * (or a future bug that writes unbounded data) can't permanently brick
 * the app: the sidebar reads this on every render, and an oversized
 * payload would synchronously freeze App render with no in-app
 * recovery path.
 */
export type PaneOrderStore = Record<string, string[]>;

const MAX_RAW_LENGTH = 64 * 1024;

export function parsePaneOrderStore(raw: string | null): PaneOrderStore {
  if (!raw) return {};
  if (raw.length > MAX_RAW_LENGTH) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isPlainObject(parsed)) return {};
  const out: PaneOrderStore = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof key !== "string") continue;
    if (!Array.isArray(value)) continue;
    if (!value.every((v) => typeof v === "string")) continue;
    out[key] = value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

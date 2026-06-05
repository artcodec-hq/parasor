/**
 * Browser panes are not yet wired through the server-authoritative pane
 * model. Until that lands, browser children live entirely client-side in
 * localStorage at `parasor:client-browsers:<projectId>` keyed by worktree
 * path:
 *
 *   { [worktreePath]: { id: string; url: string }[] }
 *
 * The reader defensively validates the shape on every load -- the value
 * is user-mutable and survives across versions, and a malformed entry
 * would otherwise blow up the workspace pane model on render. Length is
 * capped before `JSON.parse` for the same reason as `pane-order-store`.
 */
export interface ClientBrowserPaneRecord {
  id: string;
  url: string;
}

export type ClientBrowserStore = Record<string, ClientBrowserPaneRecord[]>;

const MAX_RAW_LENGTH = 64 * 1024;

export function clientBrowserStorageKey(projectId: string): string {
  return `parasor:client-browsers:${projectId}`;
}

// Scheme allowlist for the iframe `src`. `localStorage` is attacker-mutable,
// and `BrowserPane`'s sandbox includes `allow-scripts allow-same-origin` --
// so a tampered `javascript:` / `data:` / `vbscript:` URL would otherwise
// execute in the parent origin on reload. Only http(s) and `about:blank`
// (the harmless reset target used when navigation is cleared) are accepted.
export function isSafeBrowserUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (trimmed === "about:blank") return true;
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

export function parseClientBrowserStore(
  raw: string | null,
): ClientBrowserStore {
  if (!raw) return {};
  if (raw.length > MAX_RAW_LENGTH) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isPlainObject(parsed)) return {};
  const out: ClientBrowserStore = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof key !== "string") continue;
    if (!Array.isArray(value)) continue;
    const entries: ClientBrowserPaneRecord[] = [];
    for (const item of value) {
      if (!isPlainObject(item)) continue;
      const id = item.id;
      const url = item.url;
      if (typeof id !== "string" || typeof url !== "string") continue;
      if (!isSafeBrowserUrl(url)) continue;
      entries.push({ id, url });
    }
    out[key] = entries;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import {
  clientBrowserStorageKey,
  parseClientBrowserStore,
} from "../../../lib/client-browser-store.js";

/**
 * Read the client-side browser child panes persisted per project in
 * localStorage (`parasor:client-browsers:<projectId>`, keyed by worktree
 * path) and project them into the `inactiveChildPanesByProject` shape the
 * sidebar builder consumes, so inactive projects keep their browser children.
 * Defensive against absent storage / malformed entries (delegated to the
 * store parser).
 */
export function readClientBrowserChildPanes(
  projects: Array<{ id: string }>,
): Record<
  string,
  Record<string, Array<{ id: string; kind: "browser"; url: string }>>
> {
  if (typeof window === "undefined") return {};
  const out: Record<
    string,
    Record<string, Array<{ id: string; kind: "browser"; url: string }>>
  > = {};
  for (const project of projects) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(clientBrowserStorageKey(project.id));
    } catch {
      raw = null;
    }
    const store = parseClientBrowserStore(raw);
    const panesByPath: Record<
      string,
      Array<{ id: string; kind: "browser"; url: string }>
    > = {};
    for (const [path, panes] of Object.entries(store)) {
      panesByPath[path] = panes.map((pane) => ({
        id: pane.id,
        kind: "browser",
        url: pane.url,
      }));
    }
    out[project.id] = panesByPath;
  }
  return out;
}

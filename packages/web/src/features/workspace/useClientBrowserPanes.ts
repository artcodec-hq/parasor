import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ClientBrowserPaneRecord,
  type ClientBrowserStore,
  clientBrowserStorageKey,
  isSafeBrowserUrl,
  parseClientBrowserStore,
} from "../../lib/client-browser-store.js";

/**
 * Client-side browser pane registry. Persists per-project under
 * `parasor:client-browsers:<projectId>` so panes survive reload but stay
 * scoped to the project they were opened in. Shaped to match the future
 * server `panes-updated` broadcast so call sites are stable when it
 * lands.
 */

interface UseClientBrowserPanesResult {
  panesByWorktree: Record<string, ClientBrowserPaneRecord[]>;
  addBrowser: (worktreePath: string, url: string) => string | null;
  closeBrowser: (paneId: string) => void;
  updateBrowserUrl: (paneId: string, url: string) => void;
}

function readStore(projectId: string): ClientBrowserStore {
  try {
    return parseClientBrowserStore(
      window.localStorage.getItem(clientBrowserStorageKey(projectId)),
    );
  } catch {
    return {};
  }
}

function writeStore(projectId: string, store: ClientBrowserStore) {
  try {
    window.localStorage.setItem(
      clientBrowserStorageKey(projectId),
      JSON.stringify(store),
    );
  } catch {
    // localStorage quota / disabled: client browsers are best-effort,
    // the in-memory state still drives the current session.
  }
}

function makePaneId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `browser:${crypto.randomUUID()}`;
  }
  return `browser:${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

export function useClientBrowserPanes(
  projectId: string | null,
): UseClientBrowserPanesResult {
  const [store, setStore] = useState<ClientBrowserStore>(() =>
    projectId ? readStore(projectId) : {},
  );

  // Track the last hydrated projectId so swapping to a new project
  // re-reads localStorage instead of carrying the previous project's
  // panes into the new project's pane model.
  const lastProjectRef = useRef<string | null>(projectId);
  useEffect(() => {
    if (lastProjectRef.current === projectId) return;
    lastProjectRef.current = projectId;
    setStore(projectId ? readStore(projectId) : {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    writeStore(projectId, store);
  }, [projectId, store]);

  const addBrowser = useCallback(
    (worktreePath: string, url: string): string | null => {
      if (!projectId) return null;
      if (!isSafeBrowserUrl(url)) return null;
      const id = makePaneId();
      setStore((prev) => {
        const list = prev[worktreePath] ?? [];
        return { ...prev, [worktreePath]: [...list, { id, url }] };
      });
      return id;
    },
    [projectId],
  );

  const closeBrowser = useCallback((paneId: string) => {
    setStore((prev) => {
      const next: ClientBrowserStore = {};
      let changed = false;
      for (const [path, list] of Object.entries(prev)) {
        const filtered = list.filter((entry) => entry.id !== paneId);
        if (filtered.length !== list.length) changed = true;
        if (filtered.length > 0) next[path] = filtered;
      }
      return changed ? next : prev;
    });
  }, []);

  const updateBrowserUrl = useCallback((paneId: string, url: string) => {
    if (!isSafeBrowserUrl(url)) return;
    setStore((prev) => {
      let changed = false;
      const next: ClientBrowserStore = {};
      for (const [path, list] of Object.entries(prev)) {
        const updated = list.map((entry) => {
          if (entry.id !== paneId) return entry;
          if (entry.url === url) return entry;
          changed = true;
          return { ...entry, url };
        });
        next[path] = updated;
      }
      return changed ? next : prev;
    });
  }, []);

  const panesByWorktree = useMemo(() => store, [store]);

  return { panesByWorktree, addBrowser, closeBrowser, updateBrowserUrl };
}

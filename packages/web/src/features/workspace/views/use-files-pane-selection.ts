import { useCallback, useSyncExternalStore } from "react";

/**
 * Per-paneId selected file, persisted to localStorage. Backed by a
 * module-level Map + listener set so multiple components observe the
 * same selection without re-reading localStorage.
 */

const STORAGE_PREFIX = "parasor:files-pane-selection:";

const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();

function loadFromStorage(paneId: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${paneId}`);
  } catch {
    return null;
  }
}

function getSnapshot(paneId: string): string | null {
  if (!cache.has(paneId)) {
    cache.set(paneId, loadFromStorage(paneId));
  }
  return cache.get(paneId) ?? null;
}

function setSnapshot(paneId: string, filePath: string | null): void {
  cache.set(paneId, filePath);
  try {
    if (filePath === null) {
      localStorage.removeItem(`${STORAGE_PREFIX}${paneId}`);
    } else {
      localStorage.setItem(`${STORAGE_PREFIX}${paneId}`, filePath);
    }
  } catch {
    /* quota / disabled -- non-fatal */
  }
  for (const listener of listeners) listener();
}

export function setFilesPaneSelection(
  paneId: string,
  filePath: string | null,
): void {
  setSnapshot(paneId, filePath);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cache.clear();
    listeners.clear();
  });
}

export function useFilesPaneSelection(
  paneId: string | null,
): [string | null, (filePath: string | null) => void] {
  const selected = useSyncExternalStore(
    subscribe,
    () => (paneId === null ? null : getSnapshot(paneId)),
    () => null,
  );

  const set = useCallback(
    (filePath: string | null) => {
      if (paneId === null) return;
      setSnapshot(paneId, filePath);
    },
    [paneId],
  );

  return [selected, set];
}

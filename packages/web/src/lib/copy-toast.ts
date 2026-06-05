import { useSyncExternalStore } from "react";

/**
 * Lightweight global "value copied" toast.
 * Used by `useLongPressCopy` so any monospace surface can fire a one-line
 * confirmation without drilling a callback through the tree.
 */

interface CopyToastState {
  message: string;
  /** Monotonic id so React rerenders even when the same message repeats. */
  seq: number;
}

let state: CopyToastState | null = null;
const listeners = new Set<() => void>();
let seq = 0;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): CopyToastState | null {
  return state;
}

export function showCopyToast(message: string, durationMs = 1800): void {
  seq += 1;
  state = { message, seq };
  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    state = null;
    dismissTimer = null;
    notify();
  }, durationMs);
  notify();
}

export function useCopyToast(): CopyToastState | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = null;
    state = null;
    listeners.clear();
  });
}

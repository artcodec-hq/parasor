import { useSyncExternalStore } from "react";

export type SyncToastTone = "info" | "working" | "ok" | "err";

export interface SyncToastAction {
  label: string;
  onSelect: () => void;
  /** `primary` renders accent-filled; `ghost` is the default text-button. */
  kind?: "primary" | "ghost";
}

export interface SyncToast {
  id: string;
  tone: SyncToastTone;
  title: string;
  sub?: string;
  /** Render `sub` in the monospace face (paths, branches, ratios). */
  mono?: boolean;
  actions?: ReadonlyArray<SyncToastAction>;
}

interface State {
  toasts: ReadonlyArray<SyncToast>;
}

let state: State = { toasts: [] };
const listeners = new Set<() => void>();
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): State {
  return state;
}

function clearTimer(id: string): void {
  const handle = dismissTimers.get(id);
  if (handle) {
    clearTimeout(handle);
    dismissTimers.delete(id);
  }
}

function scheduleDismiss(id: string, durationMs: number): void {
  clearTimer(id);
  dismissTimers.set(
    id,
    setTimeout(() => {
      dismissSyncToast(id);
    }, durationMs),
  );
}

export interface ShowSyncToastInput
  extends Omit<SyncToast, "id" | "tone" | "title"> {
  tone: SyncToastTone;
  title: string;
  /**
   * When provided, replaces (or initialises) the toast with this id instead
   * of appending a new entry. The same id can transition `working -> ok/err`.
   */
  id?: string;
  /** Auto-dismiss after this many ms; omit for sticky toasts. */
  durationMs?: number;
}

export function showSyncToast(input: ShowSyncToastInput): string {
  const id = input.id ?? `sync-${++seq}`;
  const next: SyncToast = {
    id,
    tone: input.tone,
    title: input.title,
    ...(input.sub !== undefined && { sub: input.sub }),
    ...(input.mono !== undefined && { mono: input.mono }),
    ...(input.actions !== undefined && { actions: input.actions }),
  };
  const existing = state.toasts.findIndex((t) => t.id === id);
  const toasts =
    existing === -1
      ? [...state.toasts, next]
      : state.toasts.map((t, i) => (i === existing ? next : t));
  state = { toasts };
  if (input.durationMs !== undefined) {
    scheduleDismiss(id, input.durationMs);
  } else {
    clearTimer(id);
  }
  notify();
  return id;
}

export function dismissSyncToast(id: string): void {
  clearTimer(id);
  if (!state.toasts.some((t) => t.id === id)) return;
  state = { toasts: state.toasts.filter((t) => t.id !== id) };
  notify();
}

export function useSyncToasts(): ReadonlyArray<SyncToast> {
  return useSyncExternalStore(subscribe, getSnapshot, () => state).toasts;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const handle of dismissTimers.values()) clearTimeout(handle);
    dismissTimers.clear();
    state = { toasts: [] };
    listeners.clear();
  });
}

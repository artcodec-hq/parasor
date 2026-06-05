// Pending requests are replayed when a handler registers, so sidebar -> pane open works regardless of mount order.
export type PaneFocusFn = () => void;

const handlers = new Map<string, PaneFocusFn>();
const pending = new Map<string, true>();

export function registerPaneFocus(paneId: string, fn: PaneFocusFn): () => void {
  handlers.set(paneId, fn);
  if (pending.has(paneId)) {
    pending.delete(paneId);
    fn();
  }
  return () => {
    if (handlers.get(paneId) === fn) handlers.delete(paneId);
  };
}

export function requestPaneFocus(paneId: string): void {
  const fn = handlers.get(paneId);
  if (fn) {
    fn();
    return;
  }
  pending.set(paneId, true);
}

export function clearPendingPaneFocus(paneId: string): void {
  pending.delete(paneId);
}

export function __resetPaneFocusRegistryForTests(): void {
  handlers.clear();
  pending.clear();
}

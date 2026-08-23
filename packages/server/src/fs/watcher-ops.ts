export function chainWatcherOp(
  watcherOps: Map<string, Promise<void>>,
  key: string,
  op: () => Promise<void>,
): Promise<void> {
  const prev = watcherOps.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(op);
  watcherOps.set(key, next);
  // Catch the bookkeeping promise. Promise.finally on a rejected next re-rejects.
  void next
    .catch(() => undefined)
    .finally(() => {
      if (watcherOps.get(key) === next) watcherOps.delete(key);
    });
  return next;
}

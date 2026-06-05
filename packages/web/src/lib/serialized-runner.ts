/**
 * FIFO promise queue. Each scheduled job waits for the previous to settle
 * (resolve OR reject) before running, so callers see strictly client-ordered
 * side-effects regardless of network reordering.
 */
export type SerializedRunner = <T>(job: () => Promise<T>) => Promise<T>;

export function createSerializedRunner(): SerializedRunner {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const next = tail.catch(() => undefined).then(() => job());
    tail = next;
    return next;
  };
}

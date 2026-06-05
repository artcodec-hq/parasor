import { isSocketActive } from "./bootstrap.js";

export interface WaitForDaemonSocketOpts {
  /** Milliseconds before timeout (default 5000). */
  timeoutMs?: number;
  /** Poll interval in milliseconds (default 100). */
  intervalMs?: number;
  /**
   * Probe function -- returns true when the socket is accepting connections.
   * Defaults to `isSocketActive(path, 200)`. Injected in tests.
   */
  probeFn?: (path: string) => Promise<boolean>;
}

/**
 * Polls `socketPath` until a daemon is listening or `timeoutMs` elapses.
 *
 * On timeout throws:
 *   Error: daemon socket did not become ready within ${timeoutMs}ms (path=${socketPath})
 *
 * Reuses `bootstrap.ts#isSocketActive` for the default probe so the
 * same kernel-level socket-connect check is shared across both layers.
 */
export async function waitForDaemonSocket(
  socketPath: string,
  opts: WaitForDaemonSocketOpts = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 100;
  const probeFn = opts.probeFn ?? ((p: string) => isSocketActive(p, 200));

  const deadline = Date.now() + timeoutMs;

  while (true) {
    const ready = await probeFn(socketPath);
    if (ready) return;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `daemon socket did not become ready within ${timeoutMs}ms (path=${socketPath})`,
      );
    }

    await sleep(Math.min(intervalMs, remaining));

    if (Date.now() >= deadline) {
      throw new Error(
        `daemon socket did not become ready within ${timeoutMs}ms (path=${socketPath})`,
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/*
 * Bounded race between a handshake-completion `awaiter` and a wall-clock
 * deadline. Split out of {@link RemotePtyHost.connect} so the timeout +
 * cleanup logic can be exercised under fake timers without a real socket.
 *
 * Why this matters (codex round 2 HIGH): a daemon that accept()s the socket
 * but never sends HELLO_ACK / SESSION_LIST would otherwise hang server boot
 * indefinitely. On timeout we run an `onTimeout` side effect (production
 * usage: `socket.destroy()` -- which fires the host's `error` listener ->
 * `handleDrop` -> `correlator.rejectAll` and rejects the lifecycle promise)
 * and then surface a typed timeout error to the caller.
 *
 * Pure with respect to socket internals -- the helper takes the side-effect
 * as an `onTimeout` callback and the error as a `buildTimeoutError` builder,
 * so the caller decides what to destroy and what error code to attach.
 */
export interface RaceHandshakeWithTimeoutOpts {
  /** Promise that resolves once the handshake completes successfully or
   *  rejects on a wire / protocol fault detected by the caller. */
  awaiter: Promise<void>;
  /** Wall-clock deadline in milliseconds. */
  timeoutMs: number;
  /** Side effect invoked exactly once when the deadline fires before
   *  `awaiter` settles. Production: `() => socket.destroy()`. Thrown errors
   *  are swallowed -- the socket may already be in an error state, and the
   *  caller still needs the typed timeout error to propagate. */
  onTimeout: () => void;
  /** Build the typed error rejected when the deadline fires. The configured
   *  `timeoutMs` is passed back so the message can include it without the
   *  caller re-encoding the value. */
  buildTimeoutError: (timeoutMs: number) => Error;
}

/** Race `awaiter` against `timeoutMs`. On deadline: run `onTimeout`
 *  (swallowing throws), then reject with `buildTimeoutError(timeoutMs)`.
 *  The internal timer is cleared in `finally` so a late timeout cannot
 *  resolve the race after the awaiter settled first. */
export function raceHandshakeWithTimeout(
  opts: RaceHandshakeWithTimeoutOpts,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        opts.onTimeout();
      } catch {
        /* swallowed -- see opts.onTimeout doc */
      }
      reject(opts.buildTimeoutError(opts.timeoutMs));
    }, opts.timeoutMs);
  });
  return Promise.race([opts.awaiter, timeoutPromise]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

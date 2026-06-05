import type { Buffer } from "node:buffer";
import type { Frame } from "./host-protocol/frames.js";

export interface PendingRequest {
  resolve: (frame: Frame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RequestCorrelatorDeps {
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Build the error used to reject a request that times out. The correlator
   *  supplies its own assigned requestId and the configured timeoutMs so the
   *  caller can format a domain-appropriate message without re-encoding either
   *  value (keeps the correlator decoupled from `RemotePtyHostError`). */
  buildTimeoutError: (requestId: number, timeoutMs: number) => Error;
  /** Hand the frame to the wire. Called once per `request()` with the
   *  correlator-assigned requestId. State-machine guards and socket-write
   *  failure handling stay on the caller side -- the correlator is socket /
   *  state agnostic. */
  send: (type: number, requestId: number, payload: Buffer) => void;
}

/**
 * Request/response correlation for the daemon wire-frame protocol. Owns:
 *   - monotonic requestId assignment (starts at 1; `requestId=0` is reserved
 *     by the protocol for fire-and-forget and connection-level NACK and is
 *     never assigned here).
 *   - the pending-request map (id -> {resolve, reject, timer}).
 *   - per-request timeout scheduling.
 *   - ACK / NACK dispatch to the matching pending entry.
 *   - bulk-reject on connection drop.
 *
 * The pending entry is registered **before** `send` is called so a
 * synchronous send-side fault that triggers a connection drop in the caller
 * can still iterate `rejectAll` and reject the just-registered Promise (the
 * same ordering invariant the inline-on-`RemotePtyHost` implementation
 * relied on).
 */
export class RequestCorrelator {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly deps: RequestCorrelatorDeps;

  constructor(deps: RequestCorrelatorDeps) {
    this.deps = deps;
  }

  /** Assign a fresh requestId, register the pending entry, arm the timeout,
   *  and hand the frame to the wire. */
  request(type: number, payload: Buffer): Promise<Frame> {
    const requestId = this.nextId++;
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          reject(this.deps.buildTimeoutError(requestId, this.deps.timeoutMs));
        }
      }, this.deps.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.deps.send(type, requestId, payload);
    });
  }

  /** Resolve the pending entry keyed by `frame.requestId`, if any. Returns
   *  true when a pending entry was matched and resolved, false on a stale
   *  ACK (peer slow / fenced). */
  ack(frame: Frame): boolean {
    const entry = this.pending.get(frame.requestId);
    if (!entry) return false;
    this.pending.delete(frame.requestId);
    clearTimeout(entry.timer);
    entry.resolve(frame);
    return true;
  }

  /** Reject the pending entry for `requestId` with `err`. `requestId === 0`
   *  is a connection-level NACK and is rejected here as a no-op (the caller
   *  treats it as a wire fault and drops the connection). Returns true on
   *  match, false on stale or `requestId === 0`. */
  nack(requestId: number, err: Error): boolean {
    if (requestId === 0) return false;
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.reject(err);
    return true;
  }

  /** Reject every pending entry with `err` and clear the map. Used on socket
   *  drop so in-flight Promise<X>-returning methods don't hang. */
  rejectAll(err: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }
}

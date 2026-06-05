/*
 * Handshake state machine for {@link RemotePtyHost}.
 *
 * States:
 *   connecting       -- HELLO sent, awaiting HELLO_ACK
 *   snapshot-pending -- HELLO_ACK received, awaiting first SESSION_LIST
 *   ready            -- initial SESSION_LIST applied; mirror reflects daemon snapshot.
 *                      `awaitReady` resolves only at this point so callers never
 *                      observe a stale (= empty) mirror after await.
 *   dropped          -- wire dead; pending requests rejected by the host.
 *
 * The two-step "ack then snapshot" handshake closes a race: HELLO_ACK alone
 * leaves `list()` returning [] until the SESSION_LIST broadcast arrives a tick
 * later, so any caller running sync accessors immediately after
 * `await connect()` would see a phantom empty world.
 *
 * Pure with respect to socket / wire -- this class owns the state machine,
 * the connectionId + generation stamped at HELLO_ACK time (used by the host
 * to fill outgoing frames), and the deferred handshake Promise. It does NOT
 * write to the socket, reject correlator entries, or touch the session
 * mirror -- those stay on {@link RemotePtyHost}.
 */

export type RemoteConnState =
  | "connecting"
  | "snapshot-pending"
  | "ready"
  | "dropped";

export class ConnectionLifecycle {
  private state: RemoteConnState = "connecting";
  private _connectionId = 0;
  private _generation = 0n;
  private readonly handshakePromise: Promise<void>;
  private resolveHandshake!: () => void;
  private rejectHandshakePromise!: (err: Error) => void;

  constructor() {
    this.handshakePromise = new Promise<void>((resolve, reject) => {
      this.resolveHandshake = resolve;
      this.rejectHandshakePromise = reject;
    });
  }

  /** Current state token. Kept as a getter so callers cannot mutate it. */
  get current(): RemoteConnState {
    return this.state;
  }

  /** Daemon-assigned connection identifier, stamped at HELLO_ACK time.
   *  Zero before HELLO_ACK; used by the host to fill outgoing frame headers. */
  get connectionId(): number {
    return this._connectionId;
  }

  /** Generation latch stamped at HELLO_ACK time; included in every outgoing
   *  frame header so a fenced daemon can recognize stale connections. */
  get generation(): bigint {
    return this._generation;
  }

  /** Promise that resolves once handshake completes (HELLO_ACK + first
   *  SESSION_LIST applied) and rejects on connection drop / handshake error. */
  get awaitReady(): Promise<void> {
    return this.handshakePromise;
  }

  get isDropped(): boolean {
    return this.state === "dropped";
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  /** True iff the handshake is still in-flight (HELLO_ACK or first
   *  SESSION_LIST has not yet been processed). */
  get isAwaitingHandshake(): boolean {
    return this.state === "connecting" || this.state === "snapshot-pending";
  }

  /** HELLO_ACK arrived and validated by the caller. Stamps connectionId +
   *  generation and transitions `connecting -> snapshot-pending`. Returns
   *  false if the current state is not `connecting` (stale / duplicate ack
   *  is silently ignored, matching the prior inline guard). */
  applyHelloAck(connectionId: number, generation: bigint): boolean {
    if (this.state !== "connecting") return false;
    this._connectionId = connectionId;
    this._generation = generation;
    this.state = "snapshot-pending";
    return true;
  }

  /** First SESSION_LIST applied in `snapshot-pending` -- transition to
   *  `ready` and resolve the handshake Promise. Returns false on any other
   *  current state (later SESSION_LIST frames just update the mirror). */
  markReady(): boolean {
    if (this.state !== "snapshot-pending") return false;
    this.state = "ready";
    this.resolveHandshake();
    return true;
  }

  /** Reject the handshake Promise with `err` without changing state.
   *  Used so a connection-level NACK (requestId=0) can surface the daemon's
   *  specific NACK code on the awaiter, before the subsequent `drop()` chain
   *  would otherwise reject with the generic "connection-dropped" error.
   *  The second reject from `drop()` is a no-op because Promise rejection
   *  is idempotent. */
  rejectHandshakeOnly(err: Error): void {
    this.rejectHandshakePromise(err);
  }

  /** Transition to `dropped`. Idempotent -- returns false if already dropped.
   *  If the handshake was still awaiting, rejects the Promise with `err`
   *  (Promise reject is itself idempotent, so a prior `rejectHandshakeOnly`
   *  takes precedence on the awaiter side). Returns true iff state actually
   *  transitioned, so callers can gate side effects (correlator.rejectAll,
   *  etc.) on the transition rather than on the previous state. */
  drop(err: Error): boolean {
    if (this.state === "dropped") return false;
    const wasAwaiting = this.isAwaitingHandshake;
    this.state = "dropped";
    if (wasAwaiting) this.rejectHandshakePromise(err);
    return true;
  }
}

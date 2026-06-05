import type { Duplex } from "node:stream";
import {
  encodeFrame,
  type Frame,
  FrameError,
  FrameParser,
  FrameType,
} from "../host-protocol/frames.js";
import {
  encodeJsonPayload,
  type NackCode,
  type NackPayload,
} from "../host-protocol/messages.js";

/*
 * One server↔daemon socket connection from the daemon's perspective.
 * The daemon may have at most one *current* ServerConnection at any time
 *; a new HELLO causes the prior current to be
 * evicted. ServerConnection itself is unaware of "current" -- eviction is
 * orchestrated by `PtyHostDaemon`. This class just owns:
 *
 *  - the byte-stream parser (FrameParser)
 *  - the assigned (connectionId, generation) once HELLO completes
 *  - send helpers that auto-fill the (connectionId, generation) header
 *  - a small lifecycle FSM: awaiting-hello -> ready -> evicted/closed
 *
 * A FrameError thrown by the parser closes the connection with a NACK --
 * the peer is misbehaving and can't be trusted to recover. epoch fencing
 * itself happens above this layer, in PtyHostDaemon's dispatcher.
 */

export type ServerConnectionState =
  | "awaiting-hello"
  | "ready"
  | "evicted"
  | "closed";

export interface ServerConnectionDeps {
  socket: Duplex;
  /** Initial id; daemon may reassign on HELLO_ACK if it wants different ids. */
  connectionId: number;
  generation: bigint;
  onFrame: (conn: ServerConnection, frame: Frame) => void;
  onClose: (conn: ServerConnection) => void;
}

export class ServerConnection {
  readonly connectionId: number;
  generation: bigint;
  private readonly socket: Duplex;
  private readonly parser = new FrameParser();
  private state: ServerConnectionState = "awaiting-hello";
  private readonly onFrame: ServerConnectionDeps["onFrame"];
  private readonly onClose: ServerConnectionDeps["onClose"];

  constructor(deps: ServerConnectionDeps) {
    this.socket = deps.socket;
    this.connectionId = deps.connectionId;
    this.generation = deps.generation;
    this.onFrame = deps.onFrame;
    this.onClose = deps.onClose;

    this.socket.on("data", (chunk: Buffer) => this.handleChunk(chunk));
    this.socket.on("close", () => this.handleClose());
    this.socket.on("error", () => this.handleClose());
  }

  getState(): ServerConnectionState {
    return this.state;
  }

  markReady(): void {
    if (this.state === "awaiting-hello") this.state = "ready";
  }

  /**
   * Send a frame, auto-filling the (connectionId, generation) header.
   * No-op once the connection is closed/evicted -- late callbacks from
   * the daemon are common during eviction races and shouldn't crash.
   */
  send(frame: { type: number; requestId: number; payload: Buffer }): void {
    if (this.state === "closed" || this.state === "evicted") return;
    try {
      const buf = encodeFrame({
        type: frame.type,
        connectionId: this.connectionId,
        generation: this.generation,
        requestId: frame.requestId,
        payload: frame.payload,
      });
      this.socket.write(buf);
    } catch {
      // Socket may have been destroyed mid-write; falling back to close.
      this.handleClose();
    }
  }

  /**
   * Eviction protocol per the protocol: send a NACK telling the peer it has
   * been superseded, then `end()` the socket so the kernel flushes the
   * NACK before FIN. We do NOT call `destroy()` -- that drops in-flight
   * bytes and would race the NACK delivery.
   */
  evict(code: NackCode, message: string): void {
    if (this.state === "evicted" || this.state === "closed") return;
    const payload: NackPayload = { code, message };
    this.send({
      type: FrameType.NACK,
      requestId: 0,
      payload: encodeJsonPayload(payload),
    });
    this.state = "evicted";
    this.socket.end();
  }

  private handleChunk(chunk: Buffer): void {
    if (this.state === "evicted" || this.state === "closed") return;
    let frames: Frame[];
    try {
      frames = this.parser.push(chunk);
    } catch (err) {
      if (err instanceof FrameError) {
        this.evict(
          err.code === "FRAME_TOO_LARGE" ? "frame-too-large" : "frame-invalid",
          err.message,
        );
        return;
      }
      this.evict("internal-error", "parser failure");
      return;
    }
    for (const frame of frames) {
      // onFrame callback may synchronously transition state via evict();
      // re-read through getState() so TS doesn't carry the narrowing
      // from the top-of-method guard across the callback boundary.
      if (this.getState() === "evicted" || this.getState() === "closed") return;
      this.onFrame(this, frame);
    }
  }

  private handleClose(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.onClose(this);
  }
}

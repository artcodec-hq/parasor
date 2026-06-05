import { Buffer } from "node:buffer";
import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  type Frame,
  FrameParser,
  FrameType,
} from "../host-protocol/frames.js";
import {
  decodeJsonPayload,
  encodeJsonPayload,
  type NackPayload,
} from "../host-protocol/messages.js";
import { ServerConnection } from "./server-connection.js";

/*
 * Unit tests for `ServerConnection`. We use a `MockSocket` Duplex with
 * fully separated inbound/outbound channels so test code can `feed()`
 * client->daemon bytes without those bytes echoing back into the
 * outbound buffer (which is what would happen with a single PassThrough,
 * since PassThrough is a Transform that re-emits its own writes).
 */

class MockSocket extends Duplex {
  outgoing: Buffer[] = [];
  _read(): void {
    /* tests drive inbound via feed() / closeNow() */
  }
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.outgoing.push(Buffer.from(chunk));
    cb();
  }
  /*
   * Emit `data`/`close` directly rather than going through the readable
   * buffer. ServerConnection only listens for those two events; bypassing
   * push() avoids the flowing-mode handshake that's awkward to drive
   * deterministically inside Vitest's microtask schedule.
   */
  feed(chunk: Buffer): void {
    this.emit("data", chunk);
  }
  closeNow(): void {
    this.emit("close");
  }
}

interface Harness {
  conn: ServerConnection;
  framesIn: Frame[];
  socket: MockSocket;
  drainFrames(): Frame[];
  feed(chunk: Buffer): void;
}

function harness(
  opts: { initialGeneration?: bigint; initialConnectionId?: number } = {},
): Harness {
  const socket = new MockSocket();
  const framesIn: Frame[] = [];
  const conn = new ServerConnection({
    socket,
    connectionId: opts.initialConnectionId ?? 7,
    generation: opts.initialGeneration ?? 11n,
    onFrame: (_c, frame) => framesIn.push(frame),
    onClose: () => {
      /* tests check state directly */
    },
  });
  return {
    conn,
    framesIn,
    socket,
    drainFrames(): Frame[] {
      const buf = Buffer.concat(socket.outgoing);
      socket.outgoing.length = 0;
      return new FrameParser().push(buf);
    },
    feed(chunk: Buffer): void {
      socket.feed(chunk);
    },
  };
}

describe("ServerConnection FSM", () => {
  it("starts in awaiting-hello", () => {
    const h = harness();
    expect(h.conn.getState()).toBe("awaiting-hello");
  });

  it("markReady transitions awaiting-hello -> ready (and is idempotent on ready)", () => {
    const h = harness();
    h.conn.markReady();
    expect(h.conn.getState()).toBe("ready");
    h.conn.markReady();
    expect(h.conn.getState()).toBe("ready");
  });

  it("send auto-fills (connectionId, generation) on the wire", () => {
    const h = harness({ initialConnectionId: 42, initialGeneration: 99n });
    h.conn.send({
      type: FrameType.NACK,
      requestId: 7,
      payload: encodeJsonPayload({ code: "internal-error", message: "x" }),
    });
    const [frame] = h.drainFrames();
    expect(frame.type).toBe(FrameType.NACK);
    expect(frame.connectionId).toBe(42);
    expect(frame.generation).toBe(99n);
    expect(frame.requestId).toBe(7);
  });

  it("evict sends NACK then ends the socket and refuses further sends", async () => {
    const h = harness();
    h.conn.evict("evicted", "superseded");
    expect(h.conn.getState()).toBe("evicted");
    const [nack] = h.drainFrames();
    expect(nack.type).toBe(FrameType.NACK);
    const body = decodeJsonPayload<NackPayload>(nack.payload);
    expect(body.code).toBe("evicted");

    h.conn.send({
      type: FrameType.HELLO_ACK,
      requestId: 0,
      payload: Buffer.alloc(0),
    });
    expect(h.drainFrames()).toEqual([]);
  });

  it("dispatches incoming whole frames to onFrame", () => {
    const h = harness();
    const buf = encodeFrame({
      type: FrameType.HELLO,
      connectionId: 0,
      generation: 0n,
      requestId: 1,
      payload: encodeJsonPayload({
        protocolVersion: "1.0.0",
        serverPid: 100,
      }),
    });
    h.feed(buf);
    expect(h.framesIn).toHaveLength(1);
    expect(h.framesIn[0].type).toBe(FrameType.HELLO);
  });

  it("buffers across partial chunks", () => {
    const h = harness();
    const buf = encodeFrame({
      type: FrameType.HELLO,
      connectionId: 0,
      generation: 0n,
      requestId: 1,
      payload: Buffer.from("{}", "utf8"),
    });
    h.feed(buf.subarray(0, 5));
    expect(h.framesIn).toHaveLength(0);
    h.feed(buf.subarray(5));
    expect(h.framesIn).toHaveLength(1);
  });

  it("evicts with frame-too-large on oversize advertised len", () => {
    const h = harness();
    const header = Buffer.alloc(4);
    // 17 (header) + 16MiB + 1 = exceeds cap
    header.writeUInt32BE(17 + 16 * 1024 * 1024 + 1, 0);
    h.feed(header);
    expect(h.conn.getState()).toBe("evicted");
    const [nack] = h.drainFrames();
    expect(nack.type).toBe(FrameType.NACK);
    const body = decodeJsonPayload<NackPayload>(nack.payload);
    expect(body.code).toBe("frame-too-large");
  });

  it("transitions to closed on socket close", () => {
    const h = harness();
    h.socket.closeNow();
    expect(h.conn.getState()).toBe("closed");
  });
});

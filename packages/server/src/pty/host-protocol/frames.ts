/*
 * Wire frame format for the PtyHost daemon IPC.
 *
 *   [len:u32be][type:u8][connectionId:u32be][generation:u64be][requestId:u32be][payload]
 *
 * `len` covers everything after itself (type + connectionId + generation +
 * requestId + payload). One TCP/Unix-socket recv may deliver any number
 * of bytes -- fewer than one frame, exactly one, or several plus a partial
 * tail. `FrameParser` buffers raw chunks and yields whole frames only.
 *
 * The envelope is fixed for every frame type. HELLO (the first frame on a
 * fresh connection) uses connectionId=0 / generation=0n / requestId=0
 * because daemon assigns them in HELLO_ACK; subsequent frames carry the
 * assigned triple verbatim, which is what  epoch fencing relies on.
 */

export const FRAME_HEADER_BYTES = 1 + 4 + 8 + 4; // type + connId + generation + reqId

/**
 * Hard cap on payload size. Defends against a malformed/hostile sender
 * advertising a huge `len` and forcing the peer to allocate. 16 MiB is
 * far above any legitimate frame (the largest realistic payload is a
 * scrollback snapshot, which is line-segmented and typically <1 MiB).
 */
export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

/*
 * Frame type registry. Numbering blocks:
 *   0x01-0x0F handshake / control
 *   0x10-0x1F request frames (paired with 0x10|0x01 = ACK pattern below)
 *   0x20-0x2F fire-and-forget mutators (no ack)
 *   0x30-0x3F daemon->server one-way events / streams
 *
 * Per the ack-semantics decision: only Promise<X>-returning PtyHost
 * methods get a request/ACK pair. Sync-returning methods (write/resize/
 * setTitle/setPinned/...) ride on fire-and-forget mutators and rely on
 * SESSION_UPDATE broadcasts to reconcile the optimistic mirror.
 */
export const FrameType = {
  // 0x01-0x0F handshake / control
  HELLO: 0x01,
  HELLO_ACK: 0x02,
  NACK: 0x03,

  // 0x10-0x1F request -> ack pairs (request awaits ACK with same requestId)
  CREATE_REQ: 0x10,
  CREATE_ACK: 0x11,
  RESTART_REQ: 0x12,
  RESTART_ACK: 0x13,
  DISPOSE_REQ: 0x14,
  DISPOSE_ACK: 0x15,
  DISPOSE_ALL_REQ: 0x16,
  DISPOSE_ALL_ACK: 0x17,
  SHUTDOWN_ALL_REQ: 0x18, // Remote: detach-only (by design). Daemon does NOT kill sessions.
  SHUTDOWN_ALL_ACK: 0x19,
  INIT_CLIENT_REQ: 0x1a,
  INIT_CLIENT_ACK: 0x1b,
  // daemon state ownership -- server forwards project-domain snapshot for daemon to persist
  // (single-writer-of-state.json invariant). Daemon adopts via
  // internalMutate + flush; ACK gates on persistence success.
  PERSIST_PROJECT_DOMAINS_REQ: 0x1c,
  PERSIST_PROJECT_DOMAINS_ACK: 0x1d,

  // 0x20-0x2F fire-and-forget mutators (caller does not await; epoch fencing only)
  WRITE: 0x20,
  RESIZE: 0x21,
  REFRESH: 0x22,
  DETACH_CLIENT: 0x23,
  SET_TITLE: 0x24,
  SET_PINNED: 0x25,
  SET_PTY_ENV: 0x26,
  PAUSE_OUTPUT: 0x27,
  RESUME_OUTPUT: 0x28,

  // 0x30-0x3F daemon -> server events (no ack expected)
  DATA: 0x30,
  SESSION_UPDATE: 0x31,
  SESSION_LIST: 0x32,
  SESSION_EXIT: 0x33,
  SESSION_INPUT: 0x34, // echo of WRITE input for server hooks (osc7 / port detect)
} as const;

export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType];

/**
 * Stream-payload frames carry session-routed binary data. Format:
 *   `[sessionIdLen:u8][sessionId:utf8][raw bytes]`
 *
 * Avoids JSON+base64 (~33% inflation) and UTF-8 boundary corruption on
 * partial writes. Used by WRITE / DATA / SESSION_INPUT -- every other
 * frame type carries a JSON payload (see `messages.ts`).
 */
export const STREAM_FRAME_TYPES: ReadonlySet<number> = new Set<number>([
  FrameType.WRITE,
  FrameType.DATA,
  FrameType.SESSION_INPUT,
]);

/**
 * Generation-tagged stream payload (PTY generation gate). Wire format:
 *   `[sessionIdLen:u8][sessionId:utf8][generation:u32 BE][raw bytes]`
 *
 * Used by both directions of the auto-resume race fix:
 * - WRITE (server -> daemon): `generation` tags the PTY generation the
 *   client believes is current. Daemon drops on mismatch.
 * - DATA (daemon -> server): `generation` tags the PTY generation that
 *   produced this OUTPUT batch. Server forwards to the WS client so
 *   the client knows which generation to echo back on subsequent
 *   INPUT.
 *
 * Kept separate from `encodeStreamPayload` because SESSION_INPUT does
 * not need a generation tag -- it is a server-side echo for hooks
 * (osc7 / port-detect) and never feeds back into the input gate.
 */
export const STREAM_GENERATION_BYTES = 4;

export function encodeGenerationStreamPayload(
  sessionId: string,
  data: Buffer,
  generation: number,
): Buffer {
  const idBuf = Buffer.from(sessionId, "utf8");
  if (idBuf.length > 0xff) {
    throw new FrameError(
      "FRAME_INVALID",
      `sessionId byte length ${idBuf.length} exceeds u8 max 255`,
    );
  }
  const out = Buffer.allocUnsafe(
    1 + idBuf.length + STREAM_GENERATION_BYTES + data.length,
  );
  out.writeUInt8(idBuf.length, 0);
  idBuf.copy(out, 1);
  out.writeUInt32BE(generation >>> 0, 1 + idBuf.length);
  data.copy(out, 1 + idBuf.length + STREAM_GENERATION_BYTES);
  return out;
}

export function decodeGenerationStreamPayload(payload: Buffer): {
  sessionId: string;
  generation: number;
  data: Buffer;
} {
  if (payload.length < 1) {
    throw new FrameError(
      "FRAME_INVALID",
      "generation stream payload missing sessionIdLen",
    );
  }
  const idLen = payload.readUInt8(0);
  if (payload.length < 1 + idLen + STREAM_GENERATION_BYTES) {
    throw new FrameError(
      "FRAME_INVALID",
      `generation stream payload truncated (need 1+${idLen}+${STREAM_GENERATION_BYTES}, got ${payload.length})`,
    );
  }
  const sessionId = payload.subarray(1, 1 + idLen).toString("utf8");
  const generation = payload.readUInt32BE(1 + idLen);
  const data = Buffer.from(
    payload.subarray(1 + idLen + STREAM_GENERATION_BYTES),
  );
  return { sessionId, generation, data };
}

export function encodeStreamPayload(sessionId: string, data: Buffer): Buffer {
  const idBuf = Buffer.from(sessionId, "utf8");
  if (idBuf.length > 0xff) {
    throw new FrameError(
      "FRAME_INVALID",
      `sessionId byte length ${idBuf.length} exceeds u8 max 255`,
    );
  }
  const out = Buffer.allocUnsafe(1 + idBuf.length + data.length);
  out.writeUInt8(idBuf.length, 0);
  idBuf.copy(out, 1);
  data.copy(out, 1 + idBuf.length);
  return out;
}

export function decodeStreamPayload(payload: Buffer): {
  sessionId: string;
  data: Buffer;
} {
  if (payload.length < 1) {
    throw new FrameError(
      "FRAME_INVALID",
      "stream payload missing sessionIdLen",
    );
  }
  const idLen = payload.readUInt8(0);
  if (payload.length < 1 + idLen) {
    throw new FrameError(
      "FRAME_INVALID",
      `stream payload truncated (need 1+${idLen}, got ${payload.length})`,
    );
  }
  const sessionId = payload.subarray(1, 1 + idLen).toString("utf8");
  const data = Buffer.from(payload.subarray(1 + idLen));
  return { sessionId, data };
}

export interface Frame {
  type: number;
  connectionId: number;
  generation: bigint;
  requestId: number;
  payload: Buffer;
}

export class FrameError extends Error {
  constructor(
    public readonly code: "FRAME_TOO_LARGE" | "FRAME_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "FrameError";
  }
}

export function encodeFrame(frame: Frame): Buffer {
  if (frame.payload.length > MAX_PAYLOAD_BYTES) {
    throw new FrameError(
      "FRAME_TOO_LARGE",
      `payload size ${frame.payload.length} exceeds cap ${MAX_PAYLOAD_BYTES}`,
    );
  }
  if (frame.type < 0 || frame.type > 0xff) {
    throw new FrameError("FRAME_INVALID", `type ${frame.type} out of u8 range`);
  }
  if (frame.connectionId < 0 || frame.connectionId > 0xffffffff) {
    throw new FrameError(
      "FRAME_INVALID",
      `connectionId ${frame.connectionId} out of u32 range`,
    );
  }
  if (frame.generation < 0n || frame.generation > 0xffffffffffffffffn) {
    throw new FrameError(
      "FRAME_INVALID",
      `generation ${frame.generation} out of u64 range`,
    );
  }
  if (frame.requestId < 0 || frame.requestId > 0xffffffff) {
    throw new FrameError(
      "FRAME_INVALID",
      `requestId ${frame.requestId} out of u32 range`,
    );
  }
  const totalAfterLen = FRAME_HEADER_BYTES + frame.payload.length;
  const buf = Buffer.allocUnsafe(4 + totalAfterLen);
  buf.writeUInt32BE(totalAfterLen, 0);
  buf.writeUInt8(frame.type, 4);
  buf.writeUInt32BE(frame.connectionId, 5);
  buf.writeBigUInt64BE(frame.generation, 9);
  buf.writeUInt32BE(frame.requestId, 17);
  frame.payload.copy(buf, 21);
  return buf;
}

/**
 * Stream-safe frame decoder. Push raw chunks as they arrive on the
 * socket; the parser yields zero or more complete frames per push and
 * keeps any trailing partial frame buffered for the next push.
 *
 * Throws `FrameError("FRAME_TOO_LARGE")` synchronously from `push()` if
 * a peer advertises a length above the cap -- caller MUST close the
 * connection rather than continue draining the buffer.
 */
export class FrameParser {
  private chunks: Buffer[] = [];
  private size = 0;

  push(chunk: Buffer): Frame[] {
    if (chunk.length === 0) return [];
    this.chunks.push(chunk);
    this.size += chunk.length;
    const out: Frame[] = [];
    for (;;) {
      const frame = this.takeOne();
      if (!frame) break;
      out.push(frame);
    }
    return out;
  }

  /** Bytes currently buffered (partial/unparsed). Useful for diagnostics. */
  bufferedBytes(): number {
    return this.size;
  }

  private takeOne(): Frame | null {
    if (this.size < 4) return null;
    const buf = this.materialize();
    const totalAfterLen = buf.readUInt32BE(0);
    if (totalAfterLen < FRAME_HEADER_BYTES) {
      throw new FrameError(
        "FRAME_INVALID",
        `len=${totalAfterLen} smaller than header (${FRAME_HEADER_BYTES})`,
      );
    }
    if (totalAfterLen - FRAME_HEADER_BYTES > MAX_PAYLOAD_BYTES) {
      throw new FrameError(
        "FRAME_TOO_LARGE",
        `payload size ${totalAfterLen - FRAME_HEADER_BYTES} exceeds cap ${MAX_PAYLOAD_BYTES}`,
      );
    }
    if (buf.length < 4 + totalAfterLen) return null;

    const type = buf.readUInt8(4);
    const connectionId = buf.readUInt32BE(5);
    const generation = buf.readBigUInt64BE(9);
    const requestId = buf.readUInt32BE(17);
    const payload = Buffer.from(buf.subarray(21, 4 + totalAfterLen));

    const remainder = buf.subarray(4 + totalAfterLen);
    if (remainder.length > 0) {
      this.chunks = [Buffer.from(remainder)];
      this.size = remainder.length;
    } else {
      this.chunks = [];
      this.size = 0;
    }
    return { type, connectionId, generation, requestId, payload };
  }

  private materialize(): Buffer {
    if (this.chunks.length === 1) return this.chunks[0];
    const merged = Buffer.concat(this.chunks, this.size);
    this.chunks = [merged];
    return merged;
  }
}

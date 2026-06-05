import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  decodeGenerationStreamPayload,
  decodeStreamPayload,
  encodeFrame,
  encodeGenerationStreamPayload,
  encodeStreamPayload,
  FRAME_HEADER_BYTES,
  type Frame,
  FrameError,
  FrameParser,
  FrameType,
  MAX_PAYLOAD_BYTES,
  STREAM_FRAME_TYPES,
} from "./frames.js";

function make(overrides: Partial<Frame> = {}): Frame {
  return {
    type: FrameType.HELLO,
    connectionId: 0,
    generation: 0n,
    requestId: 0,
    payload: Buffer.alloc(0),
    ...overrides,
  };
}

describe("encodeFrame", () => {
  it("packs header in network byte order", () => {
    const buf = encodeFrame(
      make({
        type: FrameType.HELLO_ACK,
        connectionId: 0x01020304,
        generation: 0x0a0b0c0d_0e0f1011n,
        requestId: 0x12345678,
        payload: Buffer.from("hi", "utf8"),
      }),
    );
    expect(buf.readUInt32BE(0)).toBe(FRAME_HEADER_BYTES + 2);
    expect(buf.readUInt8(4)).toBe(FrameType.HELLO_ACK);
    expect(buf.readUInt32BE(5)).toBe(0x01020304);
    expect(buf.readBigUInt64BE(9)).toBe(0x0a0b0c0d_0e0f1011n);
    expect(buf.readUInt32BE(17)).toBe(0x12345678);
    expect(buf.subarray(21).toString("utf8")).toBe("hi");
  });

  it("encodes empty payload", () => {
    const buf = encodeFrame(make());
    expect(buf.length).toBe(4 + FRAME_HEADER_BYTES);
    expect(buf.readUInt32BE(0)).toBe(FRAME_HEADER_BYTES);
  });

  it("rejects oversize payload", () => {
    expect(() =>
      encodeFrame(make({ payload: Buffer.alloc(MAX_PAYLOAD_BYTES + 1) })),
    ).toThrow(FrameError);
  });

  it("rejects out-of-range type / connectionId / requestId", () => {
    expect(() => encodeFrame(make({ type: 0x100 }))).toThrow(FrameError);
    expect(() => encodeFrame(make({ connectionId: 0x1_0000_0000 }))).toThrow(
      FrameError,
    );
    expect(() => encodeFrame(make({ requestId: 0x1_0000_0000 }))).toThrow(
      FrameError,
    );
  });

  it("rejects out-of-range generation", () => {
    expect(() => encodeFrame(make({ generation: -1n }))).toThrow(FrameError);
    expect(() =>
      encodeFrame(make({ generation: 0x1_0000_0000_0000_0000n })),
    ).toThrow(FrameError);
  });
});

describe("FrameParser", () => {
  it("round-trips a single frame", () => {
    const original = make({
      type: FrameType.NACK,
      connectionId: 7,
      generation: 42n,
      requestId: 99,
      payload: Buffer.from("payload", "utf8"),
    });
    const parser = new FrameParser();
    const frames = parser.push(encodeFrame(original));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: FrameType.NACK,
      connectionId: 7,
      generation: 42n,
      requestId: 99,
    });
    expect(frames[0].payload.toString("utf8")).toBe("payload");
    expect(parser.bufferedBytes()).toBe(0);
  });

  it("yields multiple frames from one chunk", () => {
    const a = encodeFrame(make({ requestId: 1, payload: Buffer.from("a") }));
    const b = encodeFrame(make({ requestId: 2, payload: Buffer.from("bb") }));
    const c = encodeFrame(make({ requestId: 3, payload: Buffer.from("ccc") }));
    const parser = new FrameParser();
    const frames = parser.push(Buffer.concat([a, b, c]));
    expect(frames.map((f) => f.requestId)).toEqual([1, 2, 3]);
    expect(parser.bufferedBytes()).toBe(0);
  });

  it("buffers partial frame across pushes (byte-by-byte)", () => {
    const frame = encodeFrame(
      make({
        requestId: 1234,
        payload: Buffer.from("hello world", "utf8"),
      }),
    );
    const parser = new FrameParser();
    let result: Frame[] = [];
    for (let i = 0; i < frame.length - 1; i++) {
      const got = parser.push(frame.subarray(i, i + 1));
      expect(got).toEqual([]);
    }
    result = parser.push(frame.subarray(frame.length - 1));
    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe(1234);
    expect(result[0].payload.toString("utf8")).toBe("hello world");
  });

  it("handles fragmented chunks containing multiple frames + tail", () => {
    const a = encodeFrame(make({ requestId: 1, payload: Buffer.from("a") }));
    const b = encodeFrame(make({ requestId: 2, payload: Buffer.from("bb") }));
    const c = encodeFrame(make({ requestId: 3, payload: Buffer.from("ccc") }));
    const all = Buffer.concat([a, b, c]);

    const parser = new FrameParser();
    const got1 = parser.push(all.subarray(0, a.length + 5));
    expect(got1.map((f) => f.requestId)).toEqual([1]);
    expect(parser.bufferedBytes()).toBe(5);

    const got2 = parser.push(all.subarray(a.length + 5));
    expect(got2.map((f) => f.requestId)).toEqual([2, 3]);
    expect(parser.bufferedBytes()).toBe(0);
  });

  it("returns empty array on empty push", () => {
    const parser = new FrameParser();
    expect(parser.push(Buffer.alloc(0))).toEqual([]);
  });

  it("throws FRAME_TOO_LARGE on advertised oversize", () => {
    const parser = new FrameParser();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_PAYLOAD_BYTES + FRAME_HEADER_BYTES + 1, 0);
    let caught: unknown;
    try {
      parser.push(header);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FrameError);
    expect((caught as FrameError).code).toBe("FRAME_TOO_LARGE");
  });

  it("throws FRAME_INVALID when len smaller than header", () => {
    const parser = new FrameParser();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(FRAME_HEADER_BYTES - 1, 0);
    let caught: unknown;
    try {
      parser.push(header);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FrameError);
    expect((caught as FrameError).code).toBe("FRAME_INVALID");
  });

  it("preserves payload byte values across encode/decode for binary data", () => {
    const payload = Buffer.alloc(257);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
    const parser = new FrameParser();
    const got = parser.push(encodeFrame(make({ payload })));
    expect(got).toHaveLength(1);
    expect(Buffer.compare(got[0].payload, payload)).toBe(0);
  });
});

describe("FrameType registry", () => {
  it("declares the  + daemon frame types with unique opcodes", () => {
    const values = Object.values(FrameType) as number[];
    expect(new Set(values).size).toBe(values.length);
  });

  it("classifies WRITE / DATA / SESSION_INPUT as stream-payload frames", () => {
    expect(STREAM_FRAME_TYPES.has(FrameType.WRITE)).toBe(true);
    expect(STREAM_FRAME_TYPES.has(FrameType.DATA)).toBe(true);
    expect(STREAM_FRAME_TYPES.has(FrameType.SESSION_INPUT)).toBe(true);
    expect(STREAM_FRAME_TYPES.has(FrameType.RESIZE)).toBe(false);
    expect(STREAM_FRAME_TYPES.has(FrameType.SESSION_UPDATE)).toBe(false);
  });

  it("groups request/ack pairs in the 0x10-0x1F block", () => {
    expect(FrameType.CREATE_REQ).toBeGreaterThanOrEqual(0x10);
    expect(FrameType.INIT_CLIENT_ACK).toBeLessThanOrEqual(0x1f);
  });
});

describe("encodeStreamPayload / decodeStreamPayload", () => {
  it("round-trips a UUID sessionId + raw bytes", () => {
    const sessionId = "01234567-89ab-cdef-0123-456789abcdef";
    const data = Buffer.from([0x00, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0xff]);
    const encoded = encodeStreamPayload(sessionId, data);
    const decoded = decodeStreamPayload(encoded);
    expect(decoded.sessionId).toBe(sessionId);
    expect(Buffer.compare(decoded.data, data)).toBe(0);
  });

  it("round-trips empty data", () => {
    const sessionId = "abc";
    const decoded = decodeStreamPayload(
      encodeStreamPayload(sessionId, Buffer.alloc(0)),
    );
    expect(decoded.sessionId).toBe("abc");
    expect(decoded.data.length).toBe(0);
  });

  it("preserves arbitrary binary bytes (including 0x00 / 0xFF / mid-codepoint)", () => {
    const sessionId = "s";
    const data = Buffer.alloc(512);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) & 0xff;
    const decoded = decodeStreamPayload(encodeStreamPayload(sessionId, data));
    expect(Buffer.compare(decoded.data, data)).toBe(0);
  });

  it("rejects sessionId longer than 255 bytes", () => {
    const tooLong = "x".repeat(256);
    expect(() => encodeStreamPayload(tooLong, Buffer.alloc(0))).toThrow(
      FrameError,
    );
  });

  it("decodes truncated payload as FRAME_INVALID", () => {
    let caught: unknown;
    try {
      decodeStreamPayload(Buffer.alloc(0));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FrameError);
  });

  it("decodes truncated sessionId as FRAME_INVALID", () => {
    // idLen=10 but only 3 bytes follow
    const buf = Buffer.from([10, 0x61, 0x62, 0x63]);
    let caught: unknown;
    try {
      decodeStreamPayload(buf);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FrameError);
    expect((caught as FrameError).code).toBe("FRAME_INVALID");
  });

  it("composes with FrameParser end-to-end (DATA frame)", () => {
    const sessionId = "01234567-89ab-cdef-0123-456789abcdef";
    const data = Buffer.from("ls -la\r", "utf8");
    const encoded = encodeFrame({
      type: FrameType.DATA,
      connectionId: 1,
      generation: 1n,
      requestId: 100,
      payload: encodeStreamPayload(sessionId, data),
    });
    const parser = new FrameParser();
    const frames = parser.push(encoded);
    expect(frames).toHaveLength(1);
    const decoded = decodeStreamPayload(frames[0].payload);
    expect(decoded.sessionId).toBe(sessionId);
    expect(decoded.data.toString("utf8")).toBe("ls -la\r");
  });
});

/*
 * PTY generation gate: generation-tagged stream payload codec used by both WRITE
 * (server->daemon, INPUT direction) and DATA (daemon->server, OUTPUT
 * direction). Carries a uint32 generation between sessionId and data
 * so the auto-resume drop-stale-input/output gate can fire on either
 * direction. generation=0 acts as the "no gating" sentinel.
 */
describe("encodeGenerationStreamPayload / decodeGenerationStreamPayload (PTY generation gate)", () => {
  it("round-trips sessionId, generation, and raw bytes", () => {
    const sessionId = "01234567-89ab-cdef-0123-456789abcdef";
    const data = Buffer.from([0x00, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0xff]);
    const decoded = decodeGenerationStreamPayload(
      encodeGenerationStreamPayload(sessionId, data, 42),
    );
    expect(decoded.sessionId).toBe(sessionId);
    expect(decoded.generation).toBe(42);
    expect(Buffer.compare(decoded.data, data)).toBe(0);
  });

  it("preserves generation = 0 (no-gating sentinel)", () => {
    const decoded = decodeGenerationStreamPayload(
      encodeGenerationStreamPayload("s", Buffer.from("x"), 0),
    );
    expect(decoded.generation).toBe(0);
    expect(decoded.data.toString("utf8")).toBe("x");
  });

  it("preserves generation = uint32 max", () => {
    const decoded = decodeGenerationStreamPayload(
      encodeGenerationStreamPayload("s", Buffer.alloc(0), 0xffffffff),
    );
    expect(decoded.generation).toBe(0xffffffff);
  });

  it("composes with FrameParser end-to-end (WRITE frame)", () => {
    const sessionId = "01234567-89ab-cdef-0123-456789abcdef";
    const data = Buffer.from("ls -la\r", "utf8");
    const encoded = encodeFrame({
      type: FrameType.WRITE,
      connectionId: 1,
      generation: 1n,
      requestId: 100,
      payload: encodeGenerationStreamPayload(sessionId, data, 7),
    });
    const parser = new FrameParser();
    const frames = parser.push(encoded);
    expect(frames).toHaveLength(1);
    const decoded = decodeGenerationStreamPayload(frames[0].payload);
    expect(decoded.sessionId).toBe(sessionId);
    expect(decoded.generation).toBe(7);
    expect(decoded.data.toString("utf8")).toBe("ls -la\r");
  });

  it("rejects sessionId longer than 255 bytes", () => {
    expect(() =>
      encodeGenerationStreamPayload("x".repeat(256), Buffer.alloc(0), 0),
    ).toThrow(FrameError);
  });

  it("decodes a payload truncated before the generation field as FRAME_INVALID", () => {
    // idLen=1, sessionId='a', missing 4-byte generation
    const buf = Buffer.from([1, 0x61]);
    expect(() => decodeGenerationStreamPayload(buf)).toThrow(FrameError);
  });
});

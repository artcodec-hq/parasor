import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { validateHelloAck } from "./hello-ack-validator.js";
import { encodeJsonPayload } from "./host-protocol/messages.js";

function encode(obj: unknown): Buffer {
  return encodeJsonPayload(obj);
}

describe("validateHelloAck", () => {
  it("returns ok with stamped id/gen for a matching-version payload", () => {
    const payload = encode({
      protocolVersion: "2.4.0",
      connectionId: 7,
      generation: "42",
      daemonPid: 1234,
      daemonStartedAt: "2026-05-26T00:00:00.000Z",
    });
    const result = validateHelloAck(payload, "2.4.0");
    expect(result).toEqual({ ok: true, connectionId: 7, generation: 42n });
  });

  it("parses large `generation` strings into BigInt without precision loss", () => {
    // u64 above Number.MAX_SAFE_INTEGER (2^53 - 1 = 9_007_199_254_740_991).
    const big = "9223372036854775807"; // 2^63 - 1
    const payload = encode({
      protocolVersion: "2.4.0",
      connectionId: 1,
      generation: big,
      daemonPid: 1,
      daemonStartedAt: "2026-05-26T00:00:00.000Z",
    });
    const result = validateHelloAck(payload, "2.4.0");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.generation).toBe(BigInt(big));
  });

  it("returns frame-invalid on undecodable payload", () => {
    const garbage = Buffer.from([0xff, 0xfe, 0xfd]);
    const result = validateHelloAck(garbage, "2.4.0");
    expect(result).toEqual({
      ok: false,
      code: "frame-invalid",
      message: "HELLO_ACK undecodable",
    });
  });

  it("returns version-mismatch when daemon major differs from ours", () => {
    const payload = encode({
      protocolVersion: "3.0.0",
      connectionId: 1,
      generation: "0",
      daemonPid: 1,
      daemonStartedAt: "2026-05-26T00:00:00.000Z",
    });
    const result = validateHelloAck(payload, "2.4.0");
    expect(result).toEqual({
      ok: false,
      code: "version-mismatch",
      message: "daemon protocol 3.0.0 not compatible with server 2.4.0",
    });
  });

  it("returns version-mismatch when daemon minor is older than ours", () => {
    // isCompatibleVersion: daemon minor must be >= server minor.
    const payload = encode({
      protocolVersion: "2.3.0",
      connectionId: 1,
      generation: "0",
      daemonPid: 1,
      daemonStartedAt: "2026-05-26T00:00:00.000Z",
    });
    const result = validateHelloAck(payload, "2.4.0");
    expect(result).toEqual({
      ok: false,
      code: "version-mismatch",
      message: "daemon protocol 2.3.0 not compatible with server 2.4.0",
    });
  });

  it("accepts a daemon with newer minor (same major)", () => {
    // Forward-compatibility: server should accept daemon with same major
    // but newer minor (by design).
    const payload = encode({
      protocolVersion: "2.5.0",
      connectionId: 9,
      generation: "1",
      daemonPid: 1,
      daemonStartedAt: "2026-05-26T00:00:00.000Z",
    });
    const result = validateHelloAck(payload, "2.4.0");
    expect(result).toEqual({ ok: true, connectionId: 9, generation: 1n });
  });
});

import { describe, expect, it } from "vitest";
import {
  decodeJsonPayload,
  encodeJsonPayload,
  type HelloPayload,
  isCompatibleVersion,
  PROTOCOL_VERSION,
  parseSemver,
} from "./messages.js";

describe("parseSemver", () => {
  it("parses a well-formed version", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("rejects pre-release / build / leading-v / wrong arity", () => {
    expect(parseSemver("v1.2.3")).toBeNull();
    expect(parseSemver("1.2.3-alpha")).toBeNull();
    expect(parseSemver("1.2.3+build.1")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("1.2.3.4")).toBeNull();
  });
});

describe("isCompatibleVersion (by design)", () => {
  it("accepts identical versions", () => {
    expect(isCompatibleVersion("1.0.0", "1.0.0")).toBe(true);
  });

  it("accepts daemon ahead in MINOR (forward-compat)", () => {
    expect(isCompatibleVersion("1.0.0", "1.5.0")).toBe(true);
  });

  it("rejects daemon behind in MINOR (server upgraded first)", () => {
    expect(isCompatibleVersion("1.5.0", "1.0.0")).toBe(false);
  });

  it("rejects MAJOR mismatch in either direction", () => {
    expect(isCompatibleVersion("1.0.0", "2.0.0")).toBe(false);
    expect(isCompatibleVersion("2.0.0", "1.0.0")).toBe(false);
  });

  it("ignores PATCH (always compatible if MAJOR/MINOR match)", () => {
    expect(isCompatibleVersion("1.0.5", "1.0.0")).toBe(true);
    expect(isCompatibleVersion("1.0.0", "1.0.99")).toBe(true);
  });

  it("rejects malformed inputs", () => {
    expect(isCompatibleVersion("garbage", "1.0.0")).toBe(false);
    expect(isCompatibleVersion("1.0.0", "garbage")).toBe(false);
  });
});

describe("PROTOCOL_VERSION", () => {
  it("is 3.0.0 (drops experimental work-item / todo persistence payloads)", () => {
    expect(PROTOCOL_VERSION).toBe("3.0.0");
  });

  // The before the generation gate  rule allowed `daemon.minor ≥ client.minor` so a new
  // server could keep talking to a slightly newer daemon. That rule cannot
  // protect the inverse pairing: an older 1.x server connecting to a 2.0
  // daemon would still send 1.x WRITE frames, and the daemon would mis-parse
  // the leading 4 bytes of `data` as the generation field. Bumping MAJOR is
  // the only direction that rejects every 1.x ↔ 2.x combination at handshake.
  // 3.0.0 repeats that pattern for the work-item / todo payload removal:
  // a 2.x peer that kept talking would adopt `undefined` domain state.
  it("compat: rejects every 1.x daemon (any minor/patch) -- MAJOR mismatch", () => {
    expect(isCompatibleVersion(PROTOCOL_VERSION, "1.0.0")).toBe(false);
    expect(isCompatibleVersion(PROTOCOL_VERSION, "1.1.0")).toBe(false);
    expect(isCompatibleVersion(PROTOCOL_VERSION, "1.2.0")).toBe(false);
    expect(isCompatibleVersion(PROTOCOL_VERSION, "1.3.0")).toBe(false);
    expect(isCompatibleVersion(PROTOCOL_VERSION, "1.99.99")).toBe(false);
  });

  it("compat: rejects every 2.x daemon (any minor/patch) -- MAJOR mismatch", () => {
    expect(isCompatibleVersion(PROTOCOL_VERSION, "2.0.0")).toBe(false);
    expect(isCompatibleVersion(PROTOCOL_VERSION, "2.4.0")).toBe(false);
    expect(isCompatibleVersion(PROTOCOL_VERSION, "2.7.0")).toBe(false);
    expect(isCompatibleVersion(PROTOCOL_VERSION, "2.99.99")).toBe(false);
  });

  it("compat: rejects every 1.x/2.x server pointing at a 3.0 daemon -- MAJOR mismatch (inverse direction the minor rule cannot cover)", () => {
    expect(isCompatibleVersion("1.0.0", PROTOCOL_VERSION)).toBe(false);
    expect(isCompatibleVersion("1.2.0", PROTOCOL_VERSION)).toBe(false);
    expect(isCompatibleVersion("1.3.0", PROTOCOL_VERSION)).toBe(false);
    expect(isCompatibleVersion("2.0.0", PROTOCOL_VERSION)).toBe(false);
    expect(isCompatibleVersion("2.7.0", PROTOCOL_VERSION)).toBe(false);
  });

  it("compat: same major (3.x) still follows the minor rule", () => {
    expect(isCompatibleVersion("3.0.0", PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleVersion("3.0.0", "3.1.0")).toBe(true);
    expect(isCompatibleVersion("3.1.0", "3.0.0")).toBe(false);
    expect(isCompatibleVersion(PROTOCOL_VERSION, "2.7.0")).toBe(false);
  });
});

describe("encodeJsonPayload / decodeJsonPayload round-trip", () => {
  it("preserves a HelloPayload", () => {
    const payload: HelloPayload = {
      protocolVersion: "1.0.0",
      serverPid: 12345,
    };
    const decoded = decodeJsonPayload<HelloPayload>(encodeJsonPayload(payload));
    expect(decoded).toEqual(payload);
  });

  it("preserves stringified bigint generation across HelloAckPayload", () => {
    const payload = {
      protocolVersion: "1.0.0",
      connectionId: 7,
      generation: (2n ** 63n - 1n).toString(),
      daemonPid: 6789,
      daemonStartedAt: "2026-04-28T00:00:00.000Z",
    };
    const decoded = decodeJsonPayload<typeof payload>(
      encodeJsonPayload(payload),
    );
    expect(decoded).toEqual(payload);
    expect(BigInt(decoded.generation)).toBe(2n ** 63n - 1n);
  });
});

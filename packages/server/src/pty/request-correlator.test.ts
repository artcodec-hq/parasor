import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "./host-protocol/frames.js";
import { RequestCorrelator } from "./request-correlator.js";

function frame(requestId: number, type = 1, payload = Buffer.alloc(0)): Frame {
  return { type, connectionId: 0, generation: 0n, requestId, payload };
}

interface SentRecord {
  type: number;
  requestId: number;
  payload: Buffer;
}

function makeCorrelator(opts?: {
  timeoutMs?: number;
  send?: (type: number, requestId: number, payload: Buffer) => void;
}) {
  const sent: SentRecord[] = [];
  const correlator = new RequestCorrelator({
    timeoutMs: opts?.timeoutMs ?? 1000,
    buildTimeoutError: (id, ms) => new Error(`timeout id=${id} ms=${ms}`),
    send:
      opts?.send ??
      ((type, requestId, payload) => {
        sent.push({ type, requestId, payload });
      }),
  });
  return { correlator, sent };
}

describe("RequestCorrelator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("assigns monotonic ids starting at 1 and calls send with that id", () => {
    const { correlator, sent } = makeCorrelator();
    const payload = Buffer.from([1, 2, 3]);
    void correlator.request(0x10, payload);
    void correlator.request(0x11, payload);
    expect(sent.map((s) => s.requestId)).toEqual([1, 2]);
    expect(sent[0]).toEqual({ type: 0x10, requestId: 1, payload });
    expect(sent[1]).toEqual({ type: 0x11, requestId: 2, payload });
  });

  it("ack() resolves the matching pending promise and returns true", async () => {
    const { correlator } = makeCorrelator();
    const promise = correlator.request(0x10, Buffer.alloc(0));
    const reply = frame(1, 0x80);
    expect(correlator.ack(reply)).toBe(true);
    await expect(promise).resolves.toBe(reply);
  });

  it("ack() on a stale (unknown) requestId returns false without throwing", () => {
    const { correlator } = makeCorrelator();
    expect(correlator.ack(frame(999, 0x80))).toBe(false);
  });

  it("nack() rejects the matching pending promise with the supplied error", async () => {
    const { correlator } = makeCorrelator();
    const promise = correlator.request(0x10, Buffer.alloc(0));
    const err = new Error("nack-1");
    expect(correlator.nack(1, err)).toBe(true);
    await expect(promise).rejects.toBe(err);
  });

  it("nack() with requestId=0 returns false without touching pending", async () => {
    const { correlator } = makeCorrelator();
    const promise = correlator.request(0x10, Buffer.alloc(0));
    expect(correlator.nack(0, new Error("conn-level"))).toBe(false);
    // Pending #1 still alive -- ack should succeed.
    const reply = frame(1, 0x80);
    expect(correlator.ack(reply)).toBe(true);
    await expect(promise).resolves.toBe(reply);
  });

  it("nack() on an unknown requestId returns false", () => {
    const { correlator } = makeCorrelator();
    expect(correlator.nack(42, new Error("stale"))).toBe(false);
  });

  it("times out a pending request via buildTimeoutError", async () => {
    const { correlator } = makeCorrelator({ timeoutMs: 100 });
    const promise = correlator.request(0x10, Buffer.alloc(0));
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow(/timeout id=1 ms=100/);
  });

  it("after timeout, a late ACK for the same id is treated as stale", async () => {
    const { correlator } = makeCorrelator({ timeoutMs: 100 });
    const promise = correlator.request(0x10, Buffer.alloc(0));
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow(/timeout/);
    expect(correlator.ack(frame(1, 0x80))).toBe(false);
  });

  it("rejectAll() rejects every pending entry and clears their timers", async () => {
    const { correlator } = makeCorrelator({ timeoutMs: 100 });
    const p1 = correlator.request(0x10, Buffer.alloc(0));
    const p2 = correlator.request(0x11, Buffer.alloc(0));
    const err = new Error("dropped");
    correlator.rejectAll(err);
    await expect(p1).rejects.toBe(err);
    await expect(p2).rejects.toBe(err);
    // After rejectAll, advancing time must not double-reject (timers cleared).
    vi.advanceTimersByTime(1000);
    // ack on a previously-pending id is now a stale no-op.
    expect(correlator.ack(frame(1, 0x80))).toBe(false);
  });

  it("send is called after the pending entry is registered (rejectAll inside send rejects the just-registered promise)", async () => {
    let correlatorRef: RequestCorrelator | null = null;
    const dropError = new Error("write-failed-drop");
    const { correlator } = makeCorrelator({
      send: (_type, _id, _payload) => {
        // Simulate a synchronous wire-write failure that the host would
        // surface by calling handleDrop -> correlator.rejectAll(...).
        correlatorRef?.rejectAll(dropError);
      },
    });
    correlatorRef = correlator;
    await expect(correlator.request(0x10, Buffer.alloc(0))).rejects.toBe(
      dropError,
    );
  });
});

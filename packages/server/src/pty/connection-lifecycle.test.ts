import { describe, expect, it } from "vitest";
import { ConnectionLifecycle } from "./connection-lifecycle.js";

describe("ConnectionLifecycle", () => {
  it("starts in 'connecting' with zero connectionId / generation", () => {
    const lc = new ConnectionLifecycle();
    expect(lc.current).toBe("connecting");
    expect(lc.connectionId).toBe(0);
    expect(lc.generation).toBe(0n);
    expect(lc.isAwaitingHandshake).toBe(true);
    expect(lc.isReady).toBe(false);
    expect(lc.isDropped).toBe(false);
  });

  it("applyHelloAck stamps id/gen and transitions to 'snapshot-pending'", () => {
    const lc = new ConnectionLifecycle();
    expect(lc.applyHelloAck(7, 42n)).toBe(true);
    expect(lc.current).toBe("snapshot-pending");
    expect(lc.connectionId).toBe(7);
    expect(lc.generation).toBe(42n);
    expect(lc.isAwaitingHandshake).toBe(true);
  });

  it("applyHelloAck on a non-'connecting' state is a stale no-op", () => {
    const lc = new ConnectionLifecycle();
    lc.applyHelloAck(1, 1n);
    // Second ack while in 'snapshot-pending' must not overwrite stamps.
    expect(lc.applyHelloAck(2, 2n)).toBe(false);
    expect(lc.connectionId).toBe(1);
    expect(lc.generation).toBe(1n);
    expect(lc.current).toBe("snapshot-pending");
  });

  it("markReady transitions 'snapshot-pending' -> 'ready' and resolves the promise", async () => {
    const lc = new ConnectionLifecycle();
    lc.applyHelloAck(1, 1n);
    expect(lc.markReady()).toBe(true);
    expect(lc.current).toBe("ready");
    expect(lc.isReady).toBe(true);
    expect(lc.isAwaitingHandshake).toBe(false);
    await expect(lc.awaitReady).resolves.toBeUndefined();
  });

  it("markReady on any state other than 'snapshot-pending' returns false", () => {
    const lc = new ConnectionLifecycle();
    // From 'connecting'
    expect(lc.markReady()).toBe(false);
    expect(lc.current).toBe("connecting");
    lc.applyHelloAck(1, 1n);
    lc.markReady();
    // From 'ready'
    expect(lc.markReady()).toBe(false);
  });

  it("drop from 'connecting' rejects handshake with the supplied error", async () => {
    const lc = new ConnectionLifecycle();
    const err = new Error("boom");
    expect(lc.drop(err)).toBe(true);
    expect(lc.current).toBe("dropped");
    await expect(lc.awaitReady).rejects.toBe(err);
  });

  it("drop from 'snapshot-pending' rejects handshake with the supplied error", async () => {
    const lc = new ConnectionLifecycle();
    lc.applyHelloAck(1, 1n);
    const err = new Error("boom");
    expect(lc.drop(err)).toBe(true);
    expect(lc.current).toBe("dropped");
    await expect(lc.awaitReady).rejects.toBe(err);
  });

  it("drop from 'ready' does NOT re-settle the already-resolved handshake", async () => {
    const lc = new ConnectionLifecycle();
    lc.applyHelloAck(1, 1n);
    lc.markReady();
    // Promise is already resolved; capture that before drop().
    await expect(lc.awaitReady).resolves.toBeUndefined();
    const err = new Error("late drop");
    expect(lc.drop(err)).toBe(true);
    expect(lc.current).toBe("dropped");
    // Still resolved (not rejected) -- drop after ready leaves the promise settled.
    await expect(lc.awaitReady).resolves.toBeUndefined();
  });

  it("drop on already-dropped is idempotent (returns false, no double-reject)", async () => {
    const lc = new ConnectionLifecycle();
    const first = new Error("first");
    expect(lc.drop(first)).toBe(true);
    const second = new Error("second");
    expect(lc.drop(second)).toBe(false);
    expect(lc.current).toBe("dropped");
    // Awaiter sees the FIRST error, not the second (Promise idempotent).
    await expect(lc.awaitReady).rejects.toBe(first);
  });

  it("rejectHandshakeOnly rejects without changing state", async () => {
    const lc = new ConnectionLifecycle();
    const err = new Error("daemon-nack");
    lc.rejectHandshakeOnly(err);
    expect(lc.current).toBe("connecting"); // state unchanged
    await expect(lc.awaitReady).rejects.toBe(err);
  });

  it("drop after rejectHandshakeOnly preserves the original rejection error", async () => {
    const lc = new ConnectionLifecycle();
    const daemonErr = new Error("version-mismatch");
    lc.rejectHandshakeOnly(daemonErr);
    const dropErr = new Error("connection-dropped");
    expect(lc.drop(dropErr)).toBe(true);
    expect(lc.current).toBe("dropped");
    // Promise settled with daemonErr on the first reject; the drop's second
    // reject is a no-op. This is the load-bearing invariant that lets the
    // host preserve daemon-specific NACK codes on the connect() awaiter.
    await expect(lc.awaitReady).rejects.toBe(daemonErr);
  });

  it("rejectHandshakeOnly after drop does not change the rejection error", async () => {
    const lc = new ConnectionLifecycle();
    const dropErr = new Error("first");
    lc.drop(dropErr);
    const lateErr = new Error("late");
    lc.rejectHandshakeOnly(lateErr);
    await expect(lc.awaitReady).rejects.toBe(dropErr);
  });
});

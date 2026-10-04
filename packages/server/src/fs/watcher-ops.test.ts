import { afterEach, describe, expect, it } from "vitest";
import { chainWatcherOp } from "./watcher-ops.js";

describe("chainWatcherOp", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  afterEach(() => {
    process.removeListener("unhandledRejection", onUnhandled);
    unhandled.length = 0;
  });

  it("does not unhandled-reject when op rejects and the caller catches next", async () => {
    process.on("unhandledRejection", onUnhandled);
    const ops = new Map<string, Promise<void>>();
    const next = chainWatcherOp(ops, "k", async () => {
      throw new Error("spawn failed");
    });
    await expect(next).rejects.toThrow("spawn failed");
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(unhandled).toEqual([]);
  });

  it("still serializes a later op on the same key after a rejection", async () => {
    process.on("unhandledRejection", onUnhandled);
    const ops = new Map<string, Promise<void>>();
    const order: string[] = [];
    const first = chainWatcherOp(ops, "k", async () => {
      order.push("first");
      throw new Error("boom");
    });
    const second = chainWatcherOp(ops, "k", async () => {
      order.push("second");
    });
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBeUndefined();
    await Promise.resolve();
    expect(order).toEqual(["first", "second"]);
    expect(unhandled).toEqual([]);
  });
});

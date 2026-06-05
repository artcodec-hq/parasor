import { describe, expect, it } from "vitest";
import { HeadlessTerminalStateCache } from "./headless-terminal-state-cache.js";

function makeCache(now: () => number, overrides = {}) {
  return new HeadlessTerminalStateCache({
    cols: 20,
    rows: 2,
    scrollbackLines: 10,
    maxBytes: 1024,
    maxSessions: 2,
    ttlMs: 1000,
    now,
    ...overrides,
  });
}

describe("HeadlessTerminalStateCache", () => {
  it("snapshots incrementally maintained terminal state", async () => {
    let now = 0;
    const cache = makeCache(() => now);

    await cache.write("s1", "plain \x1b[31mred\x1b[0m\r\n");
    now += 10;
    await cache.write("s1", "latest prompt\n");
    const result = await cache.snapshot("s1");

    expect(result?.source).toBe("headless-state");
    expect(result?.snapshot.text).toContain("plain \x1b[31mred\x1b[0m");
    expect(result?.snapshot.text).toContain("latest prompt");
  });

  it("lazy rebuilds a missing state from raw scrollback", async () => {
    const cache = makeCache(() => 0);

    const result = await cache.rebuild(
      "s1",
      "old\r\nplain \x1b[31mred\x1b[0m\r\n",
    );

    expect(result?.source).toBe("headless-rebuild");
    expect(result?.snapshot.text).toContain("plain \x1b[31mred\x1b[0m");
    expect(await cache.snapshot("s1")).toMatchObject({
      source: "headless-state",
    });
  });

  it("can skip creating state for background output before a rebuild", async () => {
    const cache = makeCache(() => 0);

    await expect(cache.writeExisting("s1", "live\n")).resolves.toBe(false);
    expect(await cache.snapshot("s1")).toBeNull();
  });

  it("evicts least recently used states beyond maxSessions", async () => {
    let now = 0;
    const cache = makeCache(() => now);

    await cache.write("s1", "one\n");
    now += 1;
    await cache.write("s2", "two\n");
    now += 1;
    await cache.snapshot("s1");
    now += 1;
    await cache.write("s3", "three\n");

    expect(await cache.snapshot("s1")).not.toBeNull();
    expect(await cache.snapshot("s2")).toBeNull();
    expect(await cache.snapshot("s3")).not.toBeNull();
  });

  it("expires idle states by ttl", async () => {
    let now = 0;
    const cache = makeCache(() => now);

    await cache.write("s1", "one\n");
    now = 1001;

    expect(await cache.snapshot("s1")).toBeNull();
  });

  it("drops incompatible dimensions so callers can rebuild", async () => {
    const cache = makeCache(() => 0);

    await cache.rebuild("s1", "one\n", { cols: 20, rows: 2 });

    expect(await cache.snapshot("s1", { cols: 45, rows: 27 })).toBeNull();
  });
});

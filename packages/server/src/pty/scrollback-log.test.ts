import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScrollbackLog } from "./scrollback-log.js";

describe("ScrollbackLog", () => {
  let dir: string;
  const originalMaxEnv = process.env.PARASOR_SCROLLBACK_MAX_BYTES;
  const originalTailEnv = process.env.PARASOR_SCROLLBACK_TAIL_BYTES;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "parasor-sb-"));
    delete process.env.PARASOR_SCROLLBACK_MAX_BYTES;
    delete process.env.PARASOR_SCROLLBACK_TAIL_BYTES;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalMaxEnv === undefined) {
      delete process.env.PARASOR_SCROLLBACK_MAX_BYTES;
    } else {
      process.env.PARASOR_SCROLLBACK_MAX_BYTES = originalMaxEnv;
    }
    if (originalTailEnv === undefined) {
      delete process.env.PARASOR_SCROLLBACK_TAIL_BYTES;
    } else {
      process.env.PARASOR_SCROLLBACK_TAIL_BYTES = originalTailEnv;
    }
  });

  it("appends data and exposes the tail on read", () => {
    const log = new ScrollbackLog(dir);
    log.append("sess-1", "hello ");
    log.append("sess-1", "world");
    log.flushAll();
    const tail = log.readTail("sess-1");
    expect(tail).toBe("hello world");
  });

  it("returns empty string for unknown session", () => {
    const log = new ScrollbackLog(dir);
    expect(log.readTail("never")).toBe("");
  });

  // scrollback tail regression: `append()` buffers in memory for up to 64 KiB or
  // 100 ms before flushing to disk. A replay path that called
  // `readTail()` without flushing first would miss any append that hit
  // neither threshold (e.g. the auto-resume separator).
  it("readTail flushes the session's pending buffer before reading", () => {
    const log = new ScrollbackLog(dir);
    log.append("sess-pending", "not-yet-flushed");
    // No explicit flushAll() -- readTail must trigger the flush itself.
    expect(log.readTail("sess-pending")).toBe("not-yet-flushed");
  });

  // scrollback tail regression: tail boundary used to land mid-codepoint and emit
  // U+FFFD. readTail now skips leading UTF-8 continuation bytes so the
  // returned string starts at a valid codepoint.
  it("readTail drops orphaned UTF-8 continuation bytes at the tail boundary", () => {
    const log = new ScrollbackLog(dir, { maxBytes: 10_000, tailBytes: 4 });
    // "日本" is 6 UTF-8 bytes (3 + 3). With tailBytes=4 the slice
    // starts at byte index 2, which is a continuation byte of "日".
    // Without the boundary fix the leading byte would decode as U+FFFD.
    log.append("sess-utf8", "日本");
    log.flushAll();
    const tail = log.readTail("sess-utf8");
    expect(tail).toBe("本");
    expect(tail).not.toContain("\uFFFD");
  });

  it("drops content on remove", () => {
    const log = new ScrollbackLog(dir);
    log.append("sess-2", "something");
    log.flushAll();
    log.remove("sess-2");
    expect(log.readTail("sess-2")).toBe("");
  });

  it("rotates when the log exceeds maxBytes, retaining the tail", () => {
    const log = new ScrollbackLog(dir, { maxBytes: 40, tailBytes: 20 });
    // Push enough bytes to trigger rotation on flush.
    log.append("sess-3", "A".repeat(30));
    log.flushAll();
    log.append("sess-3", "B".repeat(30));
    log.flushAll();
    const tail = log.readTail("sess-3");
    expect(tail.length).toBeLessThanOrEqual(20);
    expect(tail).toMatch(/^B+$/);
    // File on disk should also be truncated, not just what readTail returns.
    const onDisk = readFileSync(join(dir, "sessions", "sess-3.log"));
    expect(onDisk.length).toBeLessThanOrEqual(20);
  });

  it("keeps more than the old 256 KiB default before rotating", () => {
    const log = new ScrollbackLog(dir);
    const body = "A".repeat(300 * 1024);
    log.append("sess-default", body);
    log.flushAll();

    const onDisk = readFileSync(join(dir, "sessions", "sess-default.log"));
    expect(onDisk.length).toBe(body.length);
  });

  it("uses environment byte limits when explicit options are absent", () => {
    process.env.PARASOR_SCROLLBACK_MAX_BYTES = "40";
    process.env.PARASOR_SCROLLBACK_TAIL_BYTES = "16";
    const log = new ScrollbackLog(dir);

    log.append("sess-env", "A".repeat(30));
    log.flushAll();
    log.append("sess-env", "B".repeat(30));
    log.flushAll();

    const tail = log.readTail("sess-env");
    expect(tail.length).toBeLessThanOrEqual(16);
    expect(tail).toMatch(/^B+$/);
  });

  it("ignores invalid environment byte limits", () => {
    process.env.PARASOR_SCROLLBACK_MAX_BYTES = "nope";
    process.env.PARASOR_SCROLLBACK_TAIL_BYTES = "-1";
    const log = new ScrollbackLog(dir);
    const body = "A".repeat(300 * 1024);

    log.append("sess-invalid-env", body);
    log.flushAll();

    const onDisk = readFileSync(join(dir, "sessions", "sess-invalid-env.log"));
    expect(onDisk.length).toBe(body.length);
  });

  it("clamps tailBytes to maxBytes when the environment tail is larger", () => {
    process.env.PARASOR_SCROLLBACK_MAX_BYTES = "40";
    process.env.PARASOR_SCROLLBACK_TAIL_BYTES = "80";
    const log = new ScrollbackLog(dir);

    log.append("sess-clamp", "A".repeat(30));
    log.flushAll();
    log.append("sess-clamp", "B".repeat(30));
    log.flushAll();

    const onDisk = readFileSync(join(dir, "sessions", "sess-clamp.log"));
    expect(onDisk.length).toBeLessThanOrEqual(40);
  });
});

/*
 * -- chunk ring behavior. Independent of the on-disk log,
 * but lives on the same class so the chunked replay path can co-locate
 * with the existing tail-fallback path.
 */
describe("ScrollbackLog chunk ring", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "parasor-sb-ring-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("assigns seq monotonically within a generation", () => {
    const log = new ScrollbackLog(dir);
    expect(log.appendChunk("s", 1, Buffer.from("a"))).toBe(0n);
    expect(log.appendChunk("s", 1, Buffer.from("b"))).toBe(1n);
    expect(log.appendChunk("s", 1, Buffer.from("c"))).toBe(2n);
    expect(log.ringState("s", 1)).toEqual({
      generation: 1,
      lastDeliveredSeq: 2n,
      oldestSeq: 0n,
    });
  });

  it("resets seq to 0 when generation bumps", () => {
    const log = new ScrollbackLog(dir);
    log.appendChunk("s", 1, Buffer.from("a"));
    log.appendChunk("s", 1, Buffer.from("b"));
    log.bumpGeneration("s", 2);
    expect(log.appendChunk("s", 2, Buffer.from("c"))).toBe(0n);
    expect(log.ringState("s", 2)).toEqual({
      generation: 2,
      lastDeliveredSeq: 0n,
      oldestSeq: 0n,
    });
  });

  it("evicts oldest chunks when totalBytes exceeds inMemoryChunkBudget", () => {
    const log = new ScrollbackLog(dir, { inMemoryChunkBudget: 10 });
    // Each chunk = 4 bytes. Pushing 4 chunks = 16 bytes total.
    // Budget is 10, so first chunks get evicted.
    log.appendChunk("s", 1, Buffer.alloc(4));
    log.appendChunk("s", 1, Buffer.alloc(4));
    log.appendChunk("s", 1, Buffer.alloc(4));
    log.appendChunk("s", 1, Buffer.alloc(4));
    const state = log.ringState("s", 1);
    expect(state.lastDeliveredSeq).toBe(3n);
    // Eviction is "while totalBytes > budget && chunks.length > 1" -- drops
    // seq 0 and 1 to bring total to 8 bytes (≤10).
    expect(state.oldestSeq).not.toBeNull();
    expect((state.oldestSeq as bigint) > 0n).toBe(true);
  });

  it("readSince returns 'none' when client has no lastSeen", () => {
    const log = new ScrollbackLog(dir);
    log.appendChunk("s", 1, Buffer.from("a"));
    expect(log.readSince("s", undefined)).toEqual({ kind: "none" });
  });

  it("readSince returns 'full' on generation mismatch", () => {
    const log = new ScrollbackLog(dir);
    log.appendChunk("s", 2, Buffer.from("a"));
    expect(log.readSince("s", { generation: 1, seq: 0n })).toEqual({
      kind: "full",
    });
  });

  it("readSince returns 'full' when there is a gap between client and ring", () => {
    const log = new ScrollbackLog(dir, { inMemoryChunkBudget: 4 });
    // Each append (4 bytes) evicts the previous one -- ring keeps only the
    // newest chunk. After 3 appends: chunks=[{seq:2n}], oldest=2n.
    // Client at seq=0 missed seq=1 (evicted) -> full replay required.
    log.appendChunk("s", 1, Buffer.alloc(4)); // seq 0
    log.appendChunk("s", 1, Buffer.alloc(4)); // seq 1, evicts 0
    log.appendChunk("s", 1, Buffer.alloc(4)); // seq 2, evicts 1
    expect(log.readSince("s", { generation: 1, seq: 0n })).toEqual({
      kind: "full",
    });
  });

  it("readSince returns 'delta' with chunks after lastSeen", () => {
    const log = new ScrollbackLog(dir);
    log.appendChunk("s", 1, Buffer.from("a"));
    log.appendChunk("s", 1, Buffer.from("b"));
    log.appendChunk("s", 1, Buffer.from("c"));
    const result = log.readSince("s", { generation: 1, seq: 0n });
    expect(result.kind).toBe("delta");
    if (result.kind !== "delta") return;
    expect(result.chunks.map((c) => c.seq)).toEqual([1n, 2n]);
  });

  it("readSince returns 'none' when client is already at current head", () => {
    const log = new ScrollbackLog(dir);
    log.appendChunk("s", 1, Buffer.from("a"));
    log.appendChunk("s", 1, Buffer.from("b"));
    expect(log.readSince("s", { generation: 1, seq: 1n })).toEqual({
      kind: "none",
    });
  });

  it("remove() drops the in-memory ring", () => {
    const log = new ScrollbackLog(dir);
    log.appendChunk("s", 1, Buffer.from("a"));
    log.remove("s");
    expect(log.ringState("s", 5)).toEqual({
      generation: 5,
      lastDeliveredSeq: null,
      oldestSeq: null,
    });
  });
});

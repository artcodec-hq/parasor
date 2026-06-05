import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TAIL_BYTES = 4 * 1024 * 1024;
const FLUSH_INTERVAL_MS = 100;
const FLUSH_THRESHOLD_BYTES = 64 * 1024;

const DEFAULT_IN_MEMORY_CHUNK_BUDGET_BYTES = 1 * 1024 * 1024;

/**
 * Drop a leading run of UTF-8 continuation bytes (`10xx_xxxx`) from a
 * tail slice. Without this, a tail boundary landing in the middle of a
 * multi-byte sequence would decode the orphaned continuation bytes as
 * U+FFFD. The first valid UTF-8 start byte is either ASCII (0xxxxxxx)
 * or a leading byte (11xxxxxx); we scan at most 3 bytes (max multi-byte
 * tail prefix length).
 */
function decodeFromUtf8Boundary(slice: Buffer): string {
  let i = 0;
  while (i < slice.length && i < 3 && (slice[i] & 0xc0) === 0x80) i++;
  return slice.subarray(i).toString("utf8");
}

function readPositiveIntegerEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

interface ScrollbackLogOptions {
  maxBytes?: number;
  tailBytes?: number;
  /**
   * Per-session in-memory chunk ring budget for delta replay
   *. Disk persistence is unchanged. Override
   * via the `PARASOR_IN_MEMORY_CHUNK_BUDGET` env elsewhere.
   */
  inMemoryChunkBudget?: number;
}

interface PendingBuffer {
  chunks: Buffer[];
  size: number;
  timer: NodeJS.Timeout | null;
}

export interface ChunkRecord {
  seq: bigint;
  data: Buffer;
}

interface ChunkRing {
  generation: number;
  /**
   * Monotonic seq counter for the next chunk to allocate. Resets to 0n
   * on `bumpGeneration`. uint64 (BigInt) -- overflow is not a practical
   * concern (1.8e19 chunks ≈ 580 years at 1 chunk/ns).
   */
  nextSeq: bigint;
  chunks: ChunkRecord[];
  totalBytes: number;
}

/**
 * Result of `readSince`.
 *
 * - `delta`: chunk ring contains every seq after `lastSeen`.
 *   Sender writes the binary OUTPUTs, no JSON replay needed.
 * - `full`: ring evicted before `lastSeen` OR generation mismatch.
 *   Sender flushes the disk tail via `readTail()` then resumes from
 *   the current seq.
 * - `none`: client has no `lastSeen`, OR ring is empty (fresh PTY).
 *   Sender skips replay entirely; live OUTPUT will deliver everything.
 */
export type ReadSinceResult =
  | { kind: "delta"; chunks: ChunkRecord[] }
  | { kind: "full" }
  | { kind: "none" };

/**
 * Per-session append-only log for scrollback. Writes are buffered (flush
 * on 64KB or 100ms) to keep onData hot-paths cheap. When a file exceeds
 * `maxBytes` it is truncated to the last `tailBytes` -- good-enough to give
 * users visual continuity after a server restart without unbounded growth.
 *
 *  added an in-memory chunk ring on top of the same
 * structure: each broadcast writes one chunk via `appendChunk` so a
 * reconnecting client with a `lastSeen: {generation, seq}` can be
 * served just the missing chunks ("delta") rather than the full tail.
 * The disk file remains the canonical fallback (`readTail()`) for cases
 * where the ring evicted before `lastSeen` or generations diverge.
 */
export class ScrollbackLog {
  private readonly dir: string;
  private readonly maxBytes: number;
  private readonly tailBytes: number;
  private readonly inMemoryBudget: number;
  private readonly buffers = new Map<string, PendingBuffer>();
  private readonly rings = new Map<string, ChunkRing>();

  constructor(configDir: string, options: ScrollbackLogOptions = {}) {
    this.dir = join(configDir, "sessions");
    this.maxBytes =
      options.maxBytes ??
      readPositiveIntegerEnv("PARASOR_SCROLLBACK_MAX_BYTES") ??
      DEFAULT_MAX_BYTES;
    this.tailBytes = Math.min(
      options.tailBytes ??
        readPositiveIntegerEnv("PARASOR_SCROLLBACK_TAIL_BYTES") ??
        DEFAULT_TAIL_BYTES,
      this.maxBytes,
    );
    const envBudget = Number(process.env.PARASOR_IN_MEMORY_CHUNK_BUDGET);
    this.inMemoryBudget =
      options.inMemoryChunkBudget ??
      (Number.isFinite(envBudget) && envBudget > 0
        ? envBudget
        : DEFAULT_IN_MEMORY_CHUNK_BUDGET_BYTES);
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      // best-effort -- appends will fail later but won't crash the server
    }
  }

  /**
   * Enqueue data for the given session. Buffers in memory; flushes on
   * timer or threshold. Safe to call from every onData.
   */
  append(sessionId: string, data: string): void {
    const buf = Buffer.from(data, "utf8");
    let pending = this.buffers.get(sessionId);
    if (!pending) {
      pending = { chunks: [], size: 0, timer: null };
      this.buffers.set(sessionId, pending);
    }
    pending.chunks.push(buf);
    pending.size += buf.length;

    if (pending.size >= FLUSH_THRESHOLD_BYTES) {
      this.flushSession(sessionId);
      return;
    }
    if (!pending.timer) {
      pending.timer = setTimeout(
        () => this.flushSession(sessionId),
        FLUSH_INTERVAL_MS,
      );
    }
  }

  /**
   * Synchronously flush all pending buffers to disk. Called on graceful
   * shutdown so no outstanding writes are lost.
   */
  flushAll(): void {
    for (const id of [...this.buffers.keys()]) {
      this.flushSession(id);
    }
  }

  /**
   * Return the tail of the log for a session, if any. Used to rehydrate
   * xterm scrollback after a server restart, and as the `replay:"full"`
   * fallback in chunked replay.
   *
   * Flushes the session's pending append buffer synchronously before
   * reading so callers see every byte already passed to `append()`.
   * Without this, the 64 KiB / 100 ms write coalescing window would
   * leak into the replay (e.g. the auto-resume separator appended in
   * the same attach turn would be missing from the snapshot).
   */
  readTail(sessionId: string): string {
    this.flushSession(sessionId);
    const path = this.pathFor(sessionId);
    if (!existsSync(path)) return "";
    try {
      const buf = readFileSync(path);
      if (buf.length <= this.tailBytes) return buf.toString("utf8");
      return decodeFromUtf8Boundary(buf.subarray(buf.length - this.tailBytes));
    } catch {
      return "";
    }
  }

  /**
   * Append a binary chunk to the in-memory ring and return the assigned
   * seq. the daemon shutdown contract-- caller passes the live PTY generation; if
   * it doesn't match the ring's generation the ring is reset so we
   * never emit (gen, seq) pairs that overlap a previous epoch.
   *
   * `seq` is uint64 (BigInt). Overflow is not handled because 1.8e19
   * chunks is unreachable in practice -- a malicious client cannot
   * influence chunk-allocation rate (chunks come from PTY output, not
   * client input), and even at 1 chunk/ns we'd need 580 years.
   */
  appendChunk(sessionId: string, generation: number, data: Buffer): bigint {
    let ring = this.rings.get(sessionId);
    if (!ring || ring.generation !== generation) {
      ring = {
        generation,
        nextSeq: 0n,
        chunks: [],
        totalBytes: 0,
      };
      this.rings.set(sessionId, ring);
    }
    const seq = ring.nextSeq;
    ring.nextSeq = seq + 1n;
    ring.chunks.push({ seq, data });
    ring.totalBytes += data.length;
    while (ring.totalBytes > this.inMemoryBudget && ring.chunks.length > 1) {
      const evicted = ring.chunks.shift();
      if (evicted) ring.totalBytes -= evicted.data.length;
    }
    return seq;
  }

  /**
   * Bump generation: PTY respawn (`restart`). Resets seq to 0n and
   * drops the in-memory ring -- disk persistence is untouched so a
   * concurrent reconnect still has a fallback path.
   */
  bumpGeneration(sessionId: string, newGeneration: number): void {
    this.rings.set(sessionId, {
      generation: newGeneration,
      nextSeq: 0n,
      chunks: [],
      totalBytes: 0,
    });
  }

  /**
   * Current ring snapshot -- used for init-ack `serverState`. Returns
   * `null` for `lastDeliveredSeq` / `oldestSeq` when the ring is empty
   * (fresh session, no broadcast yet) so the client can distinguish
   * "no chunks ever" from "chunk 0 was the last one".
   */
  ringState(
    sessionId: string,
    fallbackGeneration: number,
  ): {
    generation: number;
    lastDeliveredSeq: bigint | null;
    oldestSeq: bigint | null;
  } {
    const ring = this.rings.get(sessionId);
    if (!ring) {
      return {
        generation: fallbackGeneration,
        lastDeliveredSeq: null,
        oldestSeq: null,
      };
    }
    if (ring.chunks.length === 0) {
      return {
        generation: ring.generation,
        lastDeliveredSeq: null,
        oldestSeq: null,
      };
    }
    return {
      generation: ring.generation,
      lastDeliveredSeq: ring.nextSeq - 1n,
      oldestSeq: ring.chunks[0]?.seq ?? null,
    };
  }

  /**
   * Decide replay strategy for a reconnecting client.
   *
   * - no ring + lastSeen -> `full` (server restart, client has cursor)
   * - no ring + no lastSeen -> `none`
   * - generation mismatch -> `full`
   * - lastSeen.seq < oldestSeq (evicted) -> `full`
   * - lastSeen.seq >= nextSeq - 1 (already saw current) -> `none`
   * - otherwise -> `delta` with the chunks where seq > lastSeen.seq
   */
  readSince(
    sessionId: string,
    lastSeen: { generation: number; seq: bigint } | undefined,
  ): ReadSinceResult {
    const ring = this.rings.get(sessionId);
    if (!ring) return lastSeen ? { kind: "full" } : { kind: "none" };
    if (!lastSeen) return { kind: "none" };
    if (lastSeen.generation !== ring.generation) return { kind: "full" };
    if (lastSeen.seq >= ring.nextSeq - 1n) return { kind: "none" };
    const oldest = ring.chunks[0]?.seq;
    if (oldest === undefined) return { kind: "none" };
    if (lastSeen.seq < oldest - 1n) return { kind: "full" };
    const startIdx = ring.chunks.findIndex((c) => c.seq > lastSeen.seq);
    if (startIdx < 0) return { kind: "none" };
    return { kind: "delta", chunks: ring.chunks.slice(startIdx) };
  }

  /**
   * Delete a session's log file and drop any pending buffer. Called when
   * the user explicitly closes a session (dispose).
   */
  remove(sessionId: string): void {
    const pending = this.buffers.get(sessionId);
    if (pending?.timer) clearTimeout(pending.timer);
    this.buffers.delete(sessionId);
    this.rings.delete(sessionId);
    const path = this.pathFor(sessionId);
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // ignore
    }
  }

  private pathFor(sessionId: string): string {
    return join(this.dir, `${sessionId}.log`);
  }

  private flushSession(sessionId: string): void {
    const pending = this.buffers.get(sessionId);
    if (!pending || pending.chunks.length === 0) return;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    const merged = Buffer.concat(pending.chunks, pending.size);
    pending.chunks = [];
    pending.size = 0;

    const path = this.pathFor(sessionId);
    let fd: number | null = null;
    try {
      fd = openSync(path, "a");
      writeSync(fd, merged);
    } catch {
      // best-effort; drop this chunk so we don't retry endlessly
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
      }
    }

    this.rotateIfNeeded(path);
  }

  private rotateIfNeeded(path: string): void {
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return;
    }
    if (size <= this.maxBytes) return;
    // Partial read: only pull the last `tailBytes` off disk instead of
    // loading the full 8 MiB file into memory. The trim is always a
    // strict suffix because size > maxBytes >= tailBytes.
    const tail = Buffer.alloc(this.tailBytes);
    let srcFd: number | null = null;
    try {
      srcFd = openSync(path, "r");
      let read = 0;
      while (read < this.tailBytes) {
        const n = readSync(
          srcFd,
          tail,
          read,
          this.tailBytes - read,
          size - this.tailBytes + read,
        );
        if (n === 0) break;
        read += n;
      }
      const trimmed = read === this.tailBytes ? tail : tail.subarray(0, read);
      const tmp = `${path}.tmp`;
      // Write tail to tmp, rename over original -- atomic-ish truncation.
      const dstFd = openSync(tmp, "w");
      try {
        writeSync(dstFd, trimmed);
      } finally {
        closeSync(dstFd);
      }
      renameSync(tmp, path);
    } catch {
      // Fallback: truncate to zero so we don't grow unbounded on failure.
      try {
        truncateSync(path, 0);
      } catch {
        // ignore
      }
    } finally {
      if (srcFd !== null) {
        try {
          closeSync(srcFd);
        } catch {
          // ignore
        }
      }
    }
  }
}

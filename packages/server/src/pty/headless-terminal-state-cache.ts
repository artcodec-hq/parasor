import { Buffer } from "node:buffer";
import {
  type HeadlessReplaySnapshot,
  type HeadlessReplaySnapshotOptions,
  HeadlessTerminalState,
} from "./headless-replay-snapshot.js";

export type HeadlessStateSnapshotSource = "headless-state" | "headless-rebuild";

export interface HeadlessTerminalStateCacheOptions
  extends HeadlessReplaySnapshotOptions {
  maxSessions: number;
  ttlMs: number;
  now?: () => number;
}

export interface HeadlessStateSnapshot {
  source: HeadlessStateSnapshotSource;
  snapshot: HeadlessReplaySnapshot;
  cols: number;
  rows: number;
}

interface CacheEntry {
  state: HeadlessTerminalState;
  lastUsedAt: number;
  cols: number;
  rows: number;
}

function clampPositiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export class HeadlessTerminalStateCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly stateOptions: HeadlessReplaySnapshotOptions;

  constructor(options: HeadlessTerminalStateCacheOptions) {
    this.maxSessions = clampPositiveInteger(options.maxSessions, 8);
    this.ttlMs = clampPositiveInteger(options.ttlMs, 10 * 60_000);
    this.now = options.now ?? (() => Date.now());
    this.stateOptions = {
      cols: options.cols,
      rows: options.rows,
      scrollbackLines: options.scrollbackLines,
      maxBytes: options.maxBytes,
    };
  }

  size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  delete(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  clear(): void {
    this.entries.clear();
  }

  async write(sessionId: string, data: string): Promise<void> {
    const entry = this.touch(sessionId);
    await entry.state.write(data);
  }

  async writeExisting(sessionId: string, data: string): Promise<boolean> {
    this.pruneExpired();
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    entry.lastUsedAt = this.now();
    await entry.state.write(data);
    return true;
  }

  async resizeExisting(
    sessionId: string,
    dimensions: Pick<HeadlessReplaySnapshotOptions, "cols" | "rows">,
  ): Promise<boolean> {
    this.pruneExpired();
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    entry.lastUsedAt = this.now();
    entry.cols = dimensions.cols;
    entry.rows = dimensions.rows;
    await entry.state.resize(dimensions.cols, dimensions.rows);
    return true;
  }

  async snapshot(
    sessionId: string,
    dimensions?: Pick<HeadlessReplaySnapshotOptions, "cols" | "rows">,
  ): Promise<HeadlessStateSnapshot | null> {
    this.pruneExpired();
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    if (
      dimensions &&
      (entry.cols !== dimensions.cols || entry.rows !== dimensions.rows)
    ) {
      this.entries.delete(sessionId);
      return null;
    }
    entry.lastUsedAt = this.now();
    const snapshot = await entry.state.snapshot();
    return {
      source: "headless-state",
      snapshot,
      cols: entry.cols,
      rows: entry.rows,
    };
  }

  async rebuild(
    sessionId: string,
    raw: string,
    dimensions?: Pick<HeadlessReplaySnapshotOptions, "cols" | "rows">,
  ): Promise<HeadlessStateSnapshot | null> {
    if (Buffer.byteLength(raw, "utf8") === 0) return null;
    const entry = this.replace(sessionId, dimensions);
    await entry.state.write(raw);
    const snapshot = await entry.state.snapshot();
    return {
      source: "headless-rebuild",
      snapshot,
      cols: entry.cols,
      rows: entry.rows,
    };
  }

  private touch(sessionId: string): CacheEntry {
    this.pruneExpired();
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastUsedAt = this.now();
      return existing;
    }
    return this.replace(sessionId);
  }

  private replace(
    sessionId: string,
    dimensions?: Pick<HeadlessReplaySnapshotOptions, "cols" | "rows">,
  ): CacheEntry {
    const stateOptions = {
      ...this.stateOptions,
      ...dimensions,
    };
    const entry: CacheEntry = {
      state: new HeadlessTerminalState(stateOptions),
      lastUsedAt: this.now(),
      cols: stateOptions.cols,
      rows: stateOptions.rows,
    };
    this.entries.set(sessionId, entry);
    this.evictOverflow();
    return entry;
  }

  private pruneExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [sessionId, entry] of this.entries) {
      if (entry.lastUsedAt < cutoff) this.entries.delete(sessionId);
    }
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxSessions) {
      let oldestSessionId: string | null = null;
      let oldestLastUsedAt = Number.POSITIVE_INFINITY;
      for (const [sessionId, entry] of this.entries) {
        if (entry.lastUsedAt < oldestLastUsedAt) {
          oldestSessionId = sessionId;
          oldestLastUsedAt = entry.lastUsedAt;
        }
      }
      if (!oldestSessionId) return;
      this.entries.delete(oldestSessionId);
    }
  }
}

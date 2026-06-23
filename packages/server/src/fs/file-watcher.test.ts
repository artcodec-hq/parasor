import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FileChangeBatch, FileWatcher } from "./file-watcher.js";

type WatchEvent = {
  type: "create" | "update" | "delete";
  path: string;
};

const watcherMock = vi.hoisted(() => ({
  callback: null as null | ((err: Error | null, events: WatchEvent[]) => void),
  unsubscribeCalls: 0,
  subscribeError: null as Error | null,
}));

vi.mock("@parcel/watcher", () => ({
  subscribe: async (
    _root: string,
    callback: (err: Error | null, events: WatchEvent[]) => void,
  ) => {
    if (watcherMock.subscribeError) throw watcherMock.subscribeError;
    watcherMock.callback = callback;
    return {
      unsubscribe: async () => {
        watcherMock.unsubscribeCalls += 1;
      },
    };
  },
}));

function emit(event: WatchEvent) {
  if (!watcherMock.callback) throw new Error("watcher not started");
  watcherMock.callback(null, [event]);
}

function emitMany(events: WatchEvent[]) {
  if (!watcherMock.callback) throw new Error("watcher not started");
  watcherMock.callback(null, events);
}

describe("FileWatcher", () => {
  let root: string;

  beforeEach(() => {
    vi.useFakeTimers();
    watcherMock.callback = null;
    watcherMock.unsubscribeCalls = 0;
    watcherMock.subscribeError = null;
    root = join(tmpdir(), `parasor-watch-test-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    root = realpathSync(root);
    writeFileSync(join(root, "existing.txt"), "hello");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("emits create event on file add", async () => {
    const batches: FileChangeBatch[] = [];
    const watcher = new FileWatcher(root, (batch) => batches.push(batch));
    await watcher.start();

    writeFileSync(join(root, "new.txt"), "new content");
    emit({ type: "create", path: join(root, "new.txt") });
    await vi.advanceTimersByTimeAsync(151);
    await watcher.stop();

    const addEvent = batches[0]?.events.find(
      (e) => e.path === "new.txt" && e.event === "create",
    );
    expect(addEvent).toBeDefined();
    expect(batches[0]?.count).toBe(1);
  });

  it("emits update event on file modify", async () => {
    const batches: FileChangeBatch[] = [];
    const watcher = new FileWatcher(root, (batch) => batches.push(batch));
    await watcher.start();

    writeFileSync(join(root, "existing.txt"), "modified");
    emit({ type: "update", path: join(root, "existing.txt") });
    await vi.advanceTimersByTimeAsync(151);
    await watcher.stop();

    const changeEvent = batches[0]?.events.find(
      (e) => e.path === "existing.txt" && e.event === "update",
    );
    expect(changeEvent).toBeDefined();
  });

  it("batches multiple file events into one callback", async () => {
    const batches: FileChangeBatch[] = [];
    const watcher = new FileWatcher(root, (batch) => batches.push(batch));
    await watcher.start();

    emitMany([
      { type: "create", path: join(root, "a.txt") },
      { type: "update", path: join(root, "existing.txt") },
    ]);
    await vi.advanceTimersByTimeAsync(151);
    await watcher.stop();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      overflow: false,
      count: 2,
      events: [
        { event: "create", path: "a.txt" },
        { event: "update", path: "existing.txt" },
      ],
    });
  });

  it("emits a single overflow batch for very large event bursts", async () => {
    const batches: FileChangeBatch[] = [];
    const watcher = new FileWatcher(root, (batch) => batches.push(batch));
    await watcher.start();

    emitMany(
      Array.from({ length: 5001 }, () => ({
        type: "update",
        path: join(root, "existing.txt"),
      })),
    );
    await vi.advanceTimersByTimeAsync(151);
    await watcher.stop();

    expect(batches).toEqual([{ events: [], overflow: true, count: 5001 }]);
  });

  it("ignores .git directory changes", async () => {
    mkdirSync(join(root, ".git"), { recursive: true });

    const batches: FileChangeBatch[] = [];
    const watcher = new FileWatcher(root, (batch) => batches.push(batch));
    await watcher.start();

    writeFileSync(join(root, ".git", "COMMIT_EDITMSG"), "data");
    emit({ type: "create", path: join(root, ".git", "COMMIT_EDITMSG") });
    await vi.advanceTimersByTimeAsync(151);
    await watcher.stop();

    const gitEvents = batches.flatMap((batch) =>
      batch.events.filter((e) => e.path.startsWith(".git")),
    );
    expect(gitEvents).toHaveLength(0);
  });

  it("notifies on .gitignore change", async () => {
    let gitignoreChanged = false;
    const watcher = new FileWatcher(
      root,
      () => {},
      () => {
        gitignoreChanged = true;
      },
    );
    await watcher.start();

    writeFileSync(join(root, ".gitignore"), "dist\n");
    emit({ type: "create", path: join(root, ".gitignore") });
    await vi.advanceTimersByTimeAsync(301);
    await watcher.stop();

    expect(gitignoreChanged).toBe(true);
  });

  it("does not throw when the native watcher cannot start", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    watcherMock.subscribeError = new Error("Error starting FSEvents stream");
    const watcher = new FileWatcher(root, () => {});

    try {
      await expect(watcher.start()).resolves.toBeUndefined();
      await expect(watcher.stop()).resolves.toBeUndefined();

      expect(watcherMock.callback).toBeNull();
      expect(watcherMock.unsubscribeCalls).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("File watching disabled"),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

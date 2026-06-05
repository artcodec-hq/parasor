/*
 * -- auto-spawn unit test. Real spawn / connect
 * are blocked under macOS sandbox-exec, so we drive the function with
 * the spawnFn / probeFn / sleepFn seams. The tests verify:
 *   1. `existsSync` guard on missing entry script throws DaemonSpawnError.
 *   2. Successful spawn + probe-true short-circuits the polling loop.
 *   3. Probe-false until deadline raises a timeout DaemonSpawnError that
 *      mentions the log file path so users know where to look.
 *   4. spawnFn throwing synchronously is wrapped, not propagated raw.
 */

import type {
  ChildProcessWithoutNullStreams,
  spawn as nodeSpawn,
} from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonPaths } from "./paths.js";
import { DaemonSpawnError, spawnDaemon } from "./spawn-daemon.js";

type SpawnFn = typeof nodeSpawn;

function makeSpawnResult(): ChildProcessWithoutNullStreams {
  return {
    unref: vi.fn(),
    once: vi.fn(),
    pid: 12345,
  } as unknown as ChildProcessWithoutNullStreams;
}

function makePaths(root: string): DaemonPaths {
  return {
    runtimeDir: root,
    socketPath: join(root, "p.sock"),
    pidFile: join(root, "p.pid"),
    lockFile: join(root, "p.lock"),
    logFile: join(root, "p.log"),
  };
}

describe("spawnDaemon", () => {
  let root: string;
  let entry: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "spawn-daemon-"));
    entry = join(root, "entry.js");
    writeFileSync(entry, "// fake daemon entry\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("throws DaemonSpawnError when entry script is missing", async () => {
    await expect(
      spawnDaemon({
        paths: makePaths(root),
        entryScriptPath: join(root, "does-not-exist.js"),
        // Intentionally no spawnFn -- should fail before reaching it.
      }),
    ).rejects.toBeInstanceOf(DaemonSpawnError);
  });

  it("returns once the probe reports the socket is ready", async () => {
    const spawnSpy = vi.fn(() => makeSpawnResult());
    const probeSpy = vi.fn(() => Promise.resolve(true));
    const sleepSpy = vi.fn(() => Promise.resolve());

    await spawnDaemon({
      paths: makePaths(root),
      entryScriptPath: entry,
      spawnFn: spawnSpy as unknown as SpawnFn,
      probeFn: probeSpy,
      sleepFn: sleepSpy,
      startupTimeoutMs: 1000,
    });

    expect(spawnSpy).toHaveBeenCalledOnce();
    expect(probeSpy).toHaveBeenCalled();
    // Probe true on first call -> no sleep needed.
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it("throws timeout DaemonSpawnError when the probe never succeeds", async () => {
    const spawnSpy = vi.fn(() => makeSpawnResult());
    const probeSpy = vi.fn(() => Promise.resolve(false));
    // Fake clock: each sleep call advances Date.now() by the requested ms.
    const realNow = Date.now;
    let virtualTime = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => virtualTime);
    const sleepSpy = vi.fn((ms: number) => {
      virtualTime += ms;
      return Promise.resolve();
    });

    await expect(
      spawnDaemon({
        paths: makePaths(root),
        entryScriptPath: entry,
        spawnFn: spawnSpy as unknown as SpawnFn,
        probeFn: probeSpy,
        sleepFn: sleepSpy,
        startupTimeoutMs: 500,
      }),
    ).rejects.toThrow(/did not become ready within 500ms/);

    // Error message should mention the log file for debugging.
    try {
      await spawnDaemon({
        paths: makePaths(root),
        entryScriptPath: entry,
        spawnFn: spawnSpy as unknown as SpawnFn,
        probeFn: probeSpy,
        sleepFn: sleepSpy,
        startupTimeoutMs: 100,
      });
    } catch (err) {
      expect((err as Error).message).toContain("p.log");
    }

    vi.restoreAllMocks();
  });

  it("wraps spawnFn synchronous throws in DaemonSpawnError", async () => {
    const spawnSpy = vi.fn(() => {
      throw new Error("EACCES: permission denied");
    });

    await expect(
      spawnDaemon({
        paths: makePaths(root),
        entryScriptPath: entry,
        spawnFn: spawnSpy as unknown as SpawnFn,
      }),
    ).rejects.toMatchObject({
      name: "DaemonSpawnError",
      message: expect.stringMatching(/EACCES/),
    });
  });
});

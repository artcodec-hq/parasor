import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireDaemonLock, DaemonAlreadyRunningError } from "./lockfile.js";
import type { DaemonPaths } from "./paths.js";

function paths(root: string): DaemonPaths {
  return {
    runtimeDir: root,
    socketPath: join(root, "p.sock"),
    pidFile: join(root, "p.pid"),
    lockFile: join(root, "p.lock"),
    logFile: join(root, "p.log"),
  };
}

describe("acquireDaemonLock", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lockfile-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("acquires lock on first call and writes pid", async () => {
    const lock = await acquireDaemonLock(paths(root), 12345);
    try {
      expect(existsSync(paths(root).pidFile)).toBe(true);
      expect(readFileSync(paths(root).pidFile, "utf8").trim()).toBe("12345");
    } finally {
      await lock.release();
    }
  });

  it("rejects second concurrent acquire with DaemonAlreadyRunningError", async () => {
    const lock1 = await acquireDaemonLock(paths(root), process.pid);
    try {
      await expect(
        acquireDaemonLock(paths(root), process.pid + 1),
      ).rejects.toBeInstanceOf(DaemonAlreadyRunningError);
    } finally {
      await lock1.release();
    }
  });

  it("takes over after a previous holder releases", async () => {
    const lock1 = await acquireDaemonLock(paths(root), 999);
    await lock1.release();
    const lock2 = await acquireDaemonLock(paths(root), 1000);
    try {
      expect(readFileSync(paths(root).pidFile, "utf8").trim()).toBe("1000");
    } finally {
      await lock2.release();
    }
  });

  it("treats a stale pidfile (no flock, dead pid) as available", async () => {
    // Simulate a previous daemon that died: pidfile exists pointing at a
    // non-existent pid, but no flock is held.
    writeFileSync(paths(root).pidFile, "1\n"); // pid=1 = init, kill 0 succeeds
    // Pid=1 is alive on every Unix -- so we instead write a guaranteed-dead pid.
    writeFileSync(paths(root).pidFile, "2147483646\n");

    const lock = await acquireDaemonLock(paths(root), process.pid);
    try {
      expect(readFileSync(paths(root).pidFile, "utf8").trim()).toBe(
        String(process.pid),
      );
    } finally {
      await lock.release();
    }
  });

  it("accepts a stale pidfile pointing at a recycled-but-live pid (flock is the source of truth)", async () => {
    // Real-world failure mode: a previous daemon died ungracefully (e.g.
    // SIGKILL) and the OS handed its pid to an unrelated process before
    // the proper-lockfile stale-timeout fired. The pidfile still points
    // at that pid (now alive but unrelated). the
    // earlier post-flock recheck would spuriously reject in this case;
    // since flock cleared, we MUST proceed.
    writeFileSync(paths(root).pidFile, `${process.pid}\n`);
    const lock = await acquireDaemonLock(paths(root), process.pid + 1);
    try {
      // Our pid is now stamped -- overwriting the stale recycled-pid record.
      expect(readFileSync(paths(root).pidFile, "utf8").trim()).toBe(
        String(process.pid + 1),
      );
    } finally {
      await lock.release();
    }
  });

  it("release removes the pidfile we wrote", async () => {
    const lock = await acquireDaemonLock(paths(root), 7777);
    expect(existsSync(paths(root).pidFile)).toBe(true);
    await lock.release();
    expect(existsSync(paths(root).pidFile)).toBe(false);
  });

  it("release leaves a foreign pidfile alone (we no longer own it)", async () => {
    const lock = await acquireDaemonLock(paths(root), 7777);
    // Simulate someone else taking over the pidfile (test seam -- release
    // should not unlink because the recorded pid ≠ ours).
    writeFileSync(paths(root).pidFile, "8888\n");
    await lock.release();
    expect(existsSync(paths(root).pidFile)).toBe(true);
    expect(readFileSync(paths(root).pidFile, "utf8").trim()).toBe("8888");
  });
});

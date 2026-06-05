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
import {
  AppStateOwnerConflictError,
  acquireAppStateOwnership,
  isPidAlive,
  markerFileFor,
  readMarker,
  unlinkMarker,
  writeMarker,
} from "./mode-marker.js";

describe("mode-marker file helpers", () => {
  let dir: string;
  let markerFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mode-marker-"));
    markerFile = markerFileFor(dir);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads back a marker round-trip", () => {
    const written = writeMarker(
      markerFile,
      "daemon",
      12345,
      "2026-04-28T01:00:00.000Z",
      "host-a",
    );
    expect(readMarker(markerFile)).toEqual(written);
  });

  it("returns null when the marker file does not exist", () => {
    expect(readMarker(markerFile)).toBeNull();
  });

  it("returns null on a malformed marker (wrong field count)", () => {
    writeFileSync(markerFile, "daemon\t12345\n", "utf8");
    expect(readMarker(markerFile)).toBeNull();
  });

  it("returns null when mode is not one of the known values", () => {
    writeFileSync(markerFile, "future-mode\t1\t2026\thost\n", "utf8");
    expect(readMarker(markerFile)).toBeNull();
  });

  it("unlinkMarker is idempotent for a missing file", () => {
    expect(() => unlinkMarker(markerFile)).not.toThrow();
    writeMarker(markerFile, "in-process");
    unlinkMarker(markerFile);
    expect(existsSync(markerFile)).toBe(false);
  });

  it("isPidAlive(self) is true; isPidAlive of a never-allocated pid is false", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    // 2^31 - 1 is way past any plausible live pid; treat as dead.
    expect(isPidAlive(2 ** 31 - 1)).toBe(false);
  });

  it("marker file body is shell-readable TSV", () => {
    writeMarker(markerFile, "daemon");
    expect(readFileSync(markerFile, "utf8")).toMatch(/^daemon\t/);
  });
});

describe("acquireAppStateOwnership", () => {
  let dir: string;
  let markerFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mode-marker-"));
    markerFile = markerFileFor(dir);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("acquires a fresh marker when none exists", async () => {
    const owner = await acquireAppStateOwnership(markerFile, "in-process");
    expect(owner.marker.mode).toBe("in-process");
    expect(owner.marker.pid).toBe(process.pid);
    expect(readMarker(markerFile)).toEqual(owner.marker);
    await owner.release();
  });

  it("release() unlinks our own marker body and frees the lock", async () => {
    const owner = await acquireAppStateOwnership(markerFile, "in-process");
    await owner.release();
    expect(existsSync(markerFile)).toBe(false);

    // After release, a follow-up acquire must succeed.
    const next = await acquireAppStateOwnership(markerFile, "daemon");
    expect(next.marker.mode).toBe("daemon");
    await next.release();
  });

  it("release() preserves a marker body owned by a different (pid, startedAt)", async () => {
    // Simulates a stale-takeover-victim's delayed shutdown handler:
    // owner A's release runs after owner B already wrote a fresh body.
    // A must NOT unlink B's body.
    const owner = await acquireAppStateOwnership(markerFile, "in-process");
    // Overwrite body to simulate B's marker (without going through the
    // lock -- we still hold it; this is a unit-level setup).
    writeMarker(
      markerFile,
      "daemon",
      process.pid + 1,
      "2026-04-28T13:00:00.000Z",
      "host-b",
    );
    await owner.release();
    const body = readMarker(markerFile);
    expect(body?.pid).toBe(process.pid + 1);
    expect(body?.mode).toBe("daemon");
  });

  it("overwrites a stale (dead pid) marker of the same mode", async () => {
    writeMarker(
      markerFile,
      "in-process",
      2 ** 31 - 1,
      "2026-01-01T00:00:00.000Z",
      "old-host",
    );
    const owner = await acquireAppStateOwnership(markerFile, "in-process");
    expect(owner.marker.pid).toBe(process.pid);
    await owner.release();
  });

  it("overwrites a stale marker of the OTHER mode", async () => {
    writeMarker(
      markerFile,
      "daemon",
      2 ** 31 - 1,
      "2026-01-01T00:00:00.000Z",
      "old-host",
    );
    const owner = await acquireAppStateOwnership(markerFile, "in-process");
    expect(owner.marker.mode).toBe("in-process");
    await owner.release();
  });

  it("trusts proper-lockfile and overwrites a stale body whose PID happens to be alive", async () => {
    // Recycled-PID corner: prior owner crashed -> 60s elapsed -> proper-
    // lockfile released the lock -> OS handed the prior PID to an
    // unrelated live process. The new acquirer MUST take over (the
    // lock is the source of truth), not fail-closed on the stale PID
    // pointing at an unrelated live process. Mirrors the daemon
    // lockfile.ts decision (reviewed for correctness, was an inherited
    // band-aid from the pre-redesign code).
    writeMarker(
      markerFile,
      "daemon",
      process.pid /* simulated recycled PID, now ours */,
      "2026-01-01T00:00:00.000Z",
    );
    const owner = await acquireAppStateOwnership(markerFile, "in-process", {
      pid: process.pid + 1, // we are a different process
    });
    expect(owner.marker.mode).toBe("in-process");
    expect(owner.marker.pid).toBe(process.pid + 1);
    await owner.release();
  });

  it("throws AppStateOwnerConflictError when proper-lockfile is already held", async () => {
    const first = await acquireAppStateOwnership(markerFile, "daemon");
    try {
      await expect(
        acquireAppStateOwnership(markerFile, "in-process"),
      ).rejects.toBeInstanceOf(AppStateOwnerConflictError);
    } finally {
      await first.release();
    }
  });

  it("conflict error includes the recorded body for diagnostics", async () => {
    const first = await acquireAppStateOwnership(markerFile, "daemon");
    try {
      const err = await acquireAppStateOwnership(markerFile, "in-process")
        .then(() => null)
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(AppStateOwnerConflictError);
      const conflict = err as AppStateOwnerConflictError;
      expect(conflict.existing?.mode).toBe("daemon");
      expect(conflict.existing?.pid).toBe(process.pid);
    } finally {
      await first.release();
    }
  });
});

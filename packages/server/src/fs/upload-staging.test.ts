import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidSessionIdError,
  removeLegacyDropsDir,
  UploadStaging,
} from "./upload-staging.js";

describe("UploadStaging", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "upload-staging-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("acquire creates a 0700 dir under uploadsDir named exactly by sessionId", async () => {
    const staging = new UploadStaging({ rootDir: root });
    const sid = "11111111-1111-1111-1111-111111111111";
    const dir = await staging.acquire(sid);
    expect(dir.startsWith(staging.uploadsDir)).toBe(true);
    // dir name = sessionId only, no `<sid>-<ms>` prefix
    // collision risk. The Claude shim's --add-dir resolves an exact path,
    // so an attacker who guessed a sibling sessionId still couldn't tag
    // their drops onto another PTY's allowlisted root.
    expect(dir).toBe(join(staging.uploadsDir, sid));
    const st = statSync(dir);
    expect(st.isDirectory()).toBe(true);
    expect(st.mode & 0o777).toBe(0o700);
  });

  it("acquire is idempotent for the same sessionId (concurrent-safe)", async () => {
    const staging = new UploadStaging({ rootDir: root });
    const sid = "22222222-2222-2222-2222-222222222222";
    // parallel acquires must both succeed and converge
    // on the same path, not race each other into EEXIST 500s.
    const [a, b, c] = await Promise.all([
      staging.acquire(sid),
      staging.acquire(sid),
      staging.acquire(sid),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("rejects sessionIds with path separators or traversal segments", async () => {
    const staging = new UploadStaging({ rootDir: root });
    await expect(staging.acquire("../escape")).rejects.toBeInstanceOf(
      InvalidSessionIdError,
    );
    await expect(staging.acquire("evil/sub")).rejects.toBeInstanceOf(
      InvalidSessionIdError,
    );
    await expect(staging.acquire("..")).rejects.toBeInstanceOf(
      InvalidSessionIdError,
    );
    await expect(staging.acquire("")).rejects.toBeInstanceOf(
      InvalidSessionIdError,
    );
  });

  it("InvalidSessionIdError keeps the raw value off the message string", async () => {
    // ANSI/newline injection via log sinks. The class
    // exposes `value` for structured logs but never embeds it in
    // `message`, so a `console.error(err.message)` cannot pollute the
    // log line.
    const staging = new UploadStaging({ rootDir: root });
    const evil = "abc\n[FAKE-LOG-INJECT]";
    try {
      await staging.acquire(evil);
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSessionIdError);
      const e = err as InvalidSessionIdError;
      expect(e.value).toBe(evil);
      expect(e.message).not.toContain(evil);
      expect(e.message).not.toContain("\n");
    }
  });

  it("releaseSession removes the dir tree, idempotent on missing", async () => {
    const staging = new UploadStaging({ rootDir: root });
    const sid = "33333333-3333-3333-3333-333333333333";
    const dir = await staging.acquire(sid);
    await writeFile(join(dir, "img.png"), Buffer.from([1, 2, 3]));
    await staging.releaseSession(sid);
    expect(() => statSync(dir)).toThrow();
    // Second call no-ops.
    await expect(staging.releaseSession(sid)).resolves.toBeUndefined();
  });

  it("sweepStale removes entries past the ttl, leaves fresh ones", async () => {
    const now = Date.now() + 60_000;
    const staging = new UploadStaging({
      rootDir: root,
      ttlMs: 1000,
      clock: () => now,
    });
    const oldDir = await staging.acquire(
      "old00000-0000-0000-0000-000000000000",
    );
    // sweepStale uses fs mtime/birthtime now (codex LOW 7 -- name parsing
    // dropped). Roll the dir's mtime back so it's well past the TTL.
    const past = new Date(now - 10_000);
    utimesSync(oldDir, past, past);
    const freshDir = await staging.acquire(
      "new00000-0000-0000-0000-000000000000",
    );
    const fresh = new Date(now);
    utimesSync(freshDir, fresh, fresh);
    const result = await staging.sweepStale();
    expect(result.swept).toContain(oldDir);
    expect(result.swept).not.toContain(freshDir);
    expect(() => statSync(oldDir)).toThrow();
    expect(statSync(freshDir).isDirectory()).toBe(true);
  });

  it("sweepStale handles a foreign directory via stat fallback", async () => {
    const now = Date.now() + 60_000;
    const staging = new UploadStaging({
      rootDir: root,
      ttlMs: 1000,
      clock: () => now,
    });
    const foreign = join(staging.uploadsDir, "foreign-no-uuid-name");
    mkdirSync(foreign);
    const past = new Date(now - 10_000);
    utimesSync(foreign, past, past);
    const result = await staging.sweepStale();
    expect(result.swept).toContain(foreign);
  });

  it("sweepStale tolerates a missing uploads dir", async () => {
    const staging = new UploadStaging({ rootDir: root });
    rmSync(staging.uploadsDir, { recursive: true, force: true });
    await expect(staging.sweepStale()).resolves.toEqual({ swept: [] });
  });

  it("constructor honours an explicit rootDir override", async () => {
    const override = mkdtempSync(join(tmpdir(), "upload-staging-override-"));
    try {
      const staging = new UploadStaging({ rootDir: override });
      // realpath canonicalizes /tmp on macOS -- compare end-with rather
      // than equal so this passes both on Linux and macOS.
      expect(staging.uploadsDir.endsWith("uploads")).toBe(true);
      const sid = "44444444-4444-4444-4444-444444444444";
      const dir = await staging.acquire(sid);
      expect(dir.startsWith(staging.uploadsDir)).toBe(true);
    } finally {
      rmSync(override, { recursive: true, force: true });
    }
  });

  it("constructor refuses a symlinked rootDir (codex MED 3)", async () => {
    const real = mkdtempSync(join(tmpdir(), "upload-staging-symlink-real-"));
    const link = join(tmpdir(), `upload-staging-symlink-${Date.now()}`);
    try {
      const { symlinkSync } = await import("node:fs");
      symlinkSync(real, link);
      expect(() => new UploadStaging({ rootDir: link })).toThrow(/symlink/);
    } finally {
      try {
        rmSync(link, { force: true });
      } catch {
        /* ignore */
      }
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("removeLegacyDropsDir", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "upload-staging-legacy-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("removes the legacy .parasor/drops dir and the now-empty parent", async () => {
    const legacy = join(root, ".parasor", "drops");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "20260101-120000_old.png"), "x");
    const result = await removeLegacyDropsDir(root);
    expect(result.removed).toBe(true);
    // Whole `.parasor/` tree gone because nothing else lived under it.
    expect(() => statSync(join(root, ".parasor"))).toThrow();
  });

  it("preserves sibling .parasor/<other>/ when removing drops only", async () => {
    // future code writing to .parasor/<other> must not be
    // wiped by every server boot.
    mkdirSync(join(root, ".parasor", "drops"), { recursive: true });
    writeFileSync(join(root, ".parasor", "drops", "img.png"), "x");
    mkdirSync(join(root, ".parasor", "other"), { recursive: true });
    writeFileSync(join(root, ".parasor", "other", "data.json"), "{}");
    const result = await removeLegacyDropsDir(root);
    expect(result.removed).toBe(true);
    expect(() => statSync(join(root, ".parasor", "drops"))).toThrow();
    expect(statSync(join(root, ".parasor", "other")).isDirectory()).toBe(true);
    expect(
      statSync(join(root, ".parasor", "other", "data.json")).isFile(),
    ).toBe(true);
  });

  it("returns removed=false when the dir does not exist", async () => {
    const result = await removeLegacyDropsDir(root);
    expect(result.removed).toBe(false);
  });

  it("returns removed=false when projectRoot is missing", async () => {
    const missing = join(root, "no-such");
    const result = await removeLegacyDropsDir(missing);
    expect(result.removed).toBe(false);
  });

  it("does not follow a .parasor symlink that points outside the project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "upload-staging-outside-"));
    try {
      writeFileSync(join(outside, "keep.txt"), "keep");
      const { symlinkSync } = await import("node:fs");
      symlinkSync(outside, join(root, ".parasor"));
      const result = await removeLegacyDropsDir(root);
      expect(result.removed).toBe(false);
      expect(statSync(join(outside, "keep.txt")).isFile()).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

// Compile-time sanity: ensure the module's types are exported.
async function _typeCheck() {
  const staging = new UploadStaging({});
  await staging.acquire("x");
  await staging.releaseSession("x");
  const r = await staging.sweepStale();
  void r.swept;
  await mkdir;
  void stat;
}
void _typeCheck;

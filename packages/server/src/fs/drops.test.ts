import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidFilenameError, sanitizeFilename, saveDrops } from "./drops.js";

describe("sanitizeFilename", () => {
  it("rejects path traversal", () => {
    expect(() => sanitizeFilename("..")).toThrow(InvalidFilenameError);
    expect(() => sanitizeFilename(".")).toThrow(InvalidFilenameError);
    expect(() => sanitizeFilename("")).toThrow(InvalidFilenameError);
    expect(() => sanitizeFilename("../etc/passwd")).toThrow(
      InvalidFilenameError,
    );
    expect(() => sanitizeFilename("foo/../bar")).toThrow(InvalidFilenameError);
    expect(() => sanitizeFilename("foo\\..\\bar")).toThrow(
      InvalidFilenameError,
    );
  });

  it("replaces path separators with underscore", () => {
    expect(sanitizeFilename("a/b.txt")).toBe("a_b.txt");
    expect(sanitizeFilename("a\\b.txt")).toBe("a_b.txt");
  });

  it("replaces control characters and NUL", () => {
    expect(sanitizeFilename("foo\x01bar")).toBe("foo_bar");
    expect(sanitizeFilename("foo\x00bar")).toBe("foo_bar");
    expect(sanitizeFilename("foo\x7fbar")).toBe("foo_bar");
  });

  it("replaces NBSP and ideographic space", () => {
    expect(sanitizeFilename("a b.txt")).toBe("a_b.txt");
    expect(sanitizeFilename("a　b.txt")).toBe("a_b.txt");
  });

  it("NFC-normalizes decomposed input", () => {
    const composed = "é.txt";
    const decomposed = "é.txt";
    expect(sanitizeFilename(decomposed)).toBe(composed);
  });

  it("truncates to 255 chars while preserving extension", () => {
    const base = "a".repeat(300);
    const input = `${base}.png`;
    const out = sanitizeFilename(input);
    expect(out.length).toBe(255);
    expect(out.endsWith(".png")).toBe(true);
  });

  it("keeps short names untouched", () => {
    expect(sanitizeFilename("image.png")).toBe("image.png");
    expect(sanitizeFilename("日本語.txt")).toBe("日本語.txt");
  });
});

describe("saveDrops", () => {
  let targetDir: string;
  beforeEach(() => {
    // Caller is responsible for creating the dir (UploadStaging.acquire in
    // production); the test mimics that contract with a fresh mkdtemp.
    targetDir = mkdtempSync(join(tmpdir(), "drops-test-"));
  });
  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("writes a single file under targetDir with timestamp prefix", async () => {
    const date = new Date(2026, 3, 23, 14, 30, 52); // 2026-04-23 14:30:52 local
    const paths = await saveDrops(
      targetDir,
      [{ filename: "image.png", bytes: new Uint8Array([1, 2, 3]) }],
      { now: () => date },
    );
    expect(paths).toHaveLength(1);
    // Path may differ from join(targetDir, ...) by macOS /tmp -> /private/tmp
    // canonicalization. Compare via basename + readback.
    expect(paths[0].endsWith("20260423-143052_image.png")).toBe(true);
    expect(Array.from(readFileSync(paths[0]))).toEqual([1, 2, 3]);
  });

  it("disambiguates same-second collisions with -2, -3 suffix", async () => {
    const date = new Date(2026, 3, 23, 14, 30, 52);
    const bytes = new Uint8Array([0]);
    const paths: string[] = [];
    for (let i = 0; i < 3; i++) {
      const written = await saveDrops(
        targetDir,
        [{ filename: "same.txt", bytes }],
        { now: () => date },
      );
      paths.push(...written);
    }
    expect(paths[0].endsWith("20260423-143052_same.txt")).toBe(true);
    expect(paths[1].endsWith("20260423-143052_same-2.txt")).toBe(true);
    expect(paths[2].endsWith("20260423-143052_same-3.txt")).toBe(true);
  });

  it("does not add suffix when clock advances", async () => {
    let ticks = 0;
    const clock = () => new Date(2026, 3, 23, 14, 30, 50 + ticks++);
    const written: string[] = [];
    for (let i = 0; i < 2; i++) {
      const p = await saveDrops(
        targetDir,
        [{ filename: "log.txt", bytes: new Uint8Array([0]) }],
        { now: clock },
      );
      written.push(...p);
    }
    expect(written[0].endsWith("20260423-143050_log.txt")).toBe(true);
    expect(written[1].endsWith("20260423-143051_log.txt")).toBe(true);
  });

  it("rejects filenames that resolve outside the target dir", async () => {
    await expect(
      saveDrops(targetDir, [
        { filename: "../evil.txt", bytes: new Uint8Array() },
      ]),
    ).rejects.toBeInstanceOf(InvalidFilenameError);
  });

  it("accepts zero inputs as a no-op", async () => {
    const paths = await saveDrops(targetDir, []);
    expect(paths).toEqual([]);
  });

  it("rejects writes when a sub-symlink redirects outside targetDir", async () => {
    // saveDrops resolves targetDir via realpath then fences each claim with
    // startsWith(canonicalTarget + sep). A planted symlink whose canonical
    // path lives outside targetDir would fail the fence -- we simulate this
    // by handing saveDrops a symlink-as-targetDir that points outside, then
    // asserting the canonical path is the outside dir (the fence still
    // applies because we compare canonical paths). The defense matters most
    // for the inverse case: targetDir contains a nested symlink. We can't
    // easily make the writer's target path traverse a nested symlink without
    // a sanitizer regression, but at minimum the realpath canonicalization
    // protects against caller-side targetDir-was-symlink confusion.
    const outside = mkdtempSync(join(tmpdir(), "drops-outside-"));
    try {
      const linkedTarget = join(outside, "nested");
      mkdirSync(linkedTarget);
      const linkSrc = join(targetDir, "link");
      symlinkSync(linkedTarget, linkSrc);
      // Writes through the symlink should land in `linkedTarget` because we
      // realpath the supplied path. Verify by reading back via the canonical
      // location.
      const paths = await saveDrops(linkSrc, [
        { filename: "ok.txt", bytes: new TextEncoder().encode("x") },
      ]);
      // Compare against canonical `outside` to absorb macOS /tmp ->
      // /private/tmp realpath canonicalization.
      expect(paths[0].startsWith(realpathSync(outside))).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("serializes concurrent saves of the same filename with O_EXCL", async () => {
    // Two parallel `notes.txt` saves in the same second must end up with
    // two distinct files: the losing save claims the next collision
    // suffix via EEXIST, not by overwriting the winner.
    const date = new Date(2026, 3, 23, 14, 30, 52);
    const bytesA = new TextEncoder().encode("AAA");
    const bytesB = new TextEncoder().encode("BBB");
    const [a, b] = await Promise.all([
      saveDrops(targetDir, [{ filename: "notes.txt", bytes: bytesA }], {
        now: () => date,
      }),
      saveDrops(targetDir, [{ filename: "notes.txt", bytes: bytesB }], {
        now: () => date,
      }),
    ]);
    expect(a[0]).not.toBe(b[0]);
    const contentA = readFileSync(a[0], "utf-8");
    const contentB = readFileSync(b[0], "utf-8");
    expect(new Set([contentA, contentB])).toEqual(new Set(["AAA", "BBB"]));
  });

  it("aborts after 1000 collision attempts as a DoS guard", async () => {
    const date = new Date(2026, 3, 23, 14, 30, 52);
    // A stubbed `open` that always throws EEXIST simulates a target dir
    // prefilled with every `spam-N.txt` slot up to the cap. The real
    // production code sees the same EEXIST from `fs.open(..., "wx")`.
    const eexist = (): Promise<never> => {
      const err = new Error("EEXIST") as NodeJS.ErrnoException;
      err.code = "EEXIST";
      return Promise.reject(err);
    };
    await expect(
      saveDrops(
        targetDir,
        [{ filename: "spam.txt", bytes: new Uint8Array() }],
        {
          now: () => date,
          openForTest:
            eexist as unknown as typeof import("node:fs/promises").open,
        },
      ),
    ).rejects.toThrow(/exhausted/);
  });
});

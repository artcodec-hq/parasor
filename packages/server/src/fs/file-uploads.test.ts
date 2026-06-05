import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidUploadFilenameError,
  InvalidUploadTargetError,
  resolveTargetDir,
  sanitizeUploadFilename,
  saveUploads,
  UploadConflictError,
} from "./file-uploads.js";

describe("sanitizeUploadFilename", () => {
  it("rejects path traversal", () => {
    expect(() => sanitizeUploadFilename("..")).toThrow(
      InvalidUploadFilenameError,
    );
    expect(() => sanitizeUploadFilename(".")).toThrow(
      InvalidUploadFilenameError,
    );
    expect(() => sanitizeUploadFilename("")).toThrow(
      InvalidUploadFilenameError,
    );
    expect(() => sanitizeUploadFilename("../etc/passwd")).toThrow(
      InvalidUploadFilenameError,
    );
    expect(() => sanitizeUploadFilename("foo/../bar")).toThrow(
      InvalidUploadFilenameError,
    );
    expect(() => sanitizeUploadFilename("foo\\..\\bar")).toThrow(
      InvalidUploadFilenameError,
    );
  });

  it("replaces path separators and control chars", () => {
    expect(sanitizeUploadFilename("a/b.txt")).toBe("a_b.txt");
    expect(sanitizeUploadFilename("a\\b.txt")).toBe("a_b.txt");
    expect(sanitizeUploadFilename("foo\x01bar")).toBe("foo_bar");
    expect(sanitizeUploadFilename("foo\x7fbar")).toBe("foo_bar");
  });

  it("truncates to 255 chars while preserving extension", () => {
    const out = sanitizeUploadFilename(`${"a".repeat(300)}.png`);
    expect(out.length).toBe(255);
    expect(out.endsWith(".png")).toBe(true);
  });
});

describe("resolveTargetDir", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "uploads-target-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves the project root with empty relative", async () => {
    const resolved = await resolveTargetDir(tmp, "");
    // realpath canonicalizes /tmp on macOS; compare end-with rather than equal.
    expect(resolved.endsWith(tmp.replace(/^\/private/, ""))).toBe(true);
  });

  it("resolves a nested subdirectory", async () => {
    mkdirSync(join(tmp, "src", "nested"), { recursive: true });
    const out = await resolveTargetDir(tmp, "src/nested");
    expect(out.endsWith(join("src", "nested"))).toBe(true);
  });

  it("rejects absolute paths", async () => {
    await expect(resolveTargetDir(tmp, "/etc")).rejects.toBeInstanceOf(
      InvalidUploadTargetError,
    );
  });

  it("rejects path traversal", async () => {
    await expect(resolveTargetDir(tmp, "../outside")).rejects.toBeInstanceOf(
      InvalidUploadTargetError,
    );
  });

  it("rejects symlink redirecting outside project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "uploads-outside-"));
    try {
      symlinkSync(outside, join(tmp, "escape"));
      await expect(resolveTargetDir(tmp, "escape")).rejects.toBeInstanceOf(
        InvalidUploadTargetError,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects when target is a file", async () => {
    writeFileSync(join(tmp, "file.txt"), "");
    await expect(resolveTargetDir(tmp, "file.txt")).rejects.toMatchObject({
      reason: "not-a-dir",
    });
  });

  it("rejects when target is missing", async () => {
    await expect(resolveTargetDir(tmp, "no-such-dir")).rejects.toMatchObject({
      reason: "missing",
    });
  });
});

describe("saveUploads", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "uploads-test-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a single file with original name", async () => {
    const target = await resolveTargetDir(tmp, "");
    const results = await saveUploads(
      target,
      [{ filename: "image.png", bytes: new Uint8Array([1, 2, 3]) }],
      "keep-both",
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("written");
    expect(results[0].finalName).toBe("image.png");
    expect(results[0].finalPath).toBe(join(target, "image.png"));
    const finalPath = results[0].finalPath;
    if (!finalPath) throw new Error("expected upload finalPath");
    expect(Array.from(readFileSync(finalPath))).toEqual([1, 2, 3]);
  });

  it("keep-both renames colliding files with -2, -3 suffix", async () => {
    const target = await resolveTargetDir(tmp, "");
    const bytes = new Uint8Array([0]);
    const r1 = await saveUploads(
      target,
      [{ filename: "same.txt", bytes }],
      "keep-both",
    );
    const r2 = await saveUploads(
      target,
      [{ filename: "same.txt", bytes }],
      "keep-both",
    );
    const r3 = await saveUploads(
      target,
      [{ filename: "same.txt", bytes }],
      "keep-both",
    );
    expect(r1[0].finalName).toBe("same.txt");
    expect(r1[0].status).toBe("written");
    expect(r2[0].finalName).toBe("same-2.txt");
    expect(r2[0].status).toBe("renamed");
    expect(r3[0].finalName).toBe("same-3.txt");
    expect(r3[0].status).toBe("renamed");
  });

  it("replace overwrites existing file", async () => {
    const target = await resolveTargetDir(tmp, "");
    writeFileSync(join(target, "doc.txt"), "old");
    const results = await saveUploads(
      target,
      [
        {
          filename: "doc.txt",
          bytes: new TextEncoder().encode("new"),
        },
      ],
      "replace",
    );
    expect(results[0].status).toBe("written");
    expect(results[0].finalName).toBe("doc.txt");
    expect(readFileSync(join(target, "doc.txt"), "utf-8")).toBe("new");
  });

  it("skip throws UploadConflictError listing conflicts and writes nothing", async () => {
    const target = await resolveTargetDir(tmp, "");
    writeFileSync(join(target, "a.txt"), "old-a");
    writeFileSync(join(target, "b.txt"), "old-b");
    await expect(
      saveUploads(
        target,
        [
          { filename: "a.txt", bytes: new TextEncoder().encode("new") },
          { filename: "c.txt", bytes: new TextEncoder().encode("new-c") },
          { filename: "b.txt", bytes: new TextEncoder().encode("new") },
        ],
        "skip",
      ),
    ).rejects.toMatchObject({
      conflicts: ["a.txt", "b.txt"],
    });
    // Pre-existing files untouched.
    expect(readFileSync(join(target, "a.txt"), "utf-8")).toBe("old-a");
    expect(readFileSync(join(target, "b.txt"), "utf-8")).toBe("old-b");
    // Non-conflicting file NOT written either (all-or-nothing).
    expect(() => readFileSync(join(target, "c.txt"))).toThrow();
  });

  it("skip writes everything when there are no conflicts", async () => {
    const target = await resolveTargetDir(tmp, "");
    const results = await saveUploads(
      target,
      [
        { filename: "x.txt", bytes: new TextEncoder().encode("X") },
        { filename: "y.txt", bytes: new TextEncoder().encode("Y") },
      ],
      "skip",
    );
    expect(results.map((r) => r.finalName)).toEqual(["x.txt", "y.txt"]);
    expect(readFileSync(join(target, "x.txt"), "utf-8")).toBe("X");
    expect(readFileSync(join(target, "y.txt"), "utf-8")).toBe("Y");
  });

  it("rejects filenames that escape the target dir", async () => {
    const target = await resolveTargetDir(tmp, "");
    await expect(
      saveUploads(
        target,
        [{ filename: "../evil.txt", bytes: new Uint8Array() }],
        "keep-both",
      ),
    ).rejects.toBeInstanceOf(InvalidUploadFilenameError);
  });

  it("accepts zero inputs as a no-op", async () => {
    const target = await resolveTargetDir(tmp, "");
    expect(await saveUploads(target, [], "keep-both")).toEqual([]);
  });

  it("aborts after 1000 collision attempts as a DoS guard", async () => {
    const target = await resolveTargetDir(tmp, "");
    const eexist = (): Promise<never> => {
      const err = new Error("EEXIST") as NodeJS.ErrnoException;
      err.code = "EEXIST";
      return Promise.reject(err);
    };
    await expect(
      saveUploads(
        target,
        [{ filename: "spam.txt", bytes: new Uint8Array() }],
        "keep-both",
        {
          openForTest:
            eexist as unknown as typeof import("node:fs/promises").open,
        },
      ),
    ).rejects.toThrow(/exhausted/);
  });

  // UploadConflictError must export a stable shape for the route layer.
  it("UploadConflictError preserves conflict list", () => {
    const e = new UploadConflictError(["a", "b"]);
    expect(e.conflicts).toEqual(["a", "b"]);
    expect(e).toBeInstanceOf(Error);
  });
});

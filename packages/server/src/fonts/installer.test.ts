import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync } from "node:fs";
import { readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import yazl from "yazl";
import type { FontPreset } from "./catalog.js";
import { FontInstallError, FontInstaller } from "./installer.js";

function makeZip(
  entries: Array<{ name: string; content: Buffer }>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const entry of entries) {
      zip.addBuffer(entry.content, entry.name);
    }
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
}

function testPreset(overrides: Partial<FontPreset> = {}): FontPreset {
  return {
    id: "test-font",
    name: "Test Font",
    category: "latin",
    family: "Test Font",
    zipUrl: "https://example.invalid/font.zip",
    regularMatch: "TestFont-Regular",
    zipSizeMb: 1,
    description: "test",
    ...overrides,
  };
}

function stubFetch(zipBuf: Buffer): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(zipBuf));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("FontInstaller", () => {
  it("downloads, extracts the matching Regular TTF, caches it, and reports installed", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "parasor-fonts-"));
    try {
      const ttfPayload = Buffer.from("FAKE_TTF_REGULAR_BYTES");
      const zipBuf = await makeZip([
        { name: "other/README.txt", content: Buffer.from("readme") },
        { name: "ttf/TestFont-Bold.ttf", content: Buffer.from("bold") },
        { name: "ttf/TestFont-Regular.ttf", content: ttfPayload },
      ]);
      const installer = new FontInstaller({
        cacheDir,
        fetchImpl: stubFetch(zipBuf),
      });
      const preset = testPreset();

      const result = await installer.install(preset);
      expect(result.id).toBe(preset.id);
      expect(result.family).toBe(preset.family);
      expect(readFileSync(result.filePath)).toEqual(ttfPayload);

      const resolved = await installer.resolveInstalled(preset.id);
      expect(resolved?.family).toBe(preset.family);
      const entries = await readdir(join(cacheDir, preset.id));
      expect(entries.sort()).toEqual(["family.txt", "font.ttf"]);

      const installed = await installer.listInstalled();
      expect(installed).toEqual([preset.id]);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("returns cached result on subsequent install without re-downloading", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "parasor-fonts-"));
    try {
      const ttfPayload = Buffer.from("CACHED");
      const zipBuf = await makeZip([
        { name: "TestFont-Regular.ttf", content: ttfPayload },
      ]);
      let fetchCalls = 0;
      const fetchImpl: typeof fetch = (async () => {
        fetchCalls++;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(zipBuf));
            c.close();
          },
        });
        return new Response(body, { status: 200 });
      }) as unknown as typeof fetch;
      const installer = new FontInstaller({ cacheDir, fetchImpl });
      const preset = testPreset();

      await installer.install(preset);
      await installer.install(preset);

      expect(fetchCalls).toBe(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("surfaces download failure as FontInstallError", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "parasor-fonts-"));
    try {
      const fetchImpl: typeof fetch = (async () =>
        new Response(null, { status: 404 })) as unknown as typeof fetch;
      const installer = new FontInstaller({ cacheDir, fetchImpl });
      await expect(installer.install(testPreset())).rejects.toBeInstanceOf(
        FontInstallError,
      );
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("fails with asset_not_found when no TTF matches the pattern", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "parasor-fonts-"));
    try {
      const zipBuf = await makeZip([
        { name: "TestFont-Bold.ttf", content: Buffer.from("bold") },
      ]);
      const installer = new FontInstaller({
        cacheDir,
        fetchImpl: stubFetch(zipBuf),
      });
      await expect(installer.install(testPreset())).rejects.toMatchObject({
        kind: "asset_not_found",
      });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("resolveInstalled returns null for missing or empty installs", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "parasor-fonts-"));
    try {
      const installer = new FontInstaller({ cacheDir });
      expect(await installer.resolveInstalled("test-font")).toBeNull();

      // An empty/partial cache directory must not count as installed.
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(cacheDir, "test-font"), { recursive: true });
      expect(await installer.resolveInstalled("test-font")).toBeNull();

      // A zero-byte font file must not count as installed either.
      await writeFile(join(cacheDir, "test-font", "font.ttf"), "");
      await writeFile(join(cacheDir, "test-font", "family.txt"), "Test Font");
      expect(await installer.resolveInstalled("test-font")).toBeNull();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("deduplicates concurrent install calls for the same preset", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "parasor-fonts-"));
    try {
      const ttfPayload = Buffer.from("SHARED");
      const zipBuf = await makeZip([
        { name: "TestFont-Regular.ttf", content: ttfPayload },
      ]);
      let fetchCalls = 0;
      const fetchImpl: typeof fetch = (async () => {
        fetchCalls++;
        await new Promise((r) => setTimeout(r, 20));
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(zipBuf));
            c.close();
          },
        });
        return new Response(body, { status: 200 });
      }) as unknown as typeof fetch;
      const installer = new FontInstaller({ cacheDir, fetchImpl });
      const preset = testPreset();

      const [a, b] = await Promise.all([
        installer.install(preset),
        installer.install(preset),
      ]);
      expect(a.filePath).toBe(b.filePath);
      expect(fetchCalls).toBe(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

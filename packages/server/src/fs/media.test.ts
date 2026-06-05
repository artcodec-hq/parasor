import { Buffer } from "node:buffer";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classify, detectMedia, isMediaExtension } from "./media.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF89_MAGIC = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00,
]);

function makeWebp(): Buffer {
  return Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("WEBP"),
    Buffer.from([0, 0, 0, 0]),
  ]);
}

function makeAvif(): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from("ftyp"),
    Buffer.from("avif"),
    Buffer.from([0, 0, 0, 0]),
  ]);
}

function makeMp4(): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from("ftyp"),
    Buffer.from("isom"),
    Buffer.from([0, 0, 0, 0]),
  ]);
}

function makeMov(): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x14]),
    Buffer.from("ftyp"),
    Buffer.from("qt  "),
    Buffer.from([0, 0, 0, 0]),
  ]);
}

function makeWebm(): Buffer {
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);
}

function makeWav(): Buffer {
  return Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("WAVE"),
  ]);
}

function makeMp3(): Buffer {
  // ID3v2 header
  return Buffer.from([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

function makePdf(): Buffer {
  return Buffer.from("%PDF-1.4\n");
}

describe("media classify", () => {
  it("identifies PNG by magic", () => {
    expect(classify(PNG_MAGIC, "")).toEqual({
      kind: "image",
      contentType: "image/png",
    });
  });

  it("identifies JPEG", () => {
    expect(classify(JPEG_MAGIC, "")).toEqual({
      kind: "image",
      contentType: "image/jpeg",
    });
  });

  it("identifies GIF", () => {
    expect(classify(GIF89_MAGIC, "")).toEqual({
      kind: "image",
      contentType: "image/gif",
    });
  });

  it("identifies WebP", () => {
    expect(classify(makeWebp(), "")).toEqual({
      kind: "image",
      contentType: "image/webp",
    });
  });

  it("identifies AVIF", () => {
    expect(classify(makeAvif(), "")).toEqual({
      kind: "image",
      contentType: "image/avif",
    });
  });

  it("identifies MP4 by ftyp brand", () => {
    expect(classify(makeMp4(), "")).toEqual({
      kind: "video",
      contentType: "video/mp4",
    });
  });

  it("identifies MOV by ftyp brand", () => {
    expect(classify(makeMov(), "")).toEqual({
      kind: "video",
      contentType: "video/quicktime",
    });
  });

  it("identifies WebM by EBML signature", () => {
    expect(classify(makeWebm(), "")).toEqual({
      kind: "video",
      contentType: "video/webm",
    });
  });

  it("identifies WAV by RIFF/WAVE", () => {
    expect(classify(makeWav(), "")).toEqual({
      kind: "audio",
      contentType: "audio/wav",
    });
  });

  it("identifies MP3 by ID3 header", () => {
    expect(classify(makeMp3(), "")).toEqual({
      kind: "audio",
      contentType: "audio/mpeg",
    });
  });

  it("identifies PDF", () => {
    expect(classify(makePdf(), "")).toEqual({
      kind: "pdf",
      contentType: "application/pdf",
    });
  });

  it("accepts SVG only when extension agrees", () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg></svg>');
    expect(classify(svg, "svg")).toEqual({
      kind: "image",
      contentType: "image/svg+xml",
    });
    expect(classify(svg, "xml")).toEqual({ kind: null, contentType: null });
  });

  it("falls back to extension when bytes are inconclusive but ext is whitelisted", () => {
    const fauxMp3 = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(classify(fauxMp3, "mp3")).toEqual({
      kind: "audio",
      contentType: "audio/mpeg",
    });
  });

  it("returns null for unknown content with no extension hint", () => {
    expect(classify(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), "")).toEqual({
      kind: null,
      contentType: null,
    });
  });

  it("returns null for .exe even if some bytes match", () => {
    expect(classify(Buffer.from([0x4d, 0x5a]), "exe")).toEqual({
      kind: null,
      contentType: null,
    });
  });
});

describe("isMediaExtension", () => {
  it("recognizes whitelisted extensions", () => {
    expect(isMediaExtension("/tmp/foo.png")).toBe(true);
    expect(isMediaExtension("/tmp/foo.JPG")).toBe(true);
    expect(isMediaExtension("/tmp/foo.mp4")).toBe(true);
    expect(isMediaExtension("/tmp/foo.pdf")).toBe(true);
  });

  it("rejects non-media", () => {
    expect(isMediaExtension("/tmp/foo.exe")).toBe(false);
    expect(isMediaExtension("/tmp/foo.ts")).toBe(false);
    expect(isMediaExtension("/tmp/foo")).toBe(false);
  });
});

describe("detectMedia (disk)", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("reads first bytes and classifies a real PNG", async () => {
    dir = mkdtempSync(join(tmpdir(), "parasor-media-"));
    const file = join(dir, "tiny.png");
    writeFileSync(file, PNG_MAGIC);
    const result = await detectMedia(file);
    expect(result.kind).toBe("image");
    expect(result.contentType).toBe("image/png");
  });

  it("returns null kind for plain text", async () => {
    dir = mkdtempSync(join(tmpdir(), "parasor-media-"));
    const file = join(dir, "notes.txt");
    writeFileSync(file, "hello world");
    const result = await detectMedia(file);
    expect(result.kind).toBeNull();
  });
});

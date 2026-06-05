import { Buffer } from "node:buffer";
import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";

export type MediaKind = "image" | "video" | "audio" | "pdf";

export interface MediaDetectionResult {
  kind: MediaKind | null;
  contentType: string | null;
}

const EXTENSION_MAP: Record<string, { kind: MediaKind; contentType: string }> =
  {
    png: { kind: "image", contentType: "image/png" },
    jpg: { kind: "image", contentType: "image/jpeg" },
    jpeg: { kind: "image", contentType: "image/jpeg" },
    gif: { kind: "image", contentType: "image/gif" },
    webp: { kind: "image", contentType: "image/webp" },
    svg: { kind: "image", contentType: "image/svg+xml" },
    avif: { kind: "image", contentType: "image/avif" },
    bmp: { kind: "image", contentType: "image/bmp" },
    ico: { kind: "image", contentType: "image/x-icon" },
    mp4: { kind: "video", contentType: "video/mp4" },
    webm: { kind: "video", contentType: "video/webm" },
    mov: { kind: "video", contentType: "video/quicktime" },
    mp3: { kind: "audio", contentType: "audio/mpeg" },
    wav: { kind: "audio", contentType: "audio/wav" },
    ogg: { kind: "audio", contentType: "audio/ogg" },
    m4a: { kind: "audio", contentType: "audio/mp4" },
    pdf: { kind: "pdf", contentType: "application/pdf" },
  };

/**
 * Magic-number signatures. Matched against the first 32 bytes. A signature
 * matches when every defined byte equals the file byte at that offset; entries
 * use `null` for "any byte". Order matters only when prefixes overlap (none do
 * here). SVG / WAV / AVIF need range checks done in code below.
 */
interface Signature {
  bytes: (number | null)[];
  result: { kind: MediaKind; contentType: string };
}

const SIGNATURES: Signature[] = [
  // PNG
  {
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    result: { kind: "image", contentType: "image/png" },
  },
  // JPEG (FF D8 FF ..)
  {
    bytes: [0xff, 0xd8, 0xff],
    result: { kind: "image", contentType: "image/jpeg" },
  },
  // GIF87a / GIF89a
  {
    bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    result: { kind: "image", contentType: "image/gif" },
  },
  {
    bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    result: { kind: "image", contentType: "image/gif" },
  },
  // BMP
  {
    bytes: [0x42, 0x4d],
    result: { kind: "image", contentType: "image/bmp" },
  },
  // ICO (00 00 01 00)
  {
    bytes: [0x00, 0x00, 0x01, 0x00],
    result: { kind: "image", contentType: "image/x-icon" },
  },
  // PDF "%PDF-"
  {
    bytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
    result: { kind: "pdf", contentType: "application/pdf" },
  },
  // MP3 (ID3 header)
  {
    bytes: [0x49, 0x44, 0x33],
    result: { kind: "audio", contentType: "audio/mpeg" },
  },
  // OGG
  {
    bytes: [0x4f, 0x67, 0x67, 0x53],
    result: { kind: "audio", contentType: "audio/ogg" },
  },
];

function bytesMatch(buf: Buffer, sig: Signature): boolean {
  if (buf.length < sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    const expected = sig.bytes[i];
    if (expected === null) continue;
    if (buf[i] !== expected) return false;
  }
  return true;
}

function isWebpSignature(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  );
}

function isWavSignature(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  );
}

function isAvifSignature(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // ISO BMFF "ftyp" at offset 4, brand at offset 8 = "avif" or "avis"
  if (buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70)
    return false;
  const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  return brand === "avif" || brand === "avis";
}

function isMp4Signature(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70)
    return false;
  const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  // common MP4 brands
  return [
    "isom",
    "iso2",
    "iso3",
    "iso4",
    "iso5",
    "iso6",
    "mp41",
    "mp42",
    "avc1",
    "M4V ",
    "MSNV",
    "dash",
  ].includes(brand);
}

function isMovSignature(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70)
    return false;
  const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  return brand === "qt  ";
}

function isWebmSignature(buf: Buffer): boolean {
  // EBML header used by Matroska/WebM
  return (
    buf.length >= 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  );
}

function isM4aSignature(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70)
    return false;
  const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  return brand === "M4A " || brand === "mp42";
}

function isSvgText(buf: Buffer): boolean {
  // SVG is text -- accept either `<?xml` or a leading `<svg` (allowing BOM and whitespace).
  if (buf.length === 0) return false;
  let i = 0;
  // strip UTF-8 BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3;
  // skip ASCII whitespace
  while (
    i < buf.length &&
    (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)
  ) {
    i++;
  }
  if (i >= buf.length) return false;
  const slice = buf.subarray(i, Math.min(buf.length, i + 16)).toString("utf8");
  return slice.startsWith("<?xml") || slice.toLowerCase().startsWith("<svg");
}

function getExtension(absPath: string): string {
  const idx = absPath.lastIndexOf(".");
  if (idx < 0) return "";
  return absPath.slice(idx + 1).toLowerCase();
}

/**
 * Identify a media file by its first 32 bytes plus extension. Magic-number
 * match wins; if the magic match disagrees with the extension, the magic
 * match is authoritative. SVG sniff is conservative -- only accepted when the
 * extension claims SVG so a plain XML file is not mis-classified.
 */
export async function detectMedia(
  absPath: string,
): Promise<MediaDetectionResult> {
  const fh = await open(absPath, "r");
  try {
    return await detectMediaFromHandle(fh, absPath);
  } finally {
    await fh.close();
  }
}

/**
 * Same magic-number + extension pipeline as `detectMedia`, but reads through
 * a caller-owned `FileHandle`. Use this when the route layer has already
 * `O_NOFOLLOW`-opened the file and needs detection, size validation, and
 * streaming all anchored to the same inode (so a leaf swap between checks
 * cannot bypass the size cap or content-type lock). Caller retains ownership
 * of the handle.
 */
export async function detectMediaFromHandle(
  handle: FileHandle,
  pathHint: string,
): Promise<MediaDetectionResult> {
  const ext = getExtension(pathHint);
  const head = Buffer.alloc(32);
  const { bytesRead } = await handle.read(head, 0, 32, 0);
  const buf = head.subarray(0, bytesRead);
  return classify(buf, ext);
}

/**
 * Pure classifier so tests can hand it raw bytes without touching disk.
 * Exposed for unit testing -- `detectMedia` is the production entry point.
 */
export function classify(buf: Buffer, ext: string): MediaDetectionResult {
  // Magic-number passes (specific shapes first)
  if (isWebpSignature(buf)) return { kind: "image", contentType: "image/webp" };
  if (isAvifSignature(buf)) return { kind: "image", contentType: "image/avif" };
  if (isMovSignature(buf))
    return { kind: "video", contentType: "video/quicktime" };
  if (isMp4Signature(buf)) return { kind: "video", contentType: "video/mp4" };
  if (isM4aSignature(buf)) return { kind: "audio", contentType: "audio/mp4" };
  if (isWebmSignature(buf)) return { kind: "video", contentType: "video/webm" };
  if (isWavSignature(buf)) return { kind: "audio", contentType: "audio/wav" };

  for (const sig of SIGNATURES) {
    if (bytesMatch(buf, sig)) return { ...sig.result };
  }

  // SVG only when extension agrees and content looks like SVG/XML
  if (ext === "svg" && isSvgText(buf)) {
    return { kind: "image", contentType: "image/svg+xml" };
  }

  // Extension-only fallback for audio/video formats whose containers we did
  // not match (e.g. bare-frame MP3 without ID3 header). Images and PDFs are
  // intentionally NOT accepted via fallback: their magic numbers are
  // reliable, and a misclassified text/binary file rendered as an image is
  // a much smaller foothold than rendered as a video. Restricted to the
  // explicit whitelist below so the route never serves arbitrary bytes.
  const FALLBACK_OK = new Set([
    "mp3",
    "m4a",
    "ogg",
    "wav",
    "mp4",
    "webm",
    "mov",
  ]);
  if (FALLBACK_OK.has(ext)) {
    const fallback = EXTENSION_MAP[ext];
    if (fallback) return { ...fallback };
  }

  return { kind: null, contentType: null };
}

/**
 * Lightweight extension-only check. Used by the route for the cheap
 * pre-filter before opening the file (so we never read an executable just
 * to learn it isn't media).
 */
export function isMediaExtension(absPath: string): boolean {
  return getExtension(absPath) in EXTENSION_MAP;
}

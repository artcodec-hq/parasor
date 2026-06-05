// Mapping image MIME to filename extension. Server timestamps the name server-side;
// web only needs enough to let the server preserve the file type.
const MIME_TO_EXT: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

function extForMime(type: string): string {
  return MIME_TO_EXT[type] ?? ".bin";
}

/**
 * Extract image/* files from a clipboard DataTransfer. Returns empty array
 * when no image items are present -- callers should then let the paste fall
 * through to the terminal's default text-paste behavior.
 *
 * Clipboard images have no original filename; we synthesize `paste{ext}` so
 * the server (`saveDrops`) can prepend its timestamp prefix and preserve the
 * file type via the extension.
 *
 * `maxBytes` provides client-side early rejection for oversize images before
 * the network round-trip. Pass the soft cap from serviceConfig; oversize
 * entries are silently dropped here (an error path ends up the same way via
 * the server's 413 response for the ones that do upload, so no UX regression).
 */
export function extractImageFiles(
  data: DataTransfer | null,
  maxBytes: number = Number.POSITIVE_INFINITY,
): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    if (!item.type.startsWith("image/")) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    if (blob.size > maxBytes) continue;
    const renamed = new File([blob], `paste${extForMime(blob.type)}`, {
      type: blob.type,
    });
    out.push(renamed);
  }
  return out;
}

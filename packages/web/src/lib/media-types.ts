export type MediaKind = "image" | "video" | "audio" | "pdf";

const EXTENSION_KIND: Record<string, MediaKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  avif: "image",
  bmp: "image",
  ico: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  pdf: "pdf",
};

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "";
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * Quick client-side media classification by extension. Returns `null` for
 * non-media (text/code/unknown) -- caller routes those to the editor.
 * The server re-validates with magic-number sniffing on `/api/files/raw`,
 * so this is purely a UI hint and can be optimistic.
 */
export function getMediaKindFromName(filename: string): MediaKind | null {
  const ext = getExtension(filename);
  return EXTENSION_KIND[ext] ?? null;
}

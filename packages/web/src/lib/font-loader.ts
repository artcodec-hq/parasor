/*
 * Dynamic @font-face injection. Used by the font preset picker so a
 * server-provided TTF can be adopted by the running xterm without a
 * full-page reload.
 *
 * Uses the FontFace / document.fonts API (Chromium, Safari 10+, Firefox
 * 41+) rather than appending a <style> tag so duplicate adds are cheap
 * (we can key by family) and unloading is straightforward if we ever need
 * it. Browsers that do not implement FontFace fall back to the <style>
 * tag path -- unlikely in practice, but the fallback keeps us functional.
 */

const FONT_FACE_PREFIX = "parasor-font-face-";
const injectedFamilies = new Set<string>();

export interface InjectFontOptions {
  family: string;
  /** URL the browser should GET for the font bytes (server serves TTF). */
  url: string;
  format?: "truetype" | "woff2" | "woff";
}

/**
 * Idempotent. Calling this twice with the same family is a no-op, so a
 * returning Settings user doesn't accumulate duplicate @font-face rules.
 */
export async function injectFontFace({
  family,
  url,
  format = "truetype",
}: InjectFontOptions): Promise<void> {
  if (injectedFamilies.has(family)) return;

  if (typeof FontFace === "function" && document.fonts) {
    const face = new FontFace(family, `url("${url}") format("${format}")`);
    try {
      await face.load();
    } catch (error) {
      // Leave injectedFamilies un-set so the caller can retry after fixing
      // the URL. Re-throw so the caller surfaces the failure.
      throw new Error(
        `Failed to load font "${family}" from ${url}: ${(error as Error).message}`,
      );
    }
    document.fonts.add(face);
    injectedFamilies.add(family);
    return;
  }

  const style = document.createElement("style");
  style.id = `${FONT_FACE_PREFIX}${family}`;
  style.textContent = `@font-face{font-family:"${family}";src:url("${url}") format("${format}");font-display:swap;}`;
  document.head.appendChild(style);
  injectedFamilies.add(family);
}

/** Test helper -- clears the injection cache. */
export function __resetInjectedFontsForTests(): void {
  injectedFamilies.clear();
}

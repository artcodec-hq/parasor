import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal as XTerm } from "@xterm/xterm";

/**
 * The `document.fonts` (FontFaceSet) surface this module actually touches --
 * narrowed and optional because not every browser exposes it.
 */
type FontSetLike =
  | {
      addEventListener?: (type: string, cb: () => void) => void;
      removeEventListener?: (type: string, cb: () => void) => void;
      load?: (font: string, text?: string) => Promise<FontFace[]>;
    }
  | undefined;

/**
 * Powerline right-arrow (U+E0B0) -- inside the bundled Nerd-Font `@font-face`
 * `unicode-range`. Used as the `document.fonts.load` sample text so the load
 * matches (and downloads) that face; the default sample " " (U+0020) is outside
 * the range and would resolve to an empty match with no fetch.
 */
const NERD_FONT_PREFETCH_SAMPLE = "";
const IOS_NERD_FONT_PREFETCH_DELAY_MS = 1000;

export type TerminalRendererFontEvent =
  | { type: "webgl-skip"; reason: "disabled" }
  | { type: "webgl-attach" }
  | { type: "webgl-error"; reason: string }
  | { type: "webgl-context-loss" }
  | { type: "font-loadingdone" }
  | { type: "ios-font-prefetch"; status: "loaded" | "failed" };

/**
 * Wires xterm's WebGL renderer (with automatic DOM fallback) and the font-atlas
 * rebuild that keeps glyphs sharp when fonts arrive after first render. Returns
 * a cleanup that detaches the `document.fonts` listener; the WebGL addon is
 * disposed by the caller's `term.dispose()` (xterm disposes loaded addons).
 *
 * @param options.isIos pre-fetch the bundled Symbols Nerd Font on iOS/iPadOS
 *   WebKit only -- it alone fails to trigger the canvas lazy `unicode-range`
 *   fetch, leaving powerline glyphs as tofu; other engines fetch lazily.
 */
export function attachWebglRendererAndFontAtlas(
  term: XTerm,
  options: {
    isIos: boolean;
    enableWebgl?: boolean;
    onEvent?: (event: TerminalRendererFontEvent) => void;
  },
): () => void {
  let webglAddon: WebglAddon | null = null;
  if (options.enableWebgl !== false) {
    try {
      webglAddon = new WebglAddon();
      // xterm.js README recommends disposing the addon on context loss so the
      // terminal automatically falls back to the DOM renderer instead of going
      // blank. Without this handler the canvas can stay black after a GPU context
      // loss event (page backgrounding, GPU memory pressure, etc.).
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = null;
        options.onEvent?.({ type: "webgl-context-loss" });
      });
      term.loadAddon(webglAddon);
      options.onEvent?.({ type: "webgl-attach" });
    } catch {
      // WebGL not available -- xterm falls back to DOM renderer automatically
      options.onEvent?.({ type: "webgl-error", reason: "unavailable" });
    }
  } else {
    options.onEvent?.({ type: "webgl-skip", reason: "disabled" });
  }

  /*
   * xterm builds its WebGL glyph atlas synchronously on first render. When a
   * font (Symbols Nerd Font, or a server-installed CJK preset) arrives after
   * that first render -- which is the whole point of lazy loading and preset
   * install-on-demand -- the atlas still holds the tofu or system-fallback
   * glyphs that were current when it was baked. Clearing the atlas + re-setting
   * fontFamily forces xterm to rebuild it from the now-loaded font.
   */
  const onFontsLoadingDone = () => {
    webglAddon?.clearTextureAtlas();
    // Re-assigning the same value is enough to trigger xterm's internal atlas
    // invalidation for DOM and WebGL renderers alike.
    const currentFontFamily = term.options.fontFamily;
    term.options.fontFamily = currentFontFamily;
    options.onEvent?.({ type: "font-loadingdone" });
  };
  const fontSet = document.fonts as unknown as FontSetLike;
  fontSet?.addEventListener?.("loadingdone", onFontsLoadingDone);
  let iosPrefetchTimer: number | null = null;

  if (options.isIos) {
    iosPrefetchTimer = window.setTimeout(() => {
      iosPrefetchTimer = null;
      const prefetch = fontSet?.load?.(
        '1em "Symbols Nerd Font"',
        NERD_FONT_PREFETCH_SAMPLE,
      );
      prefetch
        ?.then(() => {
          options.onEvent?.({ type: "ios-font-prefetch", status: "loaded" });
        })
        .catch(() => {
          options.onEvent?.({ type: "ios-font-prefetch", status: "failed" });
        });
    }, IOS_NERD_FONT_PREFETCH_DELAY_MS);
  }

  return () => {
    if (iosPrefetchTimer !== null) window.clearTimeout(iosPrefetchTimer);
    fontSet?.removeEventListener?.("loadingdone", onFontsLoadingDone);
  };
}

/*
 * Font configuration. UI and content surfaces each have a default stack plus
 * a free-text override the user supplies via Settings. Empty override ->
 * default as-is. Non-empty override is prepended to the default chain so
 * missing fonts still degrade through the full fallback list.
 *
 * "Symbols Nerd Font" is bundled via @font-face in app.css with a
 * unicode-range restricted to Nerd Font glyph blocks. Including it in the
 * default chain lets terminal panes and other monospace surfaces draw Nerd
 * Font icon glyphs from the bundled font on any device, without the user
 * having to install a patched font locally.
 */
export const DEFAULT_CONTENT_FONT_STACK =
  '"SF Mono", ui-monospace, Menlo, Consolas, "Symbols Nerd Font", "Noto Sans Mono CJK JP", monospace';
export const DEFAULT_UI_FONT_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const DEFAULT_FONT_STACK = DEFAULT_CONTENT_FONT_STACK;

/*
 * Quote a single font-family entry when the CSS parser requires it. Unquoted
 * identifiers in font-family must match /^[a-zA-Z_][a-zA-Z0-9_-]*$/ (and not
 * collide with reserved keywords like `serif`). Anything with spaces, digits
 * at the start, dots, or unusual characters must be wrapped in `"..."` or
 * the entire font-family declaration is considered invalid by stricter
 * parsers (WebKit), which then falls back to the UA serif default -- not
 * the next family in the chain. That's how a stray "JetBrains Mono Nerd
 * Font" typed into Settings can wipe out the whole UI render.
 */
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const RESERVED = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "-apple-system",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

function quoteFamily(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return trimmed;
  // Already quoted -- leave as-is so users can be explicit if they want.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed;
  }
  // Reserved generic keywords must stay unquoted or they lose their meaning.
  if (RESERVED.has(trimmed)) return trimmed;
  // Safe single-identifier names -- leave unquoted for cleaner output.
  if (IDENT_RE.test(trimmed)) return trimmed;
  // Anything else (spaces, dots, digits-first, etc.) must be quoted. Strip
  // any embedded double-quotes so we don't break the surrounding string.
  return `"${trimmed.replace(/"/g, "")}"`;
}

export function resolveFontStack(
  custom: string,
  defaultStack = DEFAULT_CONTENT_FONT_STACK,
): string {
  const trimmed = custom.trim();
  if (trimmed.length === 0) return defaultStack;
  // Split on commas so each user-provided family is individually quoted.
  // Multi-family input like `JetBrains Mono, Fira Code` becomes
  // `"JetBrains Mono", "Fira Code", <defaults>`.
  const entries = trimmed
    .split(",")
    .map((e) => quoteFamily(e))
    .filter((e) => e.length > 0);
  if (entries.length === 0) return defaultStack;
  return `${entries.join(", ")}, ${defaultStack}`;
}

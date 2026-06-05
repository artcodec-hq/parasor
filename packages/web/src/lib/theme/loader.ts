import monokaiRaw from "../../vendor/themes/monokai.json?raw";
import parasorDarkRaw from "../../vendor/themes/parasor-dark.json?raw";
import parasorLightRaw from "../../vendor/themes/parasor-light.json?raw";
import solarizedLightRaw from "../../vendor/themes/solarized-light.json?raw";
import tokyoNightRaw from "../../vendor/themes/tokyo-night.json?raw";
import vscodeDarkRaw from "./_baseline/vscode-dark.json?raw";
import vscodeLightRaw from "./_baseline/vscode-light.json?raw";
import { VSCODE_REFERENCES } from "./references.js";
import type {
  ColorThemeJson,
  TerminalColors,
  ThemeEntry,
  ThemeMode,
  WorkbenchTokens,
} from "./types.js";

export class ThemeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeValidationError";
  }
}

/**
 * Strip JSONC line and block comments (`//` / `/* * /`) without touching
 * comment-like sequences inside string literals. Newlines inside block
 * comments are preserved so JSON.parse error messages still point at the
 * correct line. Most distributed color themes (including Microsoft's own
 * `theme-monokai`) ship as JSONC, not strict JSON.
 */
function stripJsonComments(input: string): string {
  let out = "";
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    const next = input[i + 1];
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const sc = input[i];
        out += sc;
        if (sc === "\\" && i + 1 < n) {
          out += input[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (sc === '"') break;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && input[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(input[i] === "*" && input[i + 1] === "/")) {
        if (input[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Strip JSON5-style trailing commas (`, }` or `, ]`). Same string-tracking
 * approach as `stripJsonComments` so commas inside string literals are
 * untouched.
 */
function stripTrailingCommas(input: string): string {
  let out = "";
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const sc = input[i];
        out += sc;
        if (sc === "\\" && i + 1 < n) {
          out += input[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (sc === '"') break;
      }
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < n && /\s/.test(input[j])) j++;
      if (j < n && (input[j] === "}" || input[j] === "]")) {
        i++;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

export function parseColorThemeJson(raw: string): ColorThemeJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripTrailingCommas(stripJsonComments(raw)));
  } catch (e) {
    throw new ThemeValidationError(`Invalid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ThemeValidationError("Theme JSON must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.colors || typeof obj.colors !== "object") {
    throw new ThemeValidationError("Theme JSON must have a `colors` object");
  }
  // Color themes in the wild sometimes include non-string entries for
  // experimental keys (e.g. gradient arrays). Drop them silently rather than
  // rejecting the whole theme -- anything we actually reference is looked up
  // by string key, so non-string values simply have no effect.
  const rawColors = obj.colors as Record<string, unknown>;
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawColors)) {
    if (typeof value === "string") colors[key] = value;
  }
  const type = obj.type;
  if (
    type !== undefined &&
    type !== "dark" &&
    type !== "light" &&
    type !== "hc" &&
    type !== "hcLight"
  ) {
    throw new ThemeValidationError(
      `Theme \`type\` must be "dark" | "light" | "hc" | "hcLight" (got ${JSON.stringify(type)})`,
    );
  }
  // `name` is optional: many color themes carry their display name in
  // package.json, not the theme JSON itself (Microsoft's theme-monokai is
  // one). The Settings form supplies a user-chosen name that overrides
  // whatever value (if any) lived in the JSON, so missing name is fine.
  const name = typeof obj.name === "string" ? obj.name : "";
  return {
    name,
    type: type as ColorThemeJson["type"],
    colors,
  };
}

/**
 * Derive a dark/light mode from the theme's declared type or, failing that,
 * the relative luminance of its editor background. Lets users drop in a
 * raw color theme JSON without tagging it manually.
 */
export function detectMode(theme: ColorThemeJson): ThemeMode {
  if (theme.type === "light" || theme.type === "hcLight") return "light";
  if (theme.type === "dark" || theme.type === "hc") return "dark";
  const bg = theme.colors["editor.background"] ?? "#000000";
  return isDarkColor(bg) ? "dark" : "light";
}

function isDarkColor(hex: string): boolean {
  const parsed = parseHex(hex);
  if (!parsed) return true;
  // Perceived luminance (Rec. 601).
  const luminance = (parsed.r * 299 + parsed.g * 587 + parsed.b * 114) / 1000;
  return luminance < 128;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{6,8})$/.exec(hex);
  if (!m) return null;
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

/**
 * Append an alpha channel to a #rrggbb hex color. If the input already has an
 * alpha (#rrggbbaa), the existing alpha is multiplied by the new factor.
 * If it isn't a valid hex string the original value is returned so the
 * fallback chain stays robust.
 */
function withAlphaHex(hex: string, alpha: number): string {
  const eight = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(hex);
  if (eight) {
    const existing = parseInt(eight[2], 16) / 255;
    const a = Math.round(Math.max(0, Math.min(1, existing * alpha)) * 255);
    return `#${eight[1]}${a.toString(16).padStart(2, "0")}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `${hex}${a.toString(16).padStart(2, "0")}`;
}

const VSCODE_BASELINE_DARK = parseColorThemeJson(vscodeDarkRaw);
const VSCODE_BASELINE_LIGHT = parseColorThemeJson(vscodeLightRaw);

/**
 * Layer the theme over the matching VSCode baseline and apply VSCode's
 * registered reference defaults (e.g. `tab.activeBackground` mirrors
 * `editor.background`). Produces a fully-resolved color map that
 * downstream token builders can read directly without per-key fallback
 * chains.
 */
export function resolveTheme(theme: ColorThemeJson): ColorThemeJson {
  const baseline =
    detectMode(theme) === "dark" ? VSCODE_BASELINE_DARK : VSCODE_BASELINE_LIGHT;

  const colors: Record<string, string> = {
    ...baseline.colors,
    ...theme.colors,
  };

  // Fixed-point reference resolution. Limit iterations to guard against
  // accidental cycles in the table.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const ref of VSCODE_REFERENCES) {
      if (colors[ref.target]) continue;
      const src = colors[ref.source];
      if (!src) continue;
      colors[ref.target] =
        ref.alpha != null ? withAlphaHex(src, ref.alpha) : src;
      changed = true;
    }
    if (!changed) break;
  }

  return { ...theme, colors };
}

function buildTokens(resolved: ColorThemeJson): WorkbenchTokens {
  const c = resolved.colors;
  const mode = detectMode(resolved);
  return {
    "--theme-editor-bg": c["editor.background"],
    "--theme-editor-fg": c["editor.foreground"],
    "--theme-sidebar-bg": c["sideBar.background"],
    "--theme-sidebar-fg": c["sideBar.foreground"],
    "--theme-terminal-bg": c["terminal.background"],
    "--theme-description-fg": c.descriptionForeground,
    "--theme-border": c["panel.border"],
    "--theme-link-fg": c["textLink.foreground"],
    "--theme-list-active-bg": c["list.activeSelectionBackground"],
    "--theme-list-inactive-bg": c["list.inactiveSelectionBackground"],
    "--theme-list-active-fg": c["list.activeSelectionForeground"],
    "--theme-list-hover-bg": c["list.hoverBackground"],
    "--theme-button-secondary-bg": c["button.secondaryBackground"],
    "--theme-button-secondary-hover-bg": c["button.secondaryHoverBackground"],
    "--theme-tab-active-bg": c["tab.activeBackground"],
    "--theme-tab-inactive-bg": c["tab.inactiveBackground"],
    "--theme-tab-strip-bg": c["editorGroupHeader.tabsBackground"],
    "--theme-git-added": c["gitDecoration.addedResourceForeground"],
    "--theme-git-modified": c["gitDecoration.modifiedResourceForeground"],
    "--theme-git-deleted": c["gitDecoration.deletedResourceForeground"],
    "--theme-warning":
      c["list.warningForeground"] ??
      c["editorWarning.foreground"] ??
      c["inputValidation.warningBorder"] ??
      c["notificationsWarningIcon.foreground"] ??
      (mode === "light" ? "#855f00" : "#d7ba7d"),
    "--theme-diff-added-bg":
      c["diffEditor.insertedLineBackground"] ??
      c["diffEditor.insertedTextBackground"] ??
      (mode === "light" ? "#e3ffef" : "#243733"),
    "--theme-diff-deleted-bg":
      c["diffEditor.removedLineBackground"] ??
      c["diffEditor.removedTextBackground"] ??
      (mode === "light" ? "#ffe6ed" : "#3f282d"),
    "--theme-graph-branch-1": c["scmGraph.foreground1"],
    "--theme-graph-branch-2": c["scmGraph.foreground2"],
    "--theme-graph-branch-3": c["scmGraph.foreground3"],
    "--theme-graph-branch-4": c["scmGraph.foreground4"],
    "--theme-graph-branch-5": c["scmGraph.foreground5"],
    "--theme-graph-ref-base": c["scmGraph.historyItemRefColor"],
  };
}

function buildTerminalColors(resolved: ColorThemeJson): TerminalColors {
  const c = resolved.colors;
  return {
    background: c["terminal.background"],
    foreground: c["terminal.foreground"],
    cursor: c["terminalCursor.foreground"],
    cursorAccent: c["terminalCursor.background"],
    selectionBackground: c["terminal.selectionBackground"],
    black: c["terminal.ansiBlack"],
    red: c["terminal.ansiRed"],
    green: c["terminal.ansiGreen"],
    yellow: c["terminal.ansiYellow"],
    blue: c["terminal.ansiBlue"],
    magenta: c["terminal.ansiMagenta"],
    cyan: c["terminal.ansiCyan"],
    white: c["terminal.ansiWhite"],
    brightBlack: c["terminal.ansiBrightBlack"],
    brightRed: c["terminal.ansiBrightRed"],
    brightGreen: c["terminal.ansiBrightGreen"],
    brightYellow: c["terminal.ansiBrightYellow"],
    brightBlue: c["terminal.ansiBrightBlue"],
    brightMagenta: c["terminal.ansiBrightMagenta"],
    brightCyan: c["terminal.ansiBrightCyan"],
    brightWhite: c["terminal.ansiBrightWhite"],
  };
}

export function buildThemeEntry(
  id: string,
  theme: ColorThemeJson,
  source: ThemeEntry["source"],
): ThemeEntry {
  const resolved = resolveTheme(theme);
  return {
    id,
    name: theme.name,
    mode: detectMode(theme),
    source,
    tokens: buildTokens(resolved),
    terminal: buildTerminalColors(resolved),
  };
}

function entryFromRaw(id: string, raw: string): ThemeEntry {
  return buildThemeEntry(id, parseColorThemeJson(raw), "builtin");
}

export const BUILTIN_THEMES: ThemeEntry[] = [
  entryFromRaw("parasor-dark", parasorDarkRaw),
  entryFromRaw("parasor-light", parasorLightRaw),
  entryFromRaw("tokyo-night", tokyoNightRaw),
  entryFromRaw("solarized-light", solarizedLightRaw),
  entryFromRaw("monokai", monokaiRaw),
];

export const DEFAULT_THEME_ID = BUILTIN_THEMES[0].id;

export const WORKBENCH_TOKEN_KEYS = Object.keys(BUILTIN_THEMES[0].tokens);

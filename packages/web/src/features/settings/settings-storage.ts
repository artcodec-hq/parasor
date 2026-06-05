import {
  buildThemeEntry,
  DEFAULT_THEME_ID,
  parseColorThemeJson,
  ThemeValidationError,
} from "../../lib/theme/loader.js";
import type { ThemeEntry } from "../../lib/theme/types.js";

export interface CustomThemeInput {
  name: string;
  json: string;
}

export interface SettingsState {
  themeId: string;
  uiFontSize: number;
  contentFontSize: number;
  uiFontFamily: string;
  customFontFamily: string;
  fontPresetId: string;
  playAttentionSound: boolean;
  playCompletionSound: boolean;
}

export interface StoredCustomTheme {
  id: string;
  json: string;
}

const SETTINGS_KEY = "parasor:settings";
const CUSTOM_THEMES_KEY = "parasor:custom-themes";
const CUSTOM_THEME_PREFIX = "custom:";
/**
 * Cache of the most recently applied workbench tokens. Read by the inline
 * pre-paint hydration script in index.html so non-default themes don't flash
 * the default-theme fallback before React mounts.
 */
export const ACTIVE_THEME_TOKENS_KEY = "parasor:active-theme-tokens";
export const ACTIVE_THEME_MODE_KEY = "parasor:active-theme-mode";

export const CONTENT_FONT_SIZE_RANGE = {
  min: 12,
  max: 22,
} as const;

export const UI_FONT_SIZE_RANGE = {
  min: 12,
  max: 22,
} as const;

export const DEFAULT_SETTINGS_STATE: SettingsState = {
  themeId: DEFAULT_THEME_ID,
  uiFontSize: 16,
  contentFontSize: 16,
  uiFontFamily: "",
  customFontFamily: "",
  fontPresetId: "",
  playAttentionSound: false,
  playCompletionSound: false,
};

export function loadStoredCustomThemes(): StoredCustomTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredCustomTheme =>
        !!item &&
        typeof item === "object" &&
        typeof (item as StoredCustomTheme).id === "string" &&
        typeof (item as StoredCustomTheme).json === "string",
    );
  } catch {
    return [];
  }
}

export function buildCustomEntries(stored: StoredCustomTheme[]): ThemeEntry[] {
  const result: ThemeEntry[] = [];
  for (const item of stored) {
    try {
      result.push(
        buildThemeEntry(item.id, parseColorThemeJson(item.json), "custom"),
      );
    } catch {
      // Skip unparseable entries rather than failing the whole load.
    }
  }
  return result;
}

export function saveCustomThemes(items: StoredCustomTheme[]): void {
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(items));
  } catch {
    // localStorage unavailable -- fail silently
  }
}

export function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS_STATE;
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return {
      themeId:
        typeof parsed.themeId === "string" && parsed.themeId
          ? parsed.themeId
          : DEFAULT_SETTINGS_STATE.themeId,
      uiFontSize:
        typeof parsed.uiFontSize === "number"
          ? Math.min(
              UI_FONT_SIZE_RANGE.max,
              Math.max(UI_FONT_SIZE_RANGE.min, parsed.uiFontSize),
            )
          : DEFAULT_SETTINGS_STATE.uiFontSize,
      contentFontSize:
        typeof parsed.contentFontSize === "number"
          ? Math.min(
              CONTENT_FONT_SIZE_RANGE.max,
              Math.max(CONTENT_FONT_SIZE_RANGE.min, parsed.contentFontSize),
            )
          : DEFAULT_SETTINGS_STATE.contentFontSize,
      customFontFamily:
        typeof parsed.customFontFamily === "string"
          ? parsed.customFontFamily
          : DEFAULT_SETTINGS_STATE.customFontFamily,
      uiFontFamily:
        typeof parsed.uiFontFamily === "string"
          ? parsed.uiFontFamily
          : DEFAULT_SETTINGS_STATE.uiFontFamily,
      fontPresetId:
        typeof parsed.fontPresetId === "string"
          ? parsed.fontPresetId
          : DEFAULT_SETTINGS_STATE.fontPresetId,
      playAttentionSound:
        typeof parsed.playAttentionSound === "boolean"
          ? parsed.playAttentionSound
          : DEFAULT_SETTINGS_STATE.playAttentionSound,
      playCompletionSound:
        typeof parsed.playCompletionSound === "boolean"
          ? parsed.playCompletionSound
          : DEFAULT_SETTINGS_STATE.playCompletionSound,
    };
  } catch {
    return DEFAULT_SETTINGS_STATE;
  }
}

export function saveSettings(state: SettingsState): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable -- fail silently
  }
}

export function generateCustomId(
  existing: Set<string>,
  now: () => number = () => Date.now(),
): string {
  for (let i = 0; i < 1000; i++) {
    const id = `${CUSTOM_THEME_PREFIX}${now().toString(36)}-${i}`;
    if (!existing.has(id)) return id;
  }
  throw new Error("Failed to generate unique theme id");
}

export function createStoredCustomTheme(
  input: CustomThemeInput,
  existingIds: Iterable<string>,
  now: () => number = () => Date.now(),
) {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new ThemeValidationError("Theme name is required");
  }

  const theme = parseColorThemeJson(input.json);
  const id = generateCustomId(new Set(existingIds), now);
  const namedTheme = { ...theme, name: trimmedName };

  return {
    entry: buildThemeEntry(id, namedTheme, "custom"),
    storedTheme: {
      id,
      json: JSON.stringify(namedTheme),
    },
  };
}

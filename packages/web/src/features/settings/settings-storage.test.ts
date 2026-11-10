import { beforeEach, describe, expect, it } from "vitest";
import { ThemeValidationError } from "../../lib/theme/loader.js";
import {
  buildCustomEntries,
  CONTENT_FONT_SIZE_RANGE,
  createStoredCustomTheme,
  DEFAULT_SETTINGS_STATE,
  loadSettings,
  UI_FONT_SIZE_RANGE,
} from "./settings-storage.js";

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    get length() {
      return values.size;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("settings-storage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    localStorage.clear();
  });

  it("loads default settings when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS_STATE);
  });

  it("defaults content font size to 14px", () => {
    expect(DEFAULT_SETTINGS_STATE.contentFontSize).toBe(14);
    expect(loadSettings().contentFontSize).toBe(14);
  });

  it("clamps stored content font size into the allowed range", () => {
    localStorage.setItem(
      "parasor:settings",
      JSON.stringify({ contentFontSize: 999 }),
    );

    expect(loadSettings().contentFontSize).toBe(CONTENT_FONT_SIZE_RANGE.max);
  });

  it("clamps stored UI font size into the allowed range", () => {
    localStorage.setItem("parasor:settings", JSON.stringify({ uiFontSize: 1 }));

    expect(loadSettings().uiFontSize).toBe(UI_FONT_SIZE_RANGE.min);
  });

  it("keeps old settings without UI font size compatible", () => {
    localStorage.setItem(
      "parasor:settings",
      JSON.stringify({ contentFontSize: 18 }),
    );

    expect(loadSettings()).toMatchObject({
      uiFontSize: DEFAULT_SETTINGS_STATE.uiFontSize,
      contentFontSize: 18,
    });
  });

  it("keeps old settings without UI font family compatible", () => {
    localStorage.setItem(
      "parasor:settings",
      JSON.stringify({ customFontFamily: "JetBrains Mono" }),
    );

    expect(loadSettings()).toMatchObject({
      uiFontFamily: DEFAULT_SETTINGS_STATE.uiFontFamily,
      customFontFamily: "JetBrains Mono",
    });
  });

  it("loads stored UI font family when present", () => {
    localStorage.setItem(
      "parasor:settings",
      JSON.stringify({ uiFontFamily: "Inter, system-ui" }),
    );

    expect(loadSettings().uiFontFamily).toBe("Inter, system-ui");
  });

  it("loads stored sound preferences when present", () => {
    localStorage.setItem(
      "parasor:settings",
      JSON.stringify({
        playAttentionSound: true,
        playCompletionSound: true,
      }),
    );

    expect(loadSettings()).toMatchObject({
      playAttentionSound: true,
      playCompletionSound: true,
    });
  });

  it("builds custom theme entries and skips invalid payloads", () => {
    const entries = buildCustomEntries([
      {
        id: "custom:ok-0",
        json: JSON.stringify({
          name: "Night",
          type: "dark",
          colors: {
            "editor.background": "#000000",
            "editor.foreground": "#ffffff",
          },
        }),
      },
      {
        id: "custom:bad-0",
        json: "{bad json",
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("Night");
  });

  it("creates stored custom themes with trimmed names", () => {
    const result = createStoredCustomTheme(
      {
        name: "  Night Drive  ",
        json: JSON.stringify({
          type: "dark",
          colors: {
            "editor.background": "#000000",
            "editor.foreground": "#ffffff",
          },
        }),
      },
      [],
      () => 123,
    );

    expect(result.entry.id).toBe("custom:3f-0");
    expect(result.entry.name).toBe("Night Drive");
    expect(JSON.parse(result.storedTheme.json)).toMatchObject({
      name: "Night Drive",
    });
  });

  it("rejects blank custom theme names", () => {
    expect(() =>
      createStoredCustomTheme(
        {
          name: "   ",
          json: JSON.stringify({
            type: "dark",
            colors: {
              "editor.background": "#000000",
              "editor.foreground": "#ffffff",
            },
          }),
        },
        [],
      ),
    ).toThrow(ThemeValidationError);
  });
});

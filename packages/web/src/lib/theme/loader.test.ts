import { describe, expect, it } from "vitest";
import {
  BUILTIN_THEMES,
  buildThemeEntry,
  DEFAULT_THEME_ID,
  detectMode,
  parseColorThemeJson,
  resolveTheme,
  ThemeValidationError,
  WORKBENCH_TOKEN_KEYS,
} from "./loader.js";

describe("parseColorThemeJson", () => {
  it("parses a valid theme JSON", () => {
    const t = parseColorThemeJson(
      JSON.stringify({ name: "Test", colors: { foo: "#000" } }),
    );
    expect(t.name).toBe("Test");
    expect(t.colors.foo).toBe("#000");
  });

  it("rejects invalid JSON shape", () => {
    expect(() => parseColorThemeJson("{}")).toThrow(ThemeValidationError);
    expect(() => parseColorThemeJson(JSON.stringify({ name: "x" }))).toThrow();
  });

  it("treats `name` as optional (Settings form supplies the user-chosen name)", () => {
    const t = parseColorThemeJson(
      JSON.stringify({ type: "dark", colors: { "editor.background": "#000" } }),
    );
    expect(t.name).toBe("");
    expect(t.colors["editor.background"]).toBe("#000");
  });

  it("rejects malformed JSON", () => {
    expect(() => parseColorThemeJson("{not json")).toThrow(
      ThemeValidationError,
    );
  });

  it("strips JSONC line comments before parsing", () => {
    const raw = `// Header comment
{
  // inline comment
  "name": "JsonCTest",
  "type": "dark",
  "colors": {
    "editor.background": "#111111", // trailing comment
    "editor.foreground": "#eeeeee"
  }
}`;
    const t = parseColorThemeJson(raw);
    expect(t.name).toBe("JsonCTest");
    expect(t.colors["editor.background"]).toBe("#111111");
    expect(t.colors["editor.foreground"]).toBe("#eeeeee");
  });

  it("strips JSONC block comments", () => {
    const raw = `{
  /* Block
     comment */
  "name": "BlockComment",
  "colors": {
    "editor.background": "#222222"
    /* trailing block */
  }
}`;
    const t = parseColorThemeJson(raw);
    expect(t.name).toBe("BlockComment");
    expect(t.colors["editor.background"]).toBe("#222222");
  });

  it("strips trailing commas", () => {
    const raw = `{
      "name": "Trailing",
      "colors": {
        "editor.background": "#333333",
        "editor.foreground": "#cccccc",
      },
    }`;
    const t = parseColorThemeJson(raw);
    expect(t.colors["editor.background"]).toBe("#333333");
  });

  it("preserves comment-like sequences inside string literals", () => {
    const raw = `{
      "name": "HasSlashes",
      "colors": {
        "editor.background": "#000",
        "comment.test": "https://example.com/path"
      }
    }`;
    const t = parseColorThemeJson(raw);
    expect(t.colors["comment.test"]).toBe("https://example.com/path");
  });

  it("silently drops non-string color values", () => {
    const theme = parseColorThemeJson(
      JSON.stringify({
        name: "Permissive",
        colors: {
          "editor.background": "#000",
          "editor.foreground": "#fff",
          "symbolIcon.constantForeground": ["#fff", "#000"],
        },
      }),
    );
    expect(theme.colors["editor.background"]).toBe("#000");
    expect(theme.colors["symbolIcon.constantForeground"]).toBeUndefined();
  });

  it("rejects invalid theme type", () => {
    expect(() =>
      parseColorThemeJson(
        JSON.stringify({ name: "Bad", type: "purple", colors: {} }),
      ),
    ).toThrow(/type/);
  });
});

describe("detectMode", () => {
  it("respects explicit theme.type", () => {
    expect(detectMode({ name: "x", type: "light", colors: {} })).toBe("light");
    expect(detectMode({ name: "x", type: "dark", colors: {} })).toBe("dark");
    expect(detectMode({ name: "x", type: "hcLight", colors: {} })).toBe(
      "light",
    );
    expect(detectMode({ name: "x", type: "hc", colors: {} })).toBe("dark");
  });

  it("falls back to luminance of editor.background", () => {
    expect(
      detectMode({ name: "x", colors: { "editor.background": "#ffffff" } }),
    ).toBe("light");
    expect(
      detectMode({ name: "x", colors: { "editor.background": "#000000" } }),
    ).toBe("dark");
  });
});

describe("resolveTheme", () => {
  it("layers user theme over the matching VSCode baseline", () => {
    // Empty user theme -> fully populated by baseline.
    const r = resolveTheme({ name: "x", type: "dark", colors: {} });
    expect(r.colors["editor.background"]).toBe("#1E1E1E");
    expect(r.colors["editor.foreground"]).toBe("#BBBBBB");
    expect(r.colors["sideBar.background"]).toBe("#252526");
    expect(r.colors["list.activeSelectionBackground"]).toBe("#04395E");
    expect(r.colors["textLink.foreground"]).toBe("#3794FF");
    expect(r.colors["gitDecoration.addedResourceForeground"]).toBe("#81B88B");
    expect(r.colors["scmGraph.foreground1"]).toBe("#FFB000");
  });

  it("user-declared keys win over baseline", () => {
    const r = resolveTheme({
      name: "x",
      type: "dark",
      colors: {
        "editor.background": "#abcdef",
        "sideBar.background": "#123456",
      },
    });
    expect(r.colors["editor.background"]).toBe("#abcdef");
    expect(r.colors["sideBar.background"]).toBe("#123456");
  });

  it("resolves reference defaults: tab.activeBackground mirrors editor.background", () => {
    const r = resolveTheme({
      name: "x",
      type: "dark",
      colors: { "editor.background": "#abcdef" },
    });
    expect(r.colors["tab.activeBackground"]).toBe("#abcdef");
    expect(r.colors["terminal.background"]).toBe("#abcdef");
  });

  it("resolves reference with alpha: descriptionForeground = editor.foreground @ 0.7", () => {
    const r = resolveTheme({
      name: "x",
      type: "dark",
      colors: {
        "editor.foreground": "#ffffff",
      },
    });
    // 0.7 * 255 = 178.5 -> 179 -> 0xb3
    expect(r.colors.descriptionForeground).toBe("#ffffffb3");
  });

  it("resolves chained references via fixed-point iteration", () => {
    // terminalCursor.background -> terminal.background -> editor.background
    const r = resolveTheme({
      name: "x",
      type: "dark",
      colors: { "editor.background": "#101010" },
    });
    expect(r.colors["terminalCursor.background"]).toBe("#101010");
  });

  it("explicit user value preempts reference resolution", () => {
    const r = resolveTheme({
      name: "x",
      type: "dark",
      colors: {
        "editor.background": "#000000",
        "tab.activeBackground": "#ffffff",
      },
    });
    expect(r.colors["tab.activeBackground"]).toBe("#ffffff");
  });

  it("uses light baseline for light themes", () => {
    const r = resolveTheme({ name: "x", type: "light", colors: {} });
    expect(r.colors["editor.background"]).toBe("#FFFFFF");
    expect(r.colors["sideBar.background"]).toBe("#F3F3F3");
  });
});

describe("buildThemeEntry", () => {
  it("populates all workbench tokens from baseline when user theme is sparse", () => {
    const entry = buildThemeEntry(
      "min",
      { name: "Min", type: "dark", colors: {} },
      "custom",
    );
    expect(entry.tokens["--theme-editor-bg"]).toBe("#1E1E1E");
    expect(entry.tokens["--theme-editor-fg"]).toBe("#BBBBBB");
    expect(entry.tokens["--theme-sidebar-bg"]).toBe("#252526");
    expect(entry.tokens["--theme-link-fg"]).toBe("#3794FF");
    expect(entry.tokens["--theme-list-active-bg"]).toBe("#04395E");
    expect(entry.tokens["--theme-list-inactive-bg"]).toBe("#37373D");
    expect(entry.tokens["--theme-git-added"]).toBe("#81B88B");
    expect(entry.tokens["--theme-warning"]).toBe("#d7ba7d");
    expect(entry.tokens["--theme-diff-added-bg"]).toBe("#243733");
    expect(entry.tokens["--theme-diff-deleted-bg"]).toBe("#3f282d");
    expect(entry.tokens["--theme-graph-branch-1"]).toBe("#FFB000");
    expect(entry.terminal.black).toBe("#000000");
    expect(entry.terminal.brightBlue).toBe("#3B8EEA");
  });

  it("propagates user-defined editor.foreground through alpha references", () => {
    const entry = buildThemeEntry(
      "alpha",
      {
        name: "Alpha",
        type: "dark",
        colors: {
          "editor.background": "#000000",
          "editor.foreground": "#ffffff",
        },
      },
      "custom",
    );
    // descriptionForeground = editor.foreground @ 0.7
    expect(entry.tokens["--theme-description-fg"]).toBe("#ffffffb3");
  });

  it("user-declared scmGraph palette wins over baseline", () => {
    const entry = buildThemeEntry(
      "graph-palette",
      {
        name: "GraphPalette",
        type: "dark",
        colors: {
          "scmGraph.foreground1": "#111111",
          "scmGraph.foreground5": "#555555",
          "scmGraph.historyItemRefColor": "#abcdef",
        },
      },
      "custom",
    );
    expect(entry.tokens["--theme-graph-branch-1"]).toBe("#111111");
    expect(entry.tokens["--theme-graph-branch-5"]).toBe("#555555");
    expect(entry.tokens["--theme-graph-ref-base"]).toBe("#abcdef");
    // Unspecified slots fall through to baseline.
    expect(entry.tokens["--theme-graph-branch-2"]).toBe("#DC267F");
  });

  it("user-declared gitDecoration colors win over baseline", () => {
    const entry = buildThemeEntry(
      "git",
      {
        name: "Git",
        type: "dark",
        colors: {
          "gitDecoration.addedResourceForeground": "#aabbcc",
          "gitDecoration.modifiedResourceForeground": "#ddeeff",
        },
      },
      "custom",
    );
    expect(entry.tokens["--theme-git-added"]).toBe("#aabbcc");
    expect(entry.tokens["--theme-git-modified"]).toBe("#ddeeff");
    // Unspecified falls to baseline.
    expect(entry.tokens["--theme-git-deleted"]).toBe("#C74E39");
  });

  it("keeps app warning separate from git modified decoration", () => {
    const entry = buildThemeEntry(
      "warning",
      {
        name: "Warning",
        type: "dark",
        colors: {
          "gitDecoration.modifiedResourceForeground": "#ddeeff",
          "list.warningForeground": "#ccb36a",
        },
      },
      "custom",
    );
    expect(entry.tokens["--theme-git-modified"]).toBe("#ddeeff");
    expect(entry.tokens["--theme-warning"]).toBe("#ccb36a");
  });

  it("uses declared diff editor line backgrounds when present", () => {
    const entry = buildThemeEntry(
      "diff-bg",
      {
        name: "DiffBg",
        type: "light",
        colors: {
          "diffEditor.insertedLineBackground": "#ccffdd",
          "diffEditor.removedLineBackground": "#ffd4dc",
        },
      },
      "custom",
    );
    expect(entry.tokens["--theme-diff-added-bg"]).toBe("#ccffdd");
    expect(entry.tokens["--theme-diff-deleted-bg"]).toBe("#ffd4dc");
  });

  it("--theme-border maps to panel.border (user value or baseline)", () => {
    const userPanel = buildThemeEntry(
      "panel-border",
      {
        name: "PanelBorder",
        type: "dark",
        colors: { "panel.border": "#222222" },
      },
      "custom",
    );
    expect(userPanel.tokens["--theme-border"]).toBe("#222222");

    // Baseline default for panel.border is #80808059.
    const sparse = buildThemeEntry(
      "sparse-border",
      { name: "Sparse", type: "dark", colors: {} },
      "custom",
    );
    expect(sparse.tokens["--theme-border"]).toBe("#80808059");
  });

  it("tab.activeBackground reference mirrors user editor.background", () => {
    const entry = buildThemeEntry(
      "tab-mirror",
      {
        name: "TabMirror",
        type: "dark",
        colors: { "editor.background": "#abc123" },
      },
      "custom",
    );
    expect(entry.tokens["--theme-tab-active-bg"]).toBe("#abc123");
    expect(entry.terminal.background).toBe("#abc123");
  });
});

describe("built-in themes", () => {
  it("ships parasor + curated color theme built-ins", () => {
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(ids).toContain("parasor-dark");
    expect(ids).toContain("parasor-light");
    expect(ids).toContain("tokyo-night");
    expect(ids).toContain("solarized-light");
    expect(ids).toContain("monokai");
  });

  it("does not surface internal VSCode baselines as selectable themes", () => {
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(ids).not.toContain("vscode-dark");
    expect(ids).not.toContain("vscode-light");
  });

  it("defaults to parasor-dark", () => {
    expect(DEFAULT_THEME_ID).toBe("parasor-dark");
  });

  it("marks built-ins with source=builtin", () => {
    for (const theme of BUILTIN_THEMES) {
      expect(theme.source).toBe("builtin");
    }
  });

  it("assigns the first built-in as the default", () => {
    expect(DEFAULT_THEME_ID).toBe(BUILTIN_THEMES[0].id);
  });

  it("ships parasor graph colors instead of relying on VSCode fallback", () => {
    const expected = {
      "--theme-graph-branch-1": "#FFB000",
      "--theme-graph-branch-2": "#FF3D8B",
      "--theme-graph-branch-3": "#00B86B",
      "--theme-graph-branch-4": "#00AEEF",
      "--theme-graph-branch-5": "#8B5CF6",
    };
    for (const id of ["parasor-dark", "parasor-light"]) {
      const theme = BUILTIN_THEMES.find((t) => t.id === id);
      expect(theme?.tokens).toMatchObject(expected);
    }
  });

  it("exposes the set of workbench token keys", () => {
    expect(WORKBENCH_TOKEN_KEYS).toContain("--theme-editor-bg");
    expect(WORKBENCH_TOKEN_KEYS).toContain("--theme-link-fg");
  });
});

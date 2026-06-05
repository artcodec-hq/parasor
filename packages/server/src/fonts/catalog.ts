/*
 * Monospace font preset catalog -- the whitelist of fonts the server is
 * willing to download from GitHub Releases on behalf of a client. Anything
 * not in this table is rejected by the install endpoint, so arbitrary URL
 * downloads are impossible even if an attacker can reach /api/fonts.
 *
 * Each entry pins a specific release tag. yuru7's asset filenames embed the
 * version so GitHub's `releases/latest/download/<file>` redirect cannot be
 * used -- the catalog must be bumped manually when upgrading a font.
 *
 * `regularMatch` is a substring the installer looks for in each zip entry
 * (case-insensitive). The first file matching AND ending in `.ttf` is
 * extracted as the Regular weight; everything else is discarded. This keeps
 * the cache at a single TTF per preset even when the source zip ships every
 * weight + italic + hinted/unhinted variants.
 */
export interface FontPreset {
  id: string;
  /** Display name for UI. */
  name: string;
  /** Category controls the UI grouping (2:1 CJK vs. Latin-only). */
  category: "asian" | "latin";
  /** CSS font-family value the `@font-face` rule will declare. */
  family: string;
  /** Direct GitHub release asset URL. */
  zipUrl: string;
  /** Substring used to locate the Regular-weight TTF inside the zip. */
  regularMatch: string;
  /**
   * Rough zip download size in MB, shown in the UI so the user can make an
   * informed choice before a large download starts.
   */
  zipSizeMb: number;
  /**
   * Short description highlighting why a user might pick this preset.
   */
  description: string;
}

export const FONT_PRESETS: readonly FontPreset[] = [
  {
    id: "udev-gothic",
    name: "UDEV Gothic",
    category: "asian",
    family: "UDEV Gothic",
    zipUrl:
      "https://github.com/yuru7/udev-gothic/releases/download/v2.2.0/UDEVGothic_v2.2.0.zip",
    regularMatch: "UDEVGothic-Regular",
    zipSizeMb: 59,
    description: "JetBrains Mono + BIZ UDGothic. Japanese, 2:1 CJK alignment.",
  },
  {
    id: "d2-coding",
    name: "D2 Coding",
    category: "asian",
    family: "D2 Coding",
    zipUrl:
      "https://github.com/naver/d2codingfont/releases/download/VER1.3.2/D2Coding-Ver1.3.2-20180524.zip",
    regularMatch: "D2Coding/D2Coding-Ver",
    zipSizeMb: 20,
    description: "Naver D2 Coding. Korean coding font with Hangul support.",
  },
  {
    id: "maple-mono-cn",
    name: "Maple Mono CN",
    category: "asian",
    family: "Maple Mono CN",
    zipUrl:
      "https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-CN.zip",
    regularMatch: "MapleMono-CN-Regular",
    zipSizeMb: 134,
    description: "Maple Mono with Simplified Chinese coverage.",
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    category: "latin",
    family: "JetBrains Mono",
    zipUrl:
      "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip",
    regularMatch: "JetBrainsMono-Regular",
    zipSizeMb: 5,
    description: "Popular coding font with ligatures and clear punctuation.",
  },
  {
    id: "fira-code",
    name: "Fira Code",
    category: "latin",
    family: "Fira Code",
    zipUrl:
      "https://github.com/tonsky/FiraCode/releases/download/6.2/Fira_Code_v6.2.zip",
    regularMatch: "FiraCode-Regular",
    zipSizeMb: 3,
    description: "Monospace font with programming ligatures.",
  },
] as const;

export function findPreset(id: string): FontPreset | undefined {
  return FONT_PRESETS.find((preset) => preset.id === id);
}

/*
 * Guard for URL path segments that get joined with the cache directory. An
 * id that contains `..`, `/`, or `\` would allow an attacker-controlled
 * install request to write outside the cache root, so the id must match the
 * whitelist exactly. Defense-in-depth on top of findPreset -- the id also
 * has to exist in the preset table.
 */
export function isValidPresetId(id: unknown): id is string {
  return typeof id === "string" && FONT_PRESETS.some((p) => p.id === id);
}

/*
 * Re-exported shape for client consumption. Mirrors FontPreset minus the
 * server-internal zipUrl / regularMatch which a client has no business
 * seeing. The web UI builds its own preset list from a hardcoded mirror, but
 * this type keeps the shape shared.
 */
export interface PublicFontPreset {
  id: string;
  name: string;
  category: "asian" | "latin";
  family: string;
  zipSizeMb: number;
  description: string;
}

export function toPublicPreset(preset: FontPreset): PublicFontPreset {
  return {
    id: preset.id,
    name: preset.name,
    category: preset.category,
    family: preset.family,
    zipSizeMb: preset.zipSizeMb,
    description: preset.description,
  };
}

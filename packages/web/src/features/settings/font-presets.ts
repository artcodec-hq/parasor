/*
 * Client-side mirror of the server's font catalog. Kept separate from the
 * server module so the web bundle does not pull in server-only code, and
 * so the client can render the preset list before the first /api/fonts/
 * round-trip completes. The server rejects any id that does not also
 * appear in its own whitelist -- the two lists must stay in sync.
 */

import { authFetch } from "../../lib/auth-fetch.js";

export interface ClientFontPreset {
  id: string;
  name: string;
  category: "latin" | "asian";
  family: string;
  zipSizeMb: number;
  description: string;
}

export const CLIENT_FONT_PRESETS: readonly ClientFontPreset[] = [
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    category: "latin",
    family: "JetBrains Mono",
    zipSizeMb: 5,
    description: "Popular coding font with ligatures.",
  },
  {
    id: "fira-code",
    name: "Fira Code",
    category: "latin",
    family: "Fira Code",
    zipSizeMb: 3,
    description: "Monospace font with programming ligatures.",
  },
  {
    id: "udev-gothic",
    name: "UDEV Gothic",
    category: "asian",
    family: "UDEV Gothic",
    zipSizeMb: 59,
    description: "JetBrains Mono + BIZ UDGothic. Japanese, 2:1 CJK alignment.",
  },
  {
    id: "d2-coding",
    name: "D2 Coding",
    category: "asian",
    family: "D2 Coding",
    zipSizeMb: 20,
    description: "Naver D2 Coding. Korean coding font with Hangul support.",
  },
  {
    id: "maple-mono-cn",
    name: "Maple Mono CN",
    category: "asian",
    family: "Maple Mono CN",
    zipSizeMb: 134,
    description: "Maple Mono with Simplified Chinese coverage.",
  },
] as const;

export function findClientPreset(id: string): ClientFontPreset | undefined {
  return CLIENT_FONT_PRESETS.find((p) => p.id === id);
}

export interface CatalogEntry extends ClientFontPreset {
  installed: boolean;
}

export interface InstallResponse {
  id: string;
  family: string;
  url: string;
  installed: true;
}

export interface InstallErrorBody {
  error: string;
  kind?: string;
}

/**
 * Hit the server catalog endpoint so the UI knows which presets are
 * already cached on this backend. Falls back to "nothing installed" on
 * network error rather than hiding the list entirely.
 */
export async function fetchCatalog(): Promise<CatalogEntry[]> {
  try {
    const response = await authFetch("/api/fonts/catalog", {
      credentials: "same-origin",
    });
    if (!response.ok) return CLIENT_FONT_PRESETS.map(toUninstalledEntry);
    const body = (await response.json()) as {
      presets?: Array<{ id: string; installed: boolean }>;
    };
    const statusById = new Map<string, boolean>();
    for (const entry of body.presets ?? []) {
      statusById.set(entry.id, entry.installed);
    }
    return CLIENT_FONT_PRESETS.map((preset) => ({
      ...preset,
      installed: statusById.get(preset.id) ?? false,
    }));
  } catch {
    return CLIENT_FONT_PRESETS.map(toUninstalledEntry);
  }
}

function toUninstalledEntry(preset: ClientFontPreset): CatalogEntry {
  return { ...preset, installed: false };
}

export async function requestInstall(id: string): Promise<InstallResponse> {
  const response = await authFetch("/api/fonts/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ id }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const err = body as InstallErrorBody | null;
    throw new Error(err?.error ?? `install failed (${response.status})`);
  }
  return body as InstallResponse;
}

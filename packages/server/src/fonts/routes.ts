import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import {
  FONT_PRESETS,
  findPreset,
  isValidPresetId,
  toPublicPreset,
} from "./catalog.js";
import { FontInstallError, type FontInstaller } from "./installer.js";

/*
 * Font download / serving routes.
 *
 * GET  /api/fonts/catalog      list presets + which ones are already cached
 * POST /api/fonts/install      body { id } -> cache miss triggers zip DL
 * GET  /api/fonts/file/:id     stream the cached TTF, 404 if not installed
 *
 * Everything lives under /api so the session-auth middleware (cookie or
 * token) protects each endpoint. The TTF download is large but infrequent,
 * so there is no separate unauthenticated static mount -- any client that
 * can reach /api has the cookie a @font-face GET needs.
 */
export function createFontRoutes(installer: FontInstaller): Hono {
  const app = new Hono();

  app.get("/catalog", async (c) => {
    const installedIds = new Set(await installer.listInstalled());
    const presets = FONT_PRESETS.map((preset) => ({
      ...toPublicPreset(preset),
      installed: installedIds.has(preset.id),
    }));
    return c.json({ presets });
  });

  app.post("/install", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    const id = body?.id;
    if (!isValidPresetId(id)) {
      return c.json({ error: "unknown preset id" }, 400);
    }
    const preset = findPreset(id);
    if (!preset) {
      return c.json({ error: "unknown preset id" }, 400);
    }
    try {
      const result = await installer.install(preset);
      return c.json({
        id: result.id,
        family: result.family,
        url: `/api/fonts/file/${result.id}`,
        installed: true,
      });
    } catch (error) {
      if (error instanceof FontInstallError) {
        const status =
          error.kind === "download_failed"
            ? 502
            : error.kind === "asset_not_found"
              ? 404
              : 500;
        return c.json({ error: error.message, kind: error.kind }, status);
      }
      throw error;
    }
  });

  app.get("/file/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidPresetId(id)) {
      return c.json({ error: "unknown preset id" }, 400);
    }
    const resolved = await installer.resolveInstalled(id);
    if (!resolved) {
      return c.json({ error: "not installed" }, 404);
    }
    let size: number | undefined;
    try {
      size = (await stat(resolved.filePath)).size;
    } catch {
      return c.json({ error: "not installed" }, 404);
    }
    c.header("Content-Type", "font/ttf");
    c.header("Content-Length", String(size));
    // TTFs are immutable per-install (same version always produces the same
    // bytes) -- let the browser cache aggressively so picking an installed
    // preset a second time doesn't re-fetch.
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return stream(c, async (s) => {
      const nodeStream = createReadStream(resolved.filePath);
      const webStream = Readable.toWeb(
        nodeStream,
      ) as ReadableStream<Uint8Array>;
      await s.pipe(webStream);
    });
  });

  return app;
}

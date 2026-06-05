import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import type { FontPreset } from "./catalog.js";

/*
 * GitHub release zips for monospace fonts can be anywhere from 3MB (Fira
 * Code) to 130+MB (Maple Mono CN -- Simplified Chinese coverage). Extracting
 * a single Regular TTF from a 100MB+ zip in memory is not viable, so the
 * installer streams the download to a temp file, opens it with yauzl (zip64
 * support, streaming central directory scan), extracts exactly one file,
 * then deletes the zip. Peak disk usage = zipSize + ~5MB extracted TTF.
 *
 * Cache layout:
 *   <root>/<id>/font.ttf     -- the extracted Regular TTF
 *   <root>/<id>/family.txt   -- CSS font-family name (written at install time
 *                              so the serving route doesn't need the catalog
 *                              to answer "what family is this?")
 *
 * A successful install is atomic: the TTF is extracted to a `.tmp` sibling
 * and renamed into place last. An interrupted download leaves an empty or
 * partial directory that the next install attempt overwrites.
 */

export interface InstallResult {
  id: string;
  family: string;
  filename: string;
  /** Absolute path of the cached TTF on disk. */
  filePath: string;
}

export class FontInstallError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "download_failed"
      | "asset_not_found"
      | "extract_failed"
      | "io_failed",
  ) {
    super(message);
  }
}

export interface InstallerOptions {
  /** Override for tests so they can stub the download. */
  fetchImpl?: typeof fetch;
  /** Override cache root -- defaults to ~/.cache/parasor/fonts. */
  cacheDir?: string;
}

export function defaultCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, "parasor", "fonts");
}

export class FontInstaller {
  private readonly cacheDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly inflight = new Map<string, Promise<InstallResult>>();

  constructor(opts: InstallerOptions = {}) {
    this.cacheDir = opts.cacheDir ?? defaultCacheDir();
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * Path of the cached TTF if already installed, otherwise null. Used by the
   * static serving route to short-circuit without touching the installer.
   */
  async resolveInstalled(
    id: string,
  ): Promise<{ filePath: string; family: string } | null> {
    const dir = join(this.cacheDir, id);
    const ttfPath = join(dir, "font.ttf");
    try {
      const st = await stat(ttfPath);
      if (!st.isFile() || st.size === 0) return null;
    } catch {
      return null;
    }
    try {
      const familyFile = join(dir, "family.txt");
      const { readFile } = await import("node:fs/promises");
      const family = (await readFile(familyFile, "utf-8")).trim();
      if (!family) return null;
      return { filePath: ttfPath, family };
    } catch {
      return null;
    }
  }

  async listInstalled(): Promise<string[]> {
    const { readdir } = await import("node:fs/promises");
    try {
      const entries = await readdir(this.cacheDir, { withFileTypes: true });
      const installed: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const resolved = await this.resolveInstalled(entry.name);
        if (resolved) installed.push(entry.name);
      }
      return installed;
    } catch {
      return [];
    }
  }

  /**
   * Install a preset. Concurrent calls for the same id share a single
   * download -- the second caller awaits the first rather than kicking off a
   * duplicate 700MB fetch.
   */
  async install(preset: FontPreset): Promise<InstallResult> {
    const existing = this.inflight.get(preset.id);
    if (existing) return existing;
    const promise = this.doInstall(preset).finally(() => {
      this.inflight.delete(preset.id);
    });
    this.inflight.set(preset.id, promise);
    return promise;
  }

  private async doInstall(preset: FontPreset): Promise<InstallResult> {
    const resolved = await this.resolveInstalled(preset.id);
    if (resolved) {
      return {
        id: preset.id,
        family: resolved.family,
        filename: "font.ttf",
        filePath: resolved.filePath,
      };
    }

    const targetDir = join(this.cacheDir, preset.id);
    await mkdir(targetDir, { recursive: true });
    const zipPath = join(targetDir, "download.zip.tmp");
    const ttfTmpPath = join(targetDir, "font.ttf.tmp");
    const ttfPath = join(targetDir, "font.ttf");
    const familyPath = join(targetDir, "family.txt");

    try {
      await this.downloadTo(preset.zipUrl, zipPath);
      await this.extractRegularTtf(zipPath, preset.regularMatch, ttfTmpPath);
      await rename(ttfTmpPath, ttfPath);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(familyPath, preset.family, "utf-8");
      return {
        id: preset.id,
        family: preset.family,
        filename: "font.ttf",
        filePath: ttfPath,
      };
    } finally {
      // Best-effort cleanup of temp artifacts.
      await rm(zipPath, { force: true });
      await rm(ttfTmpPath, { force: true });
    }
  }

  private async downloadTo(url: string, destPath: string): Promise<void> {
    await mkdir(dirname(destPath), { recursive: true });
    let response: Response;
    try {
      response = await this.fetchImpl(url, { redirect: "follow" });
    } catch (error) {
      throw new FontInstallError(
        `download failed: ${(error as Error).message}`,
        "download_failed",
      );
    }
    if (!response.ok || !response.body) {
      throw new FontInstallError(
        `download returned ${response.status}`,
        "download_failed",
      );
    }
    try {
      // response.body is a web-stream ReadableStream; Readable.fromWeb bridges
      // it into a Node stream that pipeline() can consume.
      const nodeStream = Readable.fromWeb(
        response.body as Parameters<typeof Readable.fromWeb>[0],
      );
      await pipeline(nodeStream, createWriteStream(destPath));
    } catch (error) {
      throw new FontInstallError(
        `write failed: ${(error as Error).message}`,
        "io_failed",
      );
    }
  }

  private extractRegularTtf(
    zipPath: string,
    matchSubstring: string,
    destPath: string,
  ): Promise<void> {
    const matchLower = matchSubstring.toLowerCase();
    return new Promise<void>((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) {
          reject(
            new FontInstallError(
              `zip open failed: ${err?.message ?? "no zipfile"}`,
              "extract_failed",
            ),
          );
          return;
        }
        let extracted = false;
        zipfile.readEntry();
        zipfile.on("entry", (entry: yauzl.Entry) => {
          if (extracted) {
            zipfile.close();
            return;
          }
          const name = entry.fileName;
          const isDir = /\/$/.test(name);
          const lower = name.toLowerCase();
          const isMatch =
            !isDir && lower.endsWith(".ttf") && lower.includes(matchLower);
          if (!isMatch) {
            zipfile.readEntry();
            return;
          }
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr || !readStream) {
              zipfile.close();
              reject(
                new FontInstallError(
                  `read stream failed: ${streamErr?.message ?? "no stream"}`,
                  "extract_failed",
                ),
              );
              return;
            }
            const writeStream = createWriteStream(destPath);
            pipeline(readStream, writeStream)
              .then(() => {
                extracted = true;
                zipfile.close();
                resolve();
              })
              .catch((pipeErr) => {
                zipfile.close();
                reject(
                  new FontInstallError(
                    `extract write failed: ${(pipeErr as Error).message}`,
                    "extract_failed",
                  ),
                );
              });
          });
        });
        zipfile.on("end", () => {
          if (!extracted) {
            reject(
              new FontInstallError(
                `no Regular TTF matching "${matchSubstring}" in zip`,
                "asset_not_found",
              ),
            );
          }
        });
        zipfile.on("error", (zipErr) => {
          reject(
            new FontInstallError(
              `zip error: ${zipErr.message}`,
              "extract_failed",
            ),
          );
        });
      });
    });
  }
}

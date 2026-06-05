/*
 * One-shot TTF -> woff2 conversion for the bundled Symbols Nerd Font.
 *
 * Run manually whenever SymbolsNerdFont-Regular.ttf is refreshed from the
 * upstream Nerd Fonts release; the resulting .woff2 is committed alongside
 * the .ttf. We chose a committed artifact over a build-time step because
 * wawoff2 is a wasm module and plugging it into Vite's asset pipeline for
 * a single file would add more surface area than the optimisation warrants.
 *
 * Run:  pnpm --filter @parasor/web exec tsx scripts/compress-nerd-font.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(here, "..", "src", "assets", "fonts");
const ttfPath = join(fontsDir, "SymbolsNerdFont-Regular.ttf");
const woff2Path = join(fontsDir, "SymbolsNerdFont-Regular.woff2");

const wawoff2 = (await import("wawoff2")) as {
  compress: (buf: Uint8Array) => Promise<Uint8Array>;
};

const ttf = await readFile(ttfPath);
const woff2 = await wawoff2.compress(new Uint8Array(ttf));
await writeFile(woff2Path, woff2);

process.stdout.write(
  `Wrote ${woff2Path} (${(woff2.byteLength / 1024).toFixed(1)} KB from ${(ttf.byteLength / 1024).toFixed(1)} KB TTF)\n`,
);

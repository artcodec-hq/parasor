import { Buffer } from "node:buffer";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import yazl from "yazl";
import { FontInstaller } from "./installer.js";
import { createFontRoutes } from "./routes.js";

function makeZip(
  entries: Array<{ name: string; content: Buffer }>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const entry of entries) {
      zip.addBuffer(entry.content, entry.name);
    }
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
}

function stubFetch(zipBuf: Buffer): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(zipBuf));
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("font routes", () => {
  it("rejects install requests with unknown preset id", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "parasor-fonts-"));
    try {
      const installer = new FontInstaller({ cacheDir });
      const app = createFontRoutes(installer);
      const res = await app.request("/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "../etc/passwd" }),
      });
      expect(res.status).toBe(400);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("lists catalog with installed flags set correctly", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "parasor-fonts-"));
    try {
      const zipBuf = await makeZip([
        {
          name: "FiraCode-Regular.ttf",
          content: Buffer.from("FAKE"),
        },
      ]);
      const installer = new FontInstaller({
        cacheDir,
        fetchImpl: stubFetch(zipBuf),
      });
      const app = createFontRoutes(installer);

      const installRes = await app.request("/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "fira-code" }),
      });
      expect(installRes.status).toBe(200);
      const installBody = await installRes.json();
      expect(installBody.url).toBe("/api/fonts/file/fira-code");
      expect(installBody.family).toBe("Fira Code");

      const catalogRes = await app.request("/catalog");
      expect(catalogRes.status).toBe(200);
      const catalogBody = (await catalogRes.json()) as {
        presets: Array<{ id: string; installed: boolean }>;
      };
      const fira = catalogBody.presets.find((p) => p.id === "fira-code");
      expect(fira?.installed).toBe(true);
      const udev = catalogBody.presets.find((p) => p.id === "udev-gothic");
      expect(udev?.installed).toBe(false);

      const fileRes = await app.request("/file/fira-code");
      expect(fileRes.status).toBe(200);
      expect(fileRes.headers.get("content-type")).toBe("font/ttf");
      const bytes = await fileRes.arrayBuffer();
      expect(Buffer.from(bytes).toString()).toBe("FAKE");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("returns 404 for uninstalled font file", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "parasor-fonts-"));
    try {
      const installer = new FontInstaller({ cacheDir });
      const app = createFontRoutes(installer);
      const res = await app.request("/file/fira-code");
      expect(res.status).toBe(404);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

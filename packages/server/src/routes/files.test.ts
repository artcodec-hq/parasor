import { Buffer } from "node:buffer";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesystemService } from "../fs/service.js";
import type { ProjectManager } from "../state/project-manager.js";
import { createFileRoutes } from "./files.js";

function makeMocks() {
  const projects = new Map<
    string,
    { id: string; path: string; name: string }
  >();
  projects.set("proj-1", { id: "proj-1", path: "/tmp/proj", name: "proj" });

  const pm = {
    get: vi.fn((id: string) => projects.get(id)),
  } as unknown as ProjectManager;

  const service: FilesystemService = {
    listDir: vi.fn(async (_path: string) => [
      { name: "file.ts", type: "file", gitignored: false },
      { name: "src", type: "directory", gitignored: false },
    ]),
    readFile: vi.fn(async (_path: string) => "file contents"),
    writeFile: vi.fn(async (_path: string, _content: string) => undefined),
    mkdir: vi.fn(async (_path: string) => undefined),
    cp: vi.fn(async (_src: string, _dest: string) => undefined),
    statFile: vi.fn(async (_path: string) => null),
    openInlineFile: vi.fn(async (_path: string) => null),
    createStreamFromHandle: vi.fn(),
  } as unknown as FilesystemService;

  const getService = vi.fn((projectId: string) =>
    projects.has(projectId) ? service : null,
  );

  return { pm, service, getService, projects };
}

function createApp(
  mocks: ReturnType<typeof makeMocks>,
  options?: { isWritable?: (projectId: string) => boolean },
) {
  const app = new Hono();
  app.route(
    "/api/files",
    createFileRoutes(mocks.pm, mocks.getService, options ?? {}),
  );
  return app;
}

describe("file routes", () => {
  let mocks: ReturnType<typeof makeMocks>;
  let app: Hono;

  beforeEach(() => {
    mocks = makeMocks();
    app = createApp(mocks);
  });

  describe("GET /api/files/list", () => {
    it("lists directory entries", async () => {
      const res = await app.request("/api/files/list?projectId=proj-1&path=.");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
    });

    it("defaults path to '.'", async () => {
      await app.request("/api/files/list?projectId=proj-1");
      expect(mocks.service.listDir).toHaveBeenCalledWith(".");
    });

    it("returns 400 without projectId", async () => {
      const res = await app.request("/api/files/list?path=.");
      expect(res.status).toBe(400);
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.request(
        "/api/files/list?projectId=nonexistent&path=.",
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 on path traversal", async () => {
      const err = new Error("Path traversal");
      err.name = "PathTraversalError";
      vi.mocked(mocks.service.listDir).mockRejectedValueOnce(err);
      const res = await app.request(
        "/api/files/list?projectId=proj-1&path=../../etc",
      );
      expect(res.status).toBe(403);
    });

    it("returns 500 when service unavailable", async () => {
      mocks.getService.mockReturnValueOnce(null);
      const res = await app.request("/api/files/list?projectId=proj-1&path=.");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/files/read", () => {
    it("reads file content as text", async () => {
      const res = await app.request(
        "/api/files/read?projectId=proj-1&path=file.ts",
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("file contents");
    });

    it("returns 400 without projectId or path", async () => {
      const res1 = await app.request("/api/files/read?path=file.ts");
      expect(res1.status).toBe(400);

      const res2 = await app.request("/api/files/read?projectId=proj-1");
      expect(res2.status).toBe(400);
    });

    it("returns 404 when file not found", async () => {
      vi.mocked(mocks.service.readFile).mockResolvedValueOnce(null);
      const res = await app.request(
        "/api/files/read?projectId=proj-1&path=missing.ts",
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 on path traversal", async () => {
      const err = new Error("Path traversal");
      err.name = "PathTraversalError";
      vi.mocked(mocks.service.readFile).mockRejectedValueOnce(err);
      const res = await app.request(
        "/api/files/read?projectId=proj-1&path=../../etc/passwd",
      );
      expect(res.status).toBe(403);
    });

    it("returns 413 for oversized file", async () => {
      vi.mocked(mocks.service.readFile).mockRejectedValueOnce(
        new Error("File too large"),
      );
      const res = await app.request(
        "/api/files/read?projectId=proj-1&path=huge.bin",
      );
      expect(res.status).toBe(413);
    });
  });

  describe("POST /api/files/write", () => {
    async function postWrite(localApp: Hono, body: unknown): Promise<Response> {
      return await localApp.request("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("writes content and returns ok", async () => {
      const res = await postWrite(app, {
        projectId: "proj-1",
        path: "file.ts",
        content: "new",
      });
      expect(res.status).toBe(200);
      expect(mocks.service.writeFile).toHaveBeenCalledWith("file.ts", "new");
    });

    it("returns 400 on missing fields", async () => {
      const res = await postWrite(app, { projectId: "proj-1", path: "x" });
      expect(res.status).toBe(400);
    });

    it("returns 400 on invalid JSON", async () => {
      const res = await app.request("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown project", async () => {
      const res = await postWrite(app, {
        projectId: "missing",
        path: "a.ts",
        content: "x",
      });
      expect(res.status).toBe(404);
    });

    it("returns 403 on path traversal", async () => {
      const err = new Error("Path traversal");
      err.name = "PathTraversalError";
      vi.mocked(mocks.service.writeFile).mockRejectedValueOnce(err);
      const res = await postWrite(app, {
        projectId: "proj-1",
        path: "../../etc/evil",
        content: "x",
      });
      expect(res.status).toBe(403);
    });

    it("returns 413 when content too large", async () => {
      vi.mocked(mocks.service.writeFile).mockRejectedValueOnce(
        new Error("File too large"),
      );
      const res = await postWrite(app, {
        projectId: "proj-1",
        path: "big.bin",
        content: "x",
      });
      expect(res.status).toBe(413);
    });

    it("returns 409 when writes disabled", async () => {
      const disabledApp = createApp(mocks, { isWritable: () => false });
      const res = await postWrite(disabledApp, {
        projectId: "proj-1",
        path: "file.ts",
        content: "x",
      });
      expect(res.status).toBe(409);
      expect(mocks.service.writeFile).not.toHaveBeenCalled();
    });

    it("returns 400 when parent directory missing", async () => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      vi.mocked(mocks.service.writeFile).mockRejectedValueOnce(err);
      const res = await postWrite(app, {
        projectId: "proj-1",
        path: "new/subdir/file.ts",
        content: "x",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/files/copy", () => {
    async function postCopy(localApp: Hono, body: unknown): Promise<Response> {
      return await localApp.request("/api/files/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("copies entry and returns ok", async () => {
      const res = await postCopy(app, {
        projectId: "proj-1",
        srcPath: "file.ts",
        destPath: "file copy.ts",
      });
      expect(res.status).toBe(200);
      expect(mocks.service.cp).toHaveBeenCalledWith("file.ts", "file copy.ts");
    });

    it("returns 400 on missing fields", async () => {
      const res = await postCopy(app, {
        projectId: "proj-1",
        srcPath: "file.ts",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 on invalid JSON", async () => {
      const res = await app.request("/api/files/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown project", async () => {
      const res = await postCopy(app, {
        projectId: "missing",
        srcPath: "a.ts",
        destPath: "b.ts",
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when source is missing", async () => {
      const err = new Error("Copy source not found");
      err.name = "CopySourceNotFoundError";
      vi.mocked(mocks.service.cp).mockRejectedValueOnce(err);
      const res = await postCopy(app, {
        projectId: "proj-1",
        srcPath: "missing.ts",
        destPath: "missing copy.ts",
      });
      expect(res.status).toBe(404);
    });

    it("returns 409 when destination already exists", async () => {
      const err = new Error("Copy destination already exists");
      err.name = "CopyDestinationExistsError";
      vi.mocked(mocks.service.cp).mockRejectedValueOnce(err);
      const res = await postCopy(app, {
        projectId: "proj-1",
        srcPath: "file.ts",
        destPath: "file copy.ts",
      });
      expect(res.status).toBe(409);
    });

    it("returns 403 on path traversal", async () => {
      const err = new Error("Path traversal");
      err.name = "PathTraversalError";
      vi.mocked(mocks.service.cp).mockRejectedValueOnce(err);
      const res = await postCopy(app, {
        projectId: "proj-1",
        srcPath: "file.ts",
        destPath: "../../escape.ts",
      });
      expect(res.status).toBe(403);
    });

    it("returns 409 when writes disabled", async () => {
      const disabledApp = createApp(mocks, { isWritable: () => false });
      const res = await postCopy(disabledApp, {
        projectId: "proj-1",
        srcPath: "file.ts",
        destPath: "file copy.ts",
      });
      expect(res.status).toBe(409);
      expect(mocks.service.cp).not.toHaveBeenCalled();
    });
  });
});

describe("media routes (real filesystem)", () => {
  const PNG_MAGIC = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  let dir: string;
  let app: Hono;
  let service: FilesystemService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "parasor-media-routes-"));
    service = new FilesystemService(dir);
    const projects = new Map<
      string,
      { id: string; path: string; name: string }
    >();
    projects.set("proj-1", { id: "proj-1", path: dir, name: "proj" });
    const pm = {
      get: vi.fn((id: string) => projects.get(id)),
    } as unknown as ProjectManager;
    app = new Hono();
    app.route(
      "/api/files",
      createFileRoutes(pm, (id) => (id === "proj-1" ? service : null)),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("serves a PNG with fixed Content-Type and inline disposition", async () => {
    writeFileSync(join(dir, "small.png"), PNG_MAGIC);
    const res = await app.request(
      "/api/files/raw?projectId=proj-1&path=small.png",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe(String(PNG_MAGIC.length));
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(PNG_MAGIC)).toBe(true);
  });

  it("rejects non-media extensions with 415", async () => {
    writeFileSync(join(dir, "evil.exe"), Buffer.from([0x4d, 0x5a]));
    const res = await app.request(
      "/api/files/raw?projectId=proj-1&path=evil.exe",
    );
    expect(res.status).toBe(415);
  });

  it("rejects extension/content mismatch with 415", async () => {
    // .png extension but bytes are plain text -> magic-number check returns null
    writeFileSync(join(dir, "fake.png"), Buffer.from("hello world"));
    const res = await app.request(
      "/api/files/raw?projectId=proj-1&path=fake.png",
    );
    expect(res.status).toBe(415);
  });

  it("blocks path traversal with 403", async () => {
    const res = await app.request(
      "/api/files/raw?projectId=proj-1&path=../etc/passwd",
    );
    expect(res.status).toBe(403);
  });

  it("refuses to follow a symlinked leaf file (O_NOFOLLOW)", async () => {
    // Symlink whose target lives outside the project root. Without
    // O_NOFOLLOW on the leaf, an attacker who can write inside the project
    // could swap a regular media file for a symlink and read arbitrary
    // files the server process can read.
    const outside = mkdtempSync(join(tmpdir(), "parasor-media-outside-"));
    try {
      writeFileSync(join(outside, "secret.png"), PNG_MAGIC);
      const { symlinkSync } = await import("node:fs");
      symlinkSync(join(outside, "secret.png"), join(dir, "link.png"));
      const res = await app.request(
        "/api/files/raw?projectId=proj-1&path=link.png",
      );
      // 403 (PathTraversalError translated) or 404 are both acceptable
      // -- the security property is "not 200 with the symlink target's
      // bytes". Anything that returns the file body is the bug we are
      // closing.
      expect([403, 404]).toContain(res.status);
      if (res.status === 200) {
        const buf = Buffer.from(await res.arrayBuffer());
        expect(buf.equals(PNG_MAGIC)).toBe(false);
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("returns 416 for invalid range past EOF", async () => {
    writeFileSync(join(dir, "small.png"), PNG_MAGIC);
    const res = await app.request(
      "/api/files/raw?projectId=proj-1&path=small.png",
      { headers: { Range: "bytes=999-" } },
    );
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(
      `bytes */${PNG_MAGIC.length}`,
    );
  });

  it("ignores malformed Range header and returns 200", async () => {
    writeFileSync(join(dir, "small.png"), PNG_MAGIC);
    const res = await app.request(
      "/api/files/raw?projectId=proj-1&path=small.png",
      { headers: { Range: "bytes=0.5-1.5" } },
    );
    // Non-integer range falls back to full body -- never reaches createReadStream
    // with a fractional start (which would throw RangeError -> 500).
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(PNG_MAGIC.length));
  });

  it("returns 206 with Content-Range for a satisfiable range", async () => {
    writeFileSync(join(dir, "small.png"), PNG_MAGIC);
    const res = await app.request(
      "/api/files/raw?projectId=proj-1&path=small.png",
      { headers: { Range: "bytes=0-3" } },
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes 0-3/${PNG_MAGIC.length}`,
    );
    expect(res.headers.get("content-length")).toBe("4");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(4);
    expect(buf[0]).toBe(0x89);
  });

  it("/stat returns size for a media file", async () => {
    writeFileSync(join(dir, "small.png"), PNG_MAGIC);
    const res = await app.request(
      "/api/files/stat?projectId=proj-1&path=small.png",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { size: number; isFile: boolean };
    expect(body.size).toBe(PNG_MAGIC.length);
    expect(body.isFile).toBe(true);
  });

  it("/stat returns 404 for missing file", async () => {
    const res = await app.request(
      "/api/files/stat?projectId=proj-1&path=missing.png",
    );
    expect(res.status).toBe(404);
  });

  it("/stat blocks path traversal", async () => {
    const res = await app.request(
      "/api/files/stat?projectId=proj-1&path=../escape",
    );
    expect(res.status).toBe(403);
  });
});

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  type FileUploadResponse,
} from "@parasor/shared";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import { createFileUploadRoutes } from "./file-uploads.js";

interface ProjectFixture {
  id: string;
  name: string;
  path: string;
  readOnly?: boolean;
}

function makeProject(opts: { readOnly?: boolean } = {}): ProjectFixture {
  const path = mkdtempSync(join(tmpdir(), "parasor-uploads-route-"));
  return {
    id: "proj-1",
    name: "proj",
    path,
    ...(opts.readOnly !== undefined ? { readOnly: opts.readOnly } : {}),
  };
}

function makeStore(
  overrides: Partial<{
    dropSizeMaxBytes: number;
    dropSizeHardMaxBytes: number;
  }> = {},
): AppStateStore {
  const config = {
    preventIdleSleep: false,
    portDetection: "all-interfaces" as const,
    dropSizeMaxBytes: overrides.dropSizeMaxBytes ?? DEFAULT_DROP_SIZE_MAX_BYTES,
    dropSizeHardMaxBytes:
      overrides.dropSizeHardMaxBytes ?? DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  };
  return { get: () => ({ serviceConfig: config }) } as unknown as AppStateStore;
}

function makeApp(project: ProjectFixture, store: AppStateStore) {
  const pm = {
    get: vi.fn((id: string) => (id === project.id ? project : undefined)),
  } as unknown as ProjectManager;
  const app = new Hono();
  app.route(
    "/api/projects",
    createFileUploadRoutes({ projectManager: pm, appStateStore: store }),
  );
  return { app, pm };
}

function buildForm(
  files: { name: string; bytes: Uint8Array; mime?: string }[],
): FormData {
  const fd = new FormData();
  for (const f of files) {
    const ab = new ArrayBuffer(f.bytes.byteLength);
    new Uint8Array(ab).set(f.bytes);
    fd.append(
      "files",
      new File([ab], f.name, { type: f.mime ?? "application/octet-stream" }),
    );
  }
  return fd;
}

async function postFormTo(
  app: Hono,
  url: string,
  fd: FormData,
): Promise<Response> {
  const tmp = new Request("http://local.invalid/", {
    method: "POST",
    body: fd,
  });
  const buf = Buffer.from(await tmp.arrayBuffer());
  const contentType = tmp.headers.get("content-type") ?? "multipart/form-data";
  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buf.byteLength),
    },
    body: buf,
  });
}

describe("createFileUploadRoutes", () => {
  let project: ProjectFixture;
  let store: AppStateStore;
  let app: Hono;

  beforeEach(() => {
    project = makeProject();
    store = makeStore();
    ({ app } = makeApp(project, store));
  });

  it("writes a file at the project root with default disposition", async () => {
    const fd = buildForm([
      { name: "note.txt", bytes: new TextEncoder().encode("hi") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload`,
      fd,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileUploadResponse;
    expect(body.files).toHaveLength(1);
    expect(body.files[0].finalName).toBe("note.txt");
    expect(body.files[0].status).toBe("written");
    expect(readFileSync(join(project.path, "note.txt"), "utf-8")).toBe("hi");
  });

  it("writes into a nested subdirectory via ?path=", async () => {
    mkdirSync(join(project.path, "src", "components"), { recursive: true });
    const fd = buildForm([
      { name: "Hero.tsx", bytes: new TextEncoder().encode("export {}") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload?path=${encodeURIComponent("src/components")}`,
      fd,
    );
    expect(res.status).toBe(200);
    expect(
      readFileSync(join(project.path, "src/components/Hero.tsx"), "utf-8"),
    ).toBe("export {}");
  });

  it("returns 409 conflict when default disposition would overwrite", async () => {
    writeFileSync(join(project.path, "doc.txt"), "old");
    const fd = buildForm([
      { name: "doc.txt", bytes: new TextEncoder().encode("new") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload`,
      fd,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: "conflict", conflicts: ["doc.txt"] });
    expect(readFileSync(join(project.path, "doc.txt"), "utf-8")).toBe("old");
  });

  it("disposition=replace overwrites the existing file", async () => {
    writeFileSync(join(project.path, "doc.txt"), "old");
    const fd = buildForm([
      { name: "doc.txt", bytes: new TextEncoder().encode("new") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload?disposition=replace`,
      fd,
    );
    expect(res.status).toBe(200);
    expect(readFileSync(join(project.path, "doc.txt"), "utf-8")).toBe("new");
  });

  it("disposition=keep-both renames the colliding file", async () => {
    writeFileSync(join(project.path, "doc.txt"), "old");
    const fd = buildForm([
      { name: "doc.txt", bytes: new TextEncoder().encode("new") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload?disposition=keep-both`,
      fd,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileUploadResponse;
    expect(body.files[0].finalName).toBe("doc-2.txt");
    expect(body.files[0].status).toBe("renamed");
    expect(readFileSync(join(project.path, "doc.txt"), "utf-8")).toBe("old");
    expect(readFileSync(join(project.path, "doc-2.txt"), "utf-8")).toBe("new");
  });

  it("rejects readOnly project with 403 read-only", async () => {
    const ro = makeProject({ readOnly: true });
    const { app: roApp } = makeApp(ro, makeStore());
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      roApp,
      `/api/projects/${ro.id}/files/upload`,
      fd,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "read-only" });
  });

  it("rejects path traversal in ?path with 400 invalid-target", async () => {
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload?path=${encodeURIComponent("../escape")}`,
      fd,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid-target",
      reason: "path-traversal",
    });
  });

  it("rejects path pointing at a file with 400 not-a-dir", async () => {
    writeFileSync(join(project.path, "afile.txt"), "");
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload?path=${encodeURIComponent("afile.txt")}`,
      fd,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid-target",
      reason: "not-a-dir",
    });
  });

  it("rejects missing target dir with 400 missing", async () => {
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload?path=${encodeURIComponent("nope")}`,
      fd,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid-target",
      reason: "missing",
    });
  });

  it("rejects unknown project with 404", async () => {
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(app, "/api/projects/missing/files/upload", fd);
    expect(res.status).toBe(404);
  });

  it("rejects oversized payload via Content-Length pre-check", async () => {
    const small = makeStore({ dropSizeHardMaxBytes: 32 });
    const { app: smallApp } = makeApp(project, small);
    const fd = buildForm([{ name: "big.txt", bytes: new Uint8Array(100) }]);
    const res = await postFormTo(
      smallApp,
      `/api/projects/${project.id}/files/upload`,
      fd,
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too-large", limit: 32 });
  });

  it("rejects empty file with 400 invalid-filename empty", async () => {
    const fd = buildForm([{ name: "empty.txt", bytes: new Uint8Array(0) }]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload`,
      fd,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid-filename",
      reason: "empty",
    });
  });

  it("rejects per-file soft cap with 413 too-large", async () => {
    const tinySoft = makeStore({ dropSizeMaxBytes: 8 });
    const { app: tinyApp } = makeApp(project, tinySoft);
    const fd = buildForm([{ name: "10.txt", bytes: new Uint8Array(10) }]);
    const res = await postFormTo(
      tinyApp,
      `/api/projects/${project.id}/files/upload`,
      fd,
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too-large", limit: 8 });
  });

  it("rejects path-traversal in filename with 400 invalid-filename", async () => {
    const fd = buildForm([
      { name: "../boom.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/files/upload`,
      fd,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid-filename",
      reason: "path-traversal",
    });
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  type Session,
} from "@parasor/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadStaging } from "../fs/upload-staging.js";
import type { PtyHost } from "../pty/host.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import { createDropRoutes } from "./drops.js";

const TEST_SESSION_ID = "session-12345678-90ab-cdef-1234-567890abcdef";
type FakePtySession = Pick<Session, "id" | "projectId" | "state">;

function makeProject() {
  const path = mkdtempSync(join(tmpdir(), "parasor-drops-route-"));
  return { id: "proj-1", name: "proj", path };
}

function makeStore(
  overrides: Partial<{
    dropSizeMaxBytes: number;
    dropSizeHardMaxBytes: number;
    sessions: FakePtySession[];
  }>,
  projectId = "proj-1",
): AppStateStore {
  const config = {
    preventIdleSleep: false,
    portDetection: "all-interfaces" as const,
    dropSizeMaxBytes: overrides.dropSizeMaxBytes ?? DEFAULT_DROP_SIZE_MAX_BYTES,
    dropSizeHardMaxBytes:
      overrides.dropSizeHardMaxBytes ?? DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  };
  const sessions = overrides.sessions ?? [
    { id: TEST_SESSION_ID, projectId, state: "running" as const },
  ];
  return {
    get: () => ({ serviceConfig: config, sessions }),
  } as unknown as AppStateStore;
}

function makePtyManager(
  sessions: FakePtySession[] = [
    { id: TEST_SESSION_ID, projectId: "proj-1", state: "running" },
  ],
): Pick<PtyHost, "get"> {
  return {
    get: vi.fn(
      (id: string) => sessions.find((s) => s.id === id) as Session | undefined,
    ),
  } as unknown as Pick<PtyHost, "get">;
}

function makeApp(
  project: ReturnType<typeof makeProject>,
  store: AppStateStore,
  uploadStaging: UploadStaging,
  ptyManager: Pick<PtyHost, "get"> = makePtyManager([
    { id: TEST_SESSION_ID, projectId: project.id, state: "running" },
  ]),
) {
  const pm = {
    get: vi.fn((id: string) => (id === project.id ? project : undefined)),
  } as unknown as ProjectManager;
  const app = new Hono();
  app.route(
    "/api/projects",
    createDropRoutes({
      projectManager: pm,
      appStateStore: store,
      ptyManager,
      uploadStaging,
    }),
  );
  return { app, pm, ptyManager };
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

/**
 * Hono's `app.request(url, { body: formData })` forwards FormData as a
 * streaming body without `Content-Length`. Real browsers DO set
 * `Content-Length` for fetch-with-FormData, so to match production we
 * pre-serialize and attach the header manually.
 */
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

describe("createDropRoutes", () => {
  let project: ReturnType<typeof makeProject>;
  let store: AppStateStore;
  let app: Hono;
  let stagingRoot: string;
  let uploadStaging: UploadStaging;

  beforeEach(() => {
    stagingRoot = mkdtempSync(join(tmpdir(), "parasor-drops-staging-"));
    uploadStaging = new UploadStaging({ rootDir: stagingRoot });
    project = makeProject();
    store = makeStore({});
    ({ app } = makeApp(project, store, uploadStaging));
  });

  afterEach(() => {
    rmSync(stagingRoot, { recursive: true, force: true });
    rmSync(project.path, { recursive: true, force: true });
  });

  it("saves a single file under <uploadsDir>/<sessionId>/ (no timestamp suffix)", async () => {
    const fd = buildForm([
      { name: "note.txt", bytes: new TextEncoder().encode("hi") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paths: string[] };
    expect(body.paths).toHaveLength(1);
    expect(body.paths[0]).toMatch(/\d{8}-\d{6}_note\.txt$/);
    // Lives under the staging root (NOT under project.path) -- upload staging isolation.
    expect(body.paths[0].startsWith(uploadStaging.uploadsDir)).toBe(true);
    // the per-session subdir is exactly `<sessionId>`,
    // so the parent of the saved file is that exact path (no `<sid>-<ms>`
    // suffix that could be confused with a sibling sessionId).
    expect(body.paths[0]).toContain(`/${TEST_SESSION_ID}/`);
    expect(body.paths[0].includes(project.path)).toBe(false);
    expect(readFileSync(body.paths[0], "utf-8")).toBe("hi");
  });

  it("saves multi-file upload preserving input order", async () => {
    const fd = buildForm([
      { name: "a.txt", bytes: new TextEncoder().encode("A") },
      { name: "b.txt", bytes: new TextEncoder().encode("B") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paths: string[] };
    expect(body.paths).toHaveLength(2);
    expect(body.paths[0]).toMatch(/_a\.txt$/);
    expect(body.paths[1]).toMatch(/_b\.txt$/);
  });

  it("saves upload when app-state sessions are stale but the PTY host has the session", async () => {
    store = makeStore({ sessions: [] }, project.id);
    ({ app } = makeApp(
      project,
      store,
      uploadStaging,
      makePtyManager([
        { id: TEST_SESSION_ID, projectId: project.id, state: "running" },
      ]),
    ));
    const fd = buildForm([
      { name: "live.txt", bytes: new TextEncoder().encode("live") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paths: string[] };
    expect(body.paths).toHaveLength(1);
    expect(readFileSync(body.paths[0], "utf-8")).toBe("live");
  });

  it("returns 400 when sessionId query param is missing", async () => {
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(app, `/api/projects/${project.id}/drops`, fd);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/sessionId/);
  });

  it("returns 404 for an unknown project id", async () => {
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/does-not-exist/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(404);
  });

  it("rejects path-traversal filename with 400 + invalid-filename", async () => {
    const fd = buildForm([
      { name: "../escape.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("invalid-filename");
    expect(body.reason).toBe("path-traversal");
  });

  it("rejects empty file with 400 + empty reason", async () => {
    const fd = buildForm([{ name: "empty.txt", bytes: new Uint8Array(0) }]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("invalid-filename");
    expect(body.reason).toBe("empty");
  });

  it("rejects file over soft cap with 413", async () => {
    store = makeStore({ dropSizeMaxBytes: 4 }, project.id);
    ({ app } = makeApp(project, store, uploadStaging));
    const fd = buildForm([
      { name: "big.txt", bytes: new TextEncoder().encode("toolong") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; limit: number };
    expect(body.error).toBe("too-large");
    expect(body.limit).toBe(4);
  });

  it("rejects request whose Content-Length exceeds hard cap with 413", async () => {
    store = makeStore(
      { dropSizeMaxBytes: 8, dropSizeHardMaxBytes: 16 },
      project.id,
    );
    ({ app } = makeApp(project, store, uploadStaging));
    const res = await app.request(
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=xyz",
          "Content-Length": "1000",
        },
        body: "--xyz--",
      },
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; limit: number };
    expect(body.error).toBe("too-large");
    expect(body.limit).toBe(16);
  });

  it("rejects request without Content-Length with 411", async () => {
    const res = await app.request(
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=xyz" },
        body: "--xyz--",
      },
    );
    expect(res.status).toBe(411);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("too-large");
  });

  it("rejects Transfer-Encoding: chunked with 411", async () => {
    const res = await app.request(
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=xyz",
          "Content-Length": "8",
          "Transfer-Encoding": "chunked",
        },
        body: "--xyz--",
      },
    );
    expect(res.status).toBe(411);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("too-large");
  });

  it("rejects request with no files in form with 400", async () => {
    const fd = new FormData();
    fd.append("other-field", "value");
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(400);
  });

  it("rejects sessionId not registered with the project (404)", async () => {
    // session/project mismatch is a 404. The
    // load-bearing security guarantee (Claude --add-dir scope) is the
    // per-session env injection in InProcessPtyHost; this 404 keeps the
    // public API contract honest so a misbehaving client can't quietly
    // create phantom uploads dirs.
    ({ app } = makeApp(
      project,
      store,
      uploadStaging,
      makePtyManager([
        {
          id: TEST_SESSION_ID,
          projectId: "OTHER-project",
          state: "running",
        },
      ]),
    ));
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(404);
  });

  it("rejects ended sessions in the PTY host with 404", async () => {
    ({ app } = makeApp(
      project,
      store,
      uploadStaging,
      makePtyManager([
        { id: TEST_SESSION_ID, projectId: project.id, state: "ended" },
      ]),
    ));
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("session not found for project");
  });

  it("rejects sessionId missing from the PTY host with 404", async () => {
    ({ app } = makeApp(project, store, uploadStaging, makePtyManager([])));
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=${TEST_SESSION_ID}`,
      fd,
    );
    expect(res.status).toBe(404);
  });

  it("rejects sessionId with path-separator characters with 404 or 400", async () => {
    // The early "session not found for project" guard now catches the
    // bogus id before the sanitizer ever runs (the live sessions list
    // never contains a `evil/..` id), so 404 is the expected outcome.
    // The sanitizer-specific 400 path is exercised by the
    // upload-staging.test InvalidSessionIdError tests.
    const fd = buildForm([
      { name: "x.txt", bytes: new TextEncoder().encode("x") },
    ]);
    const res = await postFormTo(
      app,
      `/api/projects/${project.id}/drops?sessionId=evil%2F..%2Fescape`,
      fd,
    );
    expect([400, 404]).toContain(res.status);
  });
});

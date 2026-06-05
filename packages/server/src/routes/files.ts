import { Readable } from "node:stream";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import {
  FileAccessError,
  FileExistsError,
  FileNotFoundError,
  FileReadError,
  FilesystemUnavailableError,
  FileTooLargeError,
  FileWriteDisabledError,
  FileWriteError,
} from "../application/files/errors.js";
import { createProjectFileQueries } from "../application/files/project-file-queries.js";
import { WorkspaceNotFoundError } from "../application/workspace/errors.js";
import { detectMediaFromHandle, isMediaExtension } from "../fs/media.js";
import type { FilesystemService } from "../fs/service.js";
import type { ProjectManager } from "../state/project-manager.js";

/**
 * Hard ceiling for inline-served media. Above this the route refuses with 413
 * and the client is expected to surface an "Open anyway" gate. 50 MB matches
 * the plan; pick a value that comfortably streams a typical phone photo /
 * short video without hogging the server when many clients connect at once.
 */
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

interface ParsedRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `Range: bytes=` header against the total size. Returns
 * `null` on malformed input (caller falls back to full body) and a tagged
 * "unsatisfiable" marker when the range is syntactically valid but out of
 * bounds (caller emits 416). Multi-range and non-bytes units are not
 * supported -- they fall through to the full-body branch which mirrors
 * Apple's typical Safari behavior of issuing simple bytes=0- ranges.
 */
function parseRange(
  header: string | undefined,
  size: number,
): ParsedRange | "unsatisfiable" | null {
  if (!header) return null;
  if (!header.startsWith("bytes=")) return null;
  const spec = header.slice("bytes=".length);
  if (spec.includes(",")) return null;
  const [rawStart, rawEnd] = spec.split("-", 2);
  if (rawStart === undefined || rawEnd === undefined) return null;
  // RFC 9110 first-byte-pos / last-byte-pos / suffix-length must be DIGIT-only.
  // Anything else (decimal, hex, exponent, whitespace, sign) is rejected so a
  // malformed Range header never reaches createReadStream where it would throw
  // RangeError and surface as a 500. `bytes=` followed by an empty spec is
  // also rejected here.
  const intPattern = /^[0-9]+$/;
  let start: number;
  let end: number;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    if (!intPattern.test(rawEnd)) return null;
    const n = Number(rawEnd);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    if (size === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    if (!intPattern.test(rawStart)) return null;
    const s = Number(rawStart);
    if (!Number.isSafeInteger(s) || s < 0) return null;
    start = s;
    if (rawEnd === "") {
      end = size === 0 ? 0 : size - 1;
    } else {
      if (!intPattern.test(rawEnd)) return null;
      const e = Number(rawEnd);
      if (!Number.isSafeInteger(e) || e < start) return null;
      end = Math.min(e, size === 0 ? 0 : size - 1);
    }
  }
  if (size === 0 || start >= size) return "unsatisfiable";
  return { start, end };
}

/**
 * Sanitize a filename for `Content-Disposition`. Strips control chars,
 * collapses CR/LF/quotes that would let an attacker inject extra header
 * fields, then RFC 5987-encodes for the `filename*` parameter when needed.
 */
function buildContentDisposition(filename: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Content-Disposition fallback must reject C0 bytes.
  const ascii = filename.replace(/[\x00-\x1f"\\]/g, "_");
  // RFC 5987: percent-encode UTF-8, leaving a small reserved unreserved set.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function basenameFromRel(relPath: string): string {
  const trimmed = relPath.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

interface FileRoutesOptions {
  isWritable?: (projectId: string) => boolean;
}

export function createFileRoutes(
  projectManager: ProjectManager,
  getService: (
    projectId: string,
    worktreePath?: string,
  ) => FilesystemService | null,
  options: FileRoutesOptions = {},
): Hono {
  const routes = new Hono();
  const projectFileQueries = createProjectFileQueries({
    getFilesystemService: getService,
    projectManager,
    ...(options.isWritable ? { isWritable: options.isWritable } : {}),
  });

  routes.get("/list", async (c) => {
    const projectId = c.req.query("projectId");
    const path = c.req.query("path") ?? ".";
    const worktreePath = c.req.query("worktreePath");

    if (!projectId) return c.json({ error: "projectId required" }, 400);

    try {
      const entries = await projectFileQueries.listProjectDirectory(
        projectId,
        path,
        worktreePath,
      );
      return c.json({ entries });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Project not found" }, 404);
      }
      if (error instanceof FilesystemUnavailableError) {
        return c.json({ error: error.message }, 500);
      }
      if (error instanceof FileAccessError) {
        return c.json({ error: "Access denied" }, 403);
      }
      if (error instanceof FileReadError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  routes.get("/read", async (c) => {
    const projectId = c.req.query("projectId");
    const path = c.req.query("path");
    const worktreePath = c.req.query("worktreePath");

    if (!projectId || !path)
      return c.json({ error: "projectId and path required" }, 400);

    try {
      const content = await projectFileQueries.readProjectFile(
        projectId,
        path,
        worktreePath,
      );
      return c.text(content);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Project not found" }, 404);
      }
      if (error instanceof FilesystemUnavailableError) {
        return c.json({ error: error.message }, 500);
      }
      if (error instanceof FileNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof FileAccessError) {
        return c.json({ error: "Access denied" }, 403);
      }
      if (error instanceof FileTooLargeError) {
        return c.json({ error: error.message }, 413);
      }
      if (error instanceof FileReadError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  routes.post("/write", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).projectId !== "string" ||
      typeof (body as Record<string, unknown>).path !== "string" ||
      typeof (body as Record<string, unknown>).content !== "string"
    ) {
      return c.json(
        { error: "projectId, path, and content (string) required" },
        400,
      );
    }
    const rawWorktreePath = (body as Record<string, unknown>).worktreePath;
    const worktreePath =
      typeof rawWorktreePath === "string" ? rawWorktreePath : undefined;
    const { projectId, path, content } = body as {
      projectId: string;
      path: string;
      content: string;
    };

    try {
      await projectFileQueries.writeProjectFile(
        projectId,
        path,
        content,
        worktreePath,
      );
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Project not found" }, 404);
      }
      if (error instanceof FileWriteDisabledError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof FilesystemUnavailableError) {
        return c.json({ error: error.message }, 500);
      }
      if (error instanceof FileAccessError) {
        return c.json({ error: "Access denied" }, 403);
      }
      if (error instanceof FileTooLargeError) {
        return c.json({ error: error.message }, 413);
      }
      if (error instanceof FileWriteError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  routes.post("/mkdir", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).projectId !== "string" ||
      typeof (body as Record<string, unknown>).path !== "string"
    ) {
      return c.json({ error: "projectId and path required" }, 400);
    }
    const rawWorktreePath = (body as Record<string, unknown>).worktreePath;
    const worktreePath =
      typeof rawWorktreePath === "string" ? rawWorktreePath : undefined;
    const { projectId, path } = body as { projectId: string; path: string };

    try {
      await projectFileQueries.createProjectDirectory(
        projectId,
        path,
        worktreePath,
      );
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Project not found" }, 404);
      }
      if (error instanceof FileWriteDisabledError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof FilesystemUnavailableError) {
        return c.json({ error: error.message }, 500);
      }
      if (error instanceof FileAccessError) {
        return c.json({ error: "Access denied" }, 403);
      }
      if (error instanceof FileWriteError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  routes.post("/copy", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).projectId !== "string" ||
      typeof (body as Record<string, unknown>).srcPath !== "string" ||
      typeof (body as Record<string, unknown>).destPath !== "string"
    ) {
      return c.json(
        { error: "projectId, srcPath, and destPath required" },
        400,
      );
    }
    const rawWorktreePath = (body as Record<string, unknown>).worktreePath;
    const worktreePath =
      typeof rawWorktreePath === "string" ? rawWorktreePath : undefined;
    const { projectId, srcPath, destPath } = body as {
      projectId: string;
      srcPath: string;
      destPath: string;
    };

    try {
      await projectFileQueries.copyProjectEntry(
        projectId,
        srcPath,
        destPath,
        worktreePath,
      );
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Project not found" }, 404);
      }
      if (error instanceof FileWriteDisabledError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof FilesystemUnavailableError) {
        return c.json({ error: error.message }, 500);
      }
      if (error instanceof FileAccessError) {
        return c.json({ error: "Access denied" }, 403);
      }
      if (error instanceof FileNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof FileExistsError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof FileWriteError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  function getServiceOrError(projectId: string, worktreePath?: string) {
    const project = projectManager.get(projectId);
    if (!project) return { error: "project-not-found" as const };
    const service = getService(projectId, worktreePath);
    if (!service) return { error: "service-unavailable" as const };
    return { service };
  }

  routes.get("/stat", async (c) => {
    const projectId = c.req.query("projectId");
    const path = c.req.query("path");
    const worktreePath = c.req.query("worktreePath");
    if (!projectId || !path)
      return c.json({ error: "projectId and path required" }, 400);

    const got = getServiceOrError(projectId, worktreePath);
    if ("error" in got) {
      return c.json(
        {
          error:
            got.error === "project-not-found"
              ? "Project not found"
              : "Filesystem not available",
        },
        got.error === "project-not-found" ? 404 : 500,
      );
    }
    try {
      const stats = await got.service.statFile(path);
      if (!stats) return c.json({ error: "File not found" }, 404);
      return c.json({
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        isFile: stats.isFile(),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "PathTraversalError") {
        return c.json({ error: "Access denied" }, 403);
      }
      throw error;
    }
  });

  routes.get("/raw", async (c) => {
    const projectId = c.req.query("projectId");
    const path = c.req.query("path");
    const worktreePath = c.req.query("worktreePath");
    if (!projectId || !path)
      return c.json({ error: "projectId and path required" }, 400);

    const got = getServiceOrError(projectId, worktreePath);
    if ("error" in got) {
      return c.json(
        {
          error:
            got.error === "project-not-found"
              ? "Project not found"
              : "Filesystem not available",
        },
        got.error === "project-not-found" ? 404 : 500,
      );
    }
    const service = got.service;

    // Run the path-traversal check before the extension gate so a malicious
    // `../etc/passwd` returns 403 rather than the softer 415 the extension
    // whitelist would emit. `statFile` is the cheap probe -- it routes
    // through the same `resolve()` containment logic and never opens an FD.
    try {
      await service.statFile(path);
    } catch (error) {
      if (error instanceof Error && error.name === "PathTraversalError") {
        return c.json({ error: "Access denied" }, 403);
      }
      throw error;
    }

    // Cheap pre-filter so an executable / 1 GB log isn't even opened just
    // to learn it's not media. Magic-number sniff below is the authoritative
    // gate (extension is the suggestion; bytes are the truth).
    if (!isMediaExtension(path)) {
      return c.json({ error: "Not a supported media file" }, 415);
    }

    // Single-FD pipeline: open with O_NOFOLLOW once, then fstat -> magic-number
    // sniff -> stream creation all reference the same inode. This closes the
    // TOCTOU between size validation and stream open (where an attacker with
    // FS write access could swap a 1 KB image for a 500 MB video) and the
    // symlink-leaf-swap escape that bypasses `resolve()`'s containment check.
    let opened: Awaited<ReturnType<typeof service.openInlineFile>>;
    try {
      opened = await service.openInlineFile(path);
    } catch (error) {
      if (error instanceof Error && error.name === "PathTraversalError") {
        return c.json({ error: "Access denied" }, 403);
      }
      throw error;
    }
    if (!opened) {
      return c.json({ error: "File not found" }, 404);
    }
    const { handle, stats } = opened;

    // Tracks whether ownership of the handle was transferred to the read
    // stream (autoClose: true). Every early-return path leaves it false so
    // the finally block closes the FD; only the streaming success path
    // flips it to true.
    let handleTransferred = false;
    try {
      if (stats.size > MAX_MEDIA_BYTES) {
        return c.json({ error: "Media exceeds size limit" }, 413);
      }

      const detection = await detectMediaFromHandle(handle, path);
      if (!detection.kind || !detection.contentType) {
        return c.json({ error: "Not a supported media file" }, 415);
      }

      const rangeHeader = c.req.header("range");
      const range = parseRange(rangeHeader, stats.size);
      if (range === "unsatisfiable") {
        c.header("Content-Range", `bytes */${stats.size}`);
        c.header("Accept-Ranges", "bytes");
        return c.body(null, 416);
      }

      const filename = basenameFromRel(path);
      c.header("Content-Type", detection.contentType);
      c.header("Content-Disposition", buildContentDisposition(filename));
      c.header("Cache-Control", "private, max-age=0, must-revalidate");
      c.header("Accept-Ranges", "bytes");
      // SVG and PDF can both execute script when navigated to directly
      // (script-in-svg, JavaScript actions in PDF). `<img>`/`<iframe>`
      // callers still render fine -- `default-src 'none'` lets the renderer
      // parse the bytes but blocks any script the file tries to run.
      if (
        detection.contentType === "image/svg+xml" ||
        detection.contentType === "application/pdf"
      ) {
        c.header(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
        );
      }

      const streamHandle = service.createStreamFromHandle(
        handle,
        stats.size,
        range ? { start: range.start, end: range.end } : undefined,
      );
      handleTransferred = true;

      if (range) {
        const length = streamHandle.end - streamHandle.start + 1;
        c.header("Content-Length", String(length));
        c.header(
          "Content-Range",
          `bytes ${streamHandle.start}-${streamHandle.end}/${stats.size}`,
        );
        c.status(206);
      } else {
        c.header("Content-Length", String(stats.size));
      }

      return stream(c, async (s) => {
        const webStream = Readable.toWeb(
          streamHandle.stream,
        ) as ReadableStream<Uint8Array>;
        await s.pipe(webStream);
      });
    } finally {
      if (!handleTransferred) {
        await handle.close().catch(() => {});
      }
    }
  });

  return routes;
}

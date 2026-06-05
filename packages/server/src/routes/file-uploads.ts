import {
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  type FileUploadDisposition,
  type FileUploadErrorResponse,
  type FileUploadResponse,
} from "@parasor/shared";
import { Hono } from "hono";
import {
  InvalidUploadFilenameError,
  InvalidUploadTargetError,
  resolveTargetDir,
  saveUploads,
  UploadConflictError,
  type UploadInput,
} from "../fs/file-uploads.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";

export interface FileUploadRoutesDeps {
  projectManager: ProjectManager;
  appStateStore: AppStateStore;
}

const FIELD_NAME = "files";

const VALID_DISPOSITIONS = new Set<FileUploadDisposition>([
  "replace",
  "keep-both",
  "skip",
]);

function parseDisposition(raw: string | undefined): FileUploadDisposition {
  if (raw && VALID_DISPOSITIONS.has(raw as FileUploadDisposition)) {
    return raw as FileUploadDisposition;
  }
  // Default policy: silent collisions are unacceptable; the client always
  // surfaces a "Replace / Keep both / Skip" modal before retrying. The first
  // request with no `disposition` is therefore an exploratory probe whose
  // job is to discover whether any conflict exists -- "skip" gives that
  // answer without mutating disk.
  return "skip";
}

export function createFileUploadRoutes(deps: FileUploadRoutesDeps): Hono {
  const { projectManager, appStateStore } = deps;
  const routes = new Hono();

  routes.post("/:id/files/upload", async (c) => {
    const hardMax =
      appStateStore.get().serviceConfig.dropSizeHardMaxBytes ??
      DEFAULT_DROP_SIZE_HARD_MAX_BYTES;

    const transferEncoding = c.req
      .header("transfer-encoding")
      ?.toLowerCase()
      .split(",")
      .map((s) => s.trim());
    if (transferEncoding?.includes("chunked")) {
      return c.json<FileUploadErrorResponse>(
        { error: "too-large", limit: hardMax },
        411,
      );
    }
    const contentLengthHeader = c.req.header("content-length");
    if (contentLengthHeader === undefined) {
      return c.json<FileUploadErrorResponse>(
        { error: "too-large", limit: hardMax },
        411,
      );
    }
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      return c.json<FileUploadErrorResponse>(
        { error: "too-large", limit: hardMax },
        411,
      );
    }
    if (contentLength > hardMax) {
      return c.json<FileUploadErrorResponse>(
        { error: "too-large", limit: hardMax },
        413,
      );
    }

    const projectId = c.req.param("id");
    const project = projectManager.get(projectId);
    if (!project) {
      return c.json({ error: "project not found" }, 404);
    }
    if (project.readOnly) {
      return c.json<FileUploadErrorResponse>({ error: "read-only" }, 403);
    }

    const targetParam = c.req.query("path") ?? "";
    const disposition = parseDisposition(c.req.query("disposition"));

    let targetDir: string;
    try {
      targetDir = await resolveTargetDir(project.path, targetParam);
    } catch (err) {
      if (err instanceof InvalidUploadTargetError) {
        return c.json<FileUploadErrorResponse>(
          { error: "invalid-target", reason: err.reason },
          400,
        );
      }
      console.error("[file-uploads] resolveTargetDir failed:", err);
      return c.json<FileUploadErrorResponse>({ error: "io-error" }, 500);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = await c.req.parseBody({ all: true });
    } catch {
      return c.json({ error: "invalid multipart body" }, 400);
    }

    const rawField = parsed[FIELD_NAME];
    const collected: File[] = [];
    if (Array.isArray(rawField)) {
      for (const v of rawField) if (v instanceof File) collected.push(v);
    } else if (rawField instanceof File) {
      collected.push(rawField);
    }
    if (collected.length === 0) {
      return c.json({ error: "no files in request" }, 400);
    }

    const softMax =
      appStateStore.get().serviceConfig.dropSizeMaxBytes ??
      DEFAULT_DROP_SIZE_MAX_BYTES;

    const inputs: UploadInput[] = [];
    for (const file of collected) {
      if (file.size === 0) {
        return c.json<FileUploadErrorResponse>(
          { error: "invalid-filename", reason: "empty" },
          400,
        );
      }
      if (file.size > softMax) {
        return c.json<FileUploadErrorResponse>(
          { error: "too-large", limit: softMax },
          413,
        );
      }
      inputs.push({
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }

    try {
      const results = await saveUploads(targetDir, inputs, disposition);
      return c.json<FileUploadResponse>({ files: results });
    } catch (err) {
      if (err instanceof UploadConflictError) {
        return c.json<FileUploadErrorResponse>(
          { error: "conflict", conflicts: err.conflicts },
          409,
        );
      }
      if (err instanceof InvalidUploadFilenameError) {
        return c.json<FileUploadErrorResponse>(
          { error: "invalid-filename", reason: err.reason },
          400,
        );
      }
      console.error("[file-uploads] saveUploads failed:", err);
      return c.json<FileUploadErrorResponse>({ error: "io-error" }, 500);
    }
  });

  return routes;
}

import {
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  type DropErrorResponse,
  type DropResponse,
} from "@parasor/shared";
import { Hono } from "hono";
import {
  type DropInput,
  InvalidFilenameError,
  saveDrops,
} from "../fs/drops.js";
import {
  InvalidSessionIdError,
  type UploadStaging,
} from "../fs/upload-staging.js";
import type { PtyHost } from "../pty/host.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";

export interface DropRoutesDeps {
  projectManager: ProjectManager;
  appStateStore: AppStateStore;
  ptyManager: Pick<PtyHost, "get">;
  uploadStaging: UploadStaging;
}

const FIELD_NAME = "files";

export function createDropRoutes(deps: DropRoutesDeps): Hono {
  const { projectManager, appStateStore, ptyManager, uploadStaging } = deps;
  const routes = new Hono();

  routes.post("/:id/drops", async (c) => {
    /**
     * `Content-Length` guard runs before we consume the body so an oversized
     * upload can be rejected without buffering it. Hono's built-in
     * `bodyLimit` would require a static number at middleware construction
     * time, but the hard cap is admin-editable at runtime -- we read it
     * per-request instead.
     */
    const hardMax =
      appStateStore.get().serviceConfig.dropSizeHardMaxBytes ??
      DEFAULT_DROP_SIZE_HARD_MAX_BYTES;
    const transferEncoding = c.req
      .header("transfer-encoding")
      ?.toLowerCase()
      .split(",")
      .map((s) => s.trim());
    if (transferEncoding?.includes("chunked")) {
      return c.json<DropErrorResponse>(
        { error: "too-large", limit: hardMax },
        411,
      );
    }
    const contentLengthHeader = c.req.header("content-length");
    if (contentLengthHeader === undefined) {
      return c.json<DropErrorResponse>(
        { error: "too-large", limit: hardMax },
        411,
      );
    }
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      return c.json<DropErrorResponse>(
        { error: "too-large", limit: hardMax },
        411,
      );
    }
    if (contentLength > hardMax) {
      return c.json<DropErrorResponse>(
        { error: "too-large", limit: hardMax },
        413,
      );
    }

    const projectId = c.req.param("id");
    const project = projectManager.get(projectId);
    if (!project) {
      return c.json({ error: "project not found" }, 404);
    }

    /**
     * sessionId is required (upload staging isolation Q2): it scopes the staging dir so
     * L1 (`releaseSession` on PTY exit) and L2/L3 (TTL sweep) can find and
     * remove the right tree. No fallback path -- clients without a sessionId
     * have no PTY to attach the drop to and were never a real flow.
     *
     * also verify the sessionId belongs to
     * the URL projectId. Without per-session env injection (now done by
     * `InProcessPtyHost.buildSessionEnv`) the cross-project case would
     * have leaked drops; the env fix is the load-bearing guard, but
     * rejecting mismatched ids here keeps the API contract honest.
     */
    const sessionId = c.req.query("sessionId");
    if (!sessionId) {
      return c.json({ error: "sessionId is required" }, 400);
    }
    const session = ptyManager.get(sessionId);
    if (
      !session ||
      session.projectId !== projectId ||
      session.state === "ended"
    ) {
      return c.json({ error: "session not found for project" }, 404);
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
      for (const v of rawField) {
        if (v instanceof File) collected.push(v);
      }
    } else if (rawField instanceof File) {
      collected.push(rawField);
    }

    if (collected.length === 0) {
      return c.json({ error: "no files in request" }, 400);
    }

    const softMax =
      appStateStore.get().serviceConfig.dropSizeMaxBytes ??
      DEFAULT_DROP_SIZE_MAX_BYTES;

    const inputs: DropInput[] = [];
    for (const file of collected) {
      if (file.size === 0) {
        return c.json<DropErrorResponse>(
          { error: "invalid-filename", reason: "empty" },
          400,
        );
      }
      if (file.size > softMax) {
        return c.json<DropErrorResponse>(
          { error: "too-large", limit: softMax },
          413,
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      inputs.push({ filename: file.name, bytes });
    }

    let saved: string[];
    try {
      const targetDir = await uploadStaging.acquire(sessionId);
      saved = await saveDrops(targetDir, inputs);
    } catch (err) {
      if (err instanceof InvalidFilenameError) {
        return c.json<DropErrorResponse>(
          { error: "invalid-filename", reason: err.reason },
          400,
        );
      }
      if (err instanceof InvalidSessionIdError) {
        // Caller-supplied id failed sanitizer. Return 400 without
        // echoing the raw value -- the error class deliberately keeps
        // the value out of the message so an attacker cannot inject
        // log noise (reviewed for correctness). `err.value` is available
        // server-side via the structured log if forensics need it.
        console.error(
          "[drops] invalid sessionId rejected; reason:",
          err.reason,
        );
        return c.json({ error: "invalid sessionId" }, 400);
      }
      // Log full error server-side; `err.message` can contain absolute
      // paths and filesystem details we do not want to leak to clients.
      console.error("[drops] saveDrops failed:", err);
      return c.json<DropErrorResponse>({ error: "io-error" }, 500);
    }

    return c.json<DropResponse>({ paths: saved });
  });

  return routes;
}

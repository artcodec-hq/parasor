import type { SessionCommand, SessionLaunchPreset } from "@parasor/shared";
import { Hono } from "hono";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
} from "../application/workspace/errors.js";
import { createSessionCommands } from "../application/workspace/session-commands.js";
import { createSessionQueries } from "../application/workspace/session-queries.js";
import type { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";
import { buildHeadlessReplaySnapshot } from "../pty/headless-replay-snapshot.js";
import type { PtyHost } from "../pty/host.js";
import type { AppStateStore } from "../state/app-state.js";
import type { EventBus } from "../ws/events.js";

const DEFAULT_SCROLLBACK_SNAPSHOT_COLS = 80;
const DEFAULT_SCROLLBACK_SNAPSHOT_ROWS = 24;
const DEFAULT_SCROLLBACK_SNAPSHOT_MAX_BYTES = 256 * 1024;
const MAX_SCROLLBACK_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const DEFAULT_SCROLLBACK_SNAPSHOT_LINES = 10_000;
const MAX_SCROLLBACK_SNAPSHOT_LINES = 160_000;

function readPositiveIntegerQuery(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function scrollbackLinesForMaxBytes(maxBytes: number): number {
  const multiplier = Math.max(
    1,
    Math.ceil(maxBytes / DEFAULT_SCROLLBACK_SNAPSHOT_MAX_BYTES),
  );
  return Math.min(
    DEFAULT_SCROLLBACK_SNAPSHOT_LINES * multiplier,
    MAX_SCROLLBACK_SNAPSHOT_LINES,
  );
}

export function createSessionRoutes(
  ptyManager: PtyHost,
  eventBus: EventBus,
  store: AppStateStore,
  terminalTraceRecorder?: TerminalTraceRecorder,
): Hono {
  const routes = new Hono();
  const sessionCommands = createSessionCommands({
    appStateStore: store,
    eventBus,
    ptyManager,
  });
  const sessionQueries = createSessionQueries({ ptyManager });

  routes.get("/", (c) => {
    const projectId = c.req.query("projectId");
    return c.json({ sessions: sessionQueries.listSessions(projectId) });
  });

  routes.post("/", async (c) => {
    const body = await c.req
      .json<{
        projectId?: string;
        command?: SessionCommand;
        cwd?: string;
        title?: string;
        launchPreset?: SessionLaunchPreset;
        bootstrapInput?: unknown;
      }>()
      .catch(
        () =>
          ({}) as {
            projectId?: string;
            command?: SessionCommand;
            cwd?: string;
            title?: string;
            launchPreset?: SessionLaunchPreset;
            bootstrapInput?: unknown;
          },
      );

    if (!body.projectId) {
      return c.json({ error: "projectId is required" }, 400);
    }

    const createStart = performance.now();
    terminalTraceRecorder?.record("session-create-request", {
      projectId: body.projectId,
      commandType: body.command?.type ?? "shell",
      hasCwd: typeof body.cwd === "string",
      hasTitle: typeof body.title === "string",
      hasLaunchPreset: body.launchPreset !== undefined,
      hasBootstrapInput: typeof body.bootstrapInput === "string",
    });

    try {
      const session = await sessionCommands.createSession({
        projectId: body.projectId,
        ...(body.command !== undefined && { command: body.command }),
        ...(body.cwd !== undefined && { cwd: body.cwd }),
        ...(body.title !== undefined && { title: body.title }),
        ...(body.launchPreset !== undefined && {
          launchPreset: body.launchPreset,
        }),
        ...(typeof body.bootstrapInput === "string" && {
          bootstrapInput: body.bootstrapInput,
        }),
      });
      terminalTraceRecorder?.record(
        "session-create-complete",
        {
          projectId: session.projectId,
          commandType: session.command.type,
          state: session.state,
          pid: session.pid ?? null,
          generation: session.generation,
          durationMs: Math.round((performance.now() - createStart) * 10) / 10,
        },
        { sessionId: session.id },
      );
      return c.json(session, 201);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        terminalTraceRecorder?.record("session-create-failed", {
          projectId: body.projectId,
          reason: "project-not-found",
          durationMs: Math.round((performance.now() - createStart) * 10) / 10,
        });
        return c.json({ error: "Project not found" }, 404);
      }
      terminalTraceRecorder?.record("session-create-failed", {
        projectId: body.projectId,
        reason: error instanceof Error ? error.name : "unknown",
        durationMs: Math.round((performance.now() - createStart) * 10) / 10,
      });
      throw error;
    }
  });

  routes.get("/:id/cwd", async (c) => {
    const id = c.req.param("id");
    try {
      return c.json(await sessionQueries.getSessionCwd(id));
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      if (error instanceof WorkspaceConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  routes.get("/:id/scrollback-snapshot", async (c) => {
    const id = c.req.param("id");
    if (!ptyManager.get(id)) {
      return c.json({ error: "Not found" }, 404);
    }
    const scrollback = ptyManager.getScrollback(id);
    if (!scrollback) {
      return c.json({
        text: "",
        rawBytes: 0,
        replayBytes: 0,
        maxBytes: 0,
        hasMore: false,
      });
    }

    const cols = readPositiveIntegerQuery(
      c.req.query("cols"),
      DEFAULT_SCROLLBACK_SNAPSHOT_COLS,
    );
    const rows = readPositiveIntegerQuery(
      c.req.query("rows"),
      DEFAULT_SCROLLBACK_SNAPSHOT_ROWS,
    );
    const maxBytes = Math.min(
      readPositiveIntegerQuery(
        c.req.query("maxBytes"),
        DEFAULT_SCROLLBACK_SNAPSHOT_MAX_BYTES,
      ),
      MAX_SCROLLBACK_SNAPSHOT_BYTES,
    );
    const scrollbackLines = scrollbackLinesForMaxBytes(maxBytes);
    const snapshot = await buildHeadlessReplaySnapshot(scrollback, {
      cols,
      rows,
      scrollbackLines,
      maxBytes,
    });
    const hitLineCap = snapshot.bufferLines >= scrollbackLines + rows;

    return c.json({
      text: snapshot.text,
      rawBytes: snapshot.rawBytes,
      replayBytes: snapshot.snapshotBytes,
      maxBytes,
      hasMore: snapshot.snapshotBytes >= maxBytes || hitLineCap,
      bufferLines: snapshot.bufferLines,
      emittedLines: snapshot.emittedLines,
      scrollbackLines,
    });
  });

  routes.post("/:id/pin", async (c) => {
    const id = c.req.param("id");
    const body = await c.req
      .json<{ pinned?: boolean }>()
      .catch(() => ({}) as { pinned?: boolean });
    if (typeof body.pinned !== "boolean") {
      return c.json({ error: "pinned must be a boolean" }, 400);
    }
    try {
      const session = await sessionCommands.setSessionPinned(id, body.pinned);
      return c.json(session);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      throw error;
    }
  });

  routes.post("/:id/title", async (c) => {
    const id = c.req.param("id");
    const body = await c.req
      .json<{ title?: unknown }>()
      .catch(() => ({}) as { title?: unknown });
    if (typeof body.title !== "string") {
      return c.json({ error: "title must be a string" }, 400);
    }
    try {
      const session = await sessionCommands.setSessionTitle(id, body.title);
      return c.json(session);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      throw error;
    }
  });

  routes.post("/:id/restart", async (c) => {
    const id = c.req.param("id");
    try {
      const restarted = await sessionCommands.restartSession(id);
      return c.json(restarted);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      if (error instanceof WorkspaceConflictError) {
        return c.json({ error: error.message }, 409);
      }
      return c.json(
        { error: error instanceof Error ? error.message : "Restart failed" },
        500,
      );
    }
  });

  routes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const deleteStart = performance.now();
    terminalTraceRecorder?.record(
      "session-delete-request",
      {},
      { sessionId: id },
    );
    try {
      await sessionCommands.deleteSession(id);
      terminalTraceRecorder?.record(
        "session-delete-complete",
        {
          durationMs: Math.round((performance.now() - deleteStart) * 10) / 10,
        },
        { sessionId: id },
      );
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        terminalTraceRecorder?.record(
          "session-delete-failed",
          {
            reason: "not-found",
            durationMs: Math.round((performance.now() - deleteStart) * 10) / 10,
          },
          { sessionId: id },
        );
        return c.json({ error: "Not found" }, 404);
      }
      terminalTraceRecorder?.record(
        "session-delete-failed",
        {
          reason: error instanceof Error ? error.name : "unknown",
          durationMs: Math.round((performance.now() - deleteStart) * 10) / 10,
        },
        { sessionId: id },
      );
      throw error;
    }
  });

  return routes;
}

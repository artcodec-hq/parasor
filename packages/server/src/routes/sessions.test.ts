import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";
import type { PtyHost } from "../pty/host.js";
import type { AppStateStore } from "../state/app-state.js";
import type { EventBus } from "../ws/events.js";
import { createSessionRoutes } from "./sessions.js";

function makeSession(
  overrides: Partial<{
    id: string;
    projectId: string;
    state: string;
    pid: number | null;
    cwd: string;
    generation: number;
  }> = {},
) {
  return {
    id: overrides.id ?? "sess-1",
    projectId: overrides.projectId ?? "proj-1",
    state: overrides.state ?? "running",
    pid: overrides.pid ?? 1234,
    cwd: overrides.cwd ?? "/home/user",
    generation: overrides.generation ?? 0,
    title: "bash",
    command: { type: "shell" as const },
    shell: "/bin/bash",
    createdAt: Date.now(),
  };
}

function makeMocks() {
  const sessions = new Map<string, ReturnType<typeof makeSession>>();
  type MockProjectState = { projectId: string; layout: unknown };
  type MockStoreState = {
    projectStates: Record<string, MockProjectState>;
    sessions: ReturnType<typeof makeSession>[];
  };

  const ptyManager = {
    list: vi.fn(() => [...sessions.values()]),
    listByProject: vi.fn((projectId: string) =>
      [...sessions.values()].filter((s) => s.projectId === projectId),
    ),
    get: vi.fn((id: string) => sessions.get(id) ?? null),
    create: vi.fn(async (opts: { projectId: string }) => {
      const s = makeSession({ projectId: opts.projectId });
      sessions.set(s.id, s);
      return s;
    }),
    dispose: vi.fn(async () => {}),
    restart: vi.fn(async (id: string) => {
      const s = sessions.get(id);
      if (!s) {
        throw new Error(`Missing session ${id}`);
      }
      return { ...s, state: "running", generation: s.generation + 1 };
    }),
    setPinned: vi.fn((id: string, pinned: boolean) => {
      const s = sessions.get(id);
      if (!s) return false;
      const current = (s as { pinned?: boolean }).pinned === true;
      if (current === pinned) return false;
      const next = pinned
        ? { ...s, pinned: true }
        : (() => {
            const { pinned: _drop, ...rest } = s as {
              pinned?: boolean;
            } & typeof s;
            return rest as typeof s;
          })();
      sessions.set(id, next);
      return true;
    }),
    setTitle: vi.fn((id: string, title: string, titleManual?: boolean) => {
      const s = sessions.get(id);
      if (!s) return false;
      const next = titleManual
        ? { ...s, title, titleManual: true }
        : (() => {
            const { titleManual: _drop, ...rest } = s as {
              titleManual?: boolean;
            } & typeof s;
            return { ...rest, title } as typeof s;
          })();
      sessions.set(id, next);
      return true;
    }),
    getScrollback: vi.fn((id: string) => {
      if (!sessions.has(id)) return null;
      return (sessions.get(id) as { scrollback?: string } | undefined)
        ?.scrollback;
    }),
  } as unknown as PtyHost;

  const eventBus = {
    broadcast: vi.fn(),
  } as unknown as EventBus;

  const projectStates: Record<string, MockProjectState> = {};
  const store = {
    get: vi.fn(() => ({
      projects: [
        {
          id: "proj-1",
          path: "/tmp/p1",
          name: "p1",
          createdAt: 1,
          lastAccessedAt: 1,
        },
      ],
      sessions: [...sessions.values()],
      projectStates,
    })),
    mutateProjects: vi.fn((fn: (s: MockStoreState) => void) => {
      const state: MockStoreState = {
        projectStates,
        sessions: [...sessions.values()],
      };
      fn(state);
    }),
    mutateProjectStates: vi.fn((fn: (s: MockStoreState) => void) => {
      const state: MockStoreState = {
        projectStates,
        sessions: [...sessions.values()],
      };
      fn(state);
    }),
    mutateSessions: vi.fn((fn: (s: MockStoreState) => void) => {
      const state: MockStoreState = {
        projectStates,
        sessions: [...sessions.values()],
      };
      fn(state);
    }),
  } as unknown as AppStateStore;

  return { ptyManager, eventBus, store, sessions, projectStates };
}

function createApp(
  mocks: ReturnType<typeof makeMocks>,
  terminalTraceRecorder?: TerminalTraceRecorder,
) {
  const app = new Hono();
  app.route(
    "/api/sessions",
    createSessionRoutes(
      mocks.ptyManager,
      mocks.eventBus,
      mocks.store,
      terminalTraceRecorder,
    ),
  );
  return app;
}

describe("session routes", () => {
  let mocks: ReturnType<typeof makeMocks>;
  let app: Hono;

  beforeEach(() => {
    mocks = makeMocks();
    app = createApp(mocks);
  });

  // GET /
  describe("GET /api/sessions", () => {
    it("returns all sessions", async () => {
      mocks.sessions.set("s1", makeSession({ id: "s1" }));
      const res = await app.request("/api/sessions");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessions).toHaveLength(1);
    });

    it("filters by projectId", async () => {
      mocks.sessions.set("s1", makeSession({ id: "s1", projectId: "proj-1" }));
      mocks.sessions.set("s2", makeSession({ id: "s2", projectId: "proj-2" }));
      const res = await app.request("/api/sessions?projectId=proj-1");
      expect(res.status).toBe(200);
      expect(mocks.ptyManager.listByProject).toHaveBeenCalledWith("proj-1");
    });
  });

  // POST /
  describe("POST /api/sessions", () => {
    it("creates session with valid projectId", async () => {
      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "proj-1" }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.projectId).toBe("proj-1");
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "session-created" }),
      );
    });

    it("returns 400 without projectId", async () => {
      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("projectId is required");
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "nonexistent" }),
      });
      expect(res.status).toBe(404);
    });

    it("handles malformed JSON body gracefully", async () => {
      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("passes custom command, cwd, title, and bootstrap input to ptyManager.create", async () => {
      await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "proj-1",
          command: { type: "custom", command: "npm", args: ["run", "dev"] },
          cwd: "/custom/path",
          title: "Dev Server",
          bootstrapInput: "pnpm dev\r",
        }),
      });
      expect(mocks.ptyManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          command: { type: "custom", command: "npm", args: ["run", "dev"] },
          cwd: "/custom/path",
          title: "Dev Server",
          bootstrapInput: "pnpm dev\r",
        }),
      );
    });

    it("records sanitized create lifecycle trace events when tracing is enabled", async () => {
      const recorder = new TerminalTraceRecorder({
        enabled: true,
        now: () => 456,
      });
      app = createApp(mocks, recorder);

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "proj-1",
          command: { type: "custom", command: "npm", args: ["run", "dev"] },
          cwd: "/custom/path",
          title: "Dev Server",
          bootstrapInput: "secret command\r",
        }),
      });

      expect(res.status).toBe(201);
      expect(recorder.list().map((event) => event.type)).toEqual([
        "session-create-request",
        "session-create-complete",
      ]);
      expect(JSON.stringify(recorder.list())).not.toContain("secret command");
      expect(recorder.list()[0]).toMatchObject({
        type: "session-create-request",
        payload: {
          projectId: "proj-1",
          commandType: "custom",
          hasCwd: true,
          hasTitle: true,
          hasBootstrapInput: true,
        },
      });
    });
  });

  // GET /:id/cwd
  describe("GET /api/sessions/:id/cwd", () => {
    it("returns 404 for nonexistent session", async () => {
      const res = await app.request("/api/sessions/nonexistent/cwd");
      expect(res.status).toBe(404);
    });

    it("returns 409 for ended session", async () => {
      mocks.sessions.set(
        "ended-1",
        makeSession({ id: "ended-1", state: "ended", pid: null }),
      );
      const res = await app.request("/api/sessions/ended-1/cwd");
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe("Session not running");
    });
  });

  describe("GET /api/sessions/:id/scrollback-snapshot", () => {
    it("returns 404 for missing sessions", async () => {
      const res = await app.request(
        "/api/sessions/missing/scrollback-snapshot",
      );

      expect(res.status).toBe(404);
    });

    it("returns an empty snapshot when the session has no scrollback", async () => {
      mocks.sessions.set("s1", makeSession({ id: "s1" }));

      const res = await app.request("/api/sessions/s1/scrollback-snapshot");

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        text: "",
        rawBytes: 0,
        replayBytes: 0,
        hasMore: false,
      });
    });

    it("renders a bounded headless scrollback snapshot", async () => {
      mocks.sessions.set("s1", {
        ...makeSession({ id: "s1" }),
        scrollback: `${"old line\r\n".repeat(200)}latest prompt\n`,
      } as ReturnType<typeof makeSession> & { scrollback: string });

      const res = await app.request(
        "/api/sessions/s1/scrollback-snapshot?cols=80&rows=24&maxBytes=128",
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.text).toContain("latest prompt");
      expect(data.text).not.toContain("\x1b");
      expect(data.replayBytes).toBeLessThanOrEqual(128);
      expect(data.maxBytes).toBe(128);
      expect(data.hasMore).toBe(true);
    });

    it("preserves color attributes in the scrollback snapshot", async () => {
      mocks.sessions.set("s1", {
        ...makeSession({ id: "s1" }),
        scrollback: "plain \x1b[31mred\x1b[0m\r\n",
      } as ReturnType<typeof makeSession> & { scrollback: string });

      const res = await app.request(
        "/api/sessions/s1/scrollback-snapshot?cols=80&rows=24&maxBytes=1024",
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.text).toContain("plain \x1b[31mred\x1b[0m");
    });

    it("scales the headless line window with larger snapshot requests", async () => {
      mocks.sessions.set("s1", {
        ...makeSession({ id: "s1" }),
        scrollback: "latest prompt\n",
      } as ReturnType<typeof makeSession> & { scrollback: string });

      const res = await app.request(
        "/api/sessions/s1/scrollback-snapshot?maxBytes=524288",
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.scrollbackLines).toBe(20_000);
    });

    it("clamps oversized scrollback snapshot requests", async () => {
      mocks.sessions.set("s1", {
        ...makeSession({ id: "s1" }),
        scrollback: "latest prompt\n",
      } as ReturnType<typeof makeSession> & { scrollback: string });

      const res = await app.request(
        "/api/sessions/s1/scrollback-snapshot?maxBytes=999999999",
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.maxBytes).toBe(4 * 1024 * 1024);
    });
  });

  // POST /:id/restart
  describe("POST /api/sessions/:id/restart", () => {
    it("returns 404 for nonexistent session", async () => {
      const res = await app.request("/api/sessions/nonexistent/restart", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });

    it("returns 409 for running session", async () => {
      mocks.sessions.set(
        "run-1",
        makeSession({ id: "run-1", state: "running" }),
      );
      const res = await app.request("/api/sessions/run-1/restart", {
        method: "POST",
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe("Session is not ended");
    });

    it("restarts ended session and broadcasts event", async () => {
      mocks.sessions.set(
        "ended-1",
        makeSession({ id: "ended-1", state: "ended" }),
      );
      const res = await app.request("/api/sessions/ended-1/restart", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(mocks.ptyManager.restart).toHaveBeenCalledWith("ended-1");
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "session-restarted" }),
      );
    });

    it("returns 500 when restart throws", async () => {
      mocks.sessions.set(
        "ended-1",
        makeSession({ id: "ended-1", state: "ended" }),
      );
      vi.mocked(mocks.ptyManager.restart).mockRejectedValueOnce(
        new Error("PTY failed"),
      );
      const res = await app.request("/api/sessions/ended-1/restart", {
        method: "POST",
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("PTY failed");
    });
  });

  // POST /:id/pin
  describe("POST /api/sessions/:id/pin", () => {
    it("returns 404 for nonexistent session", async () => {
      const res = await app.request("/api/sessions/missing/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when body lacks boolean pinned", async () => {
      mocks.sessions.set("pin-1", makeSession({ id: "pin-1" }));
      const res = await app.request("/api/sessions/pin-1/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("sets pinned=true and broadcasts session-pin-changed", async () => {
      mocks.sessions.set("pin-2", makeSession({ id: "pin-2" }));
      const res = await app.request("/api/sessions/pin-2/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      });
      expect(res.status).toBe(200);
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith({
        type: "session-pin-changed",
        sessionId: "pin-2",
        pinned: true,
      });
      const data = await res.json();
      expect(data.pinned).toBe(true);
    });

    it("does not broadcast when pinned is unchanged", async () => {
      mocks.sessions.set("pin-3", {
        ...makeSession({ id: "pin-3" }),
        pinned: true,
      } as ReturnType<typeof makeSession>);
      const res = await app.request("/api/sessions/pin-3/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      });
      expect(res.status).toBe(200);
      expect(mocks.eventBus.broadcast).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "session-pin-changed" }),
      );
    });
  });

  // POST /:id/title
  describe("POST /api/sessions/:id/title", () => {
    it("returns 404 for nonexistent session", async () => {
      const res = await app.request("/api/sessions/missing/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "renamed" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when title is not a string", async () => {
      mocks.sessions.set("title-1", makeSession({ id: "title-1" }));
      const res = await app.request("/api/sessions/title-1/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: 42 }),
      });
      expect(res.status).toBe(400);
    });

    it("sets a manual title and broadcasts session-title-changed", async () => {
      mocks.sessions.set("title-2", makeSession({ id: "title-2" }));
      const res = await app.request("/api/sessions/title-2/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: " Build logs " }),
      });
      expect(res.status).toBe(200);
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith({
        type: "session-title-changed",
        sessionId: "title-2",
        title: "Build logs",
        titleManual: true,
      });
      const data = await res.json();
      expect(data.title).toBe("Build logs");
      expect(data.titleManual).toBe(true);
    });
  });

  // DELETE /:id
  describe("DELETE /api/sessions/:id", () => {
    it("returns 404 for nonexistent session", async () => {
      const res = await app.request("/api/sessions/nonexistent", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });

    it("disposes session and broadcasts session-closed only (no layout)", async () => {
      const recorder = new TerminalTraceRecorder({
        enabled: true,
        now: () => 789,
      });
      app = createApp(mocks, recorder);
      mocks.sessions.set(
        "del-1",
        makeSession({ id: "del-1", projectId: "proj-1" }),
      );
      const res = await app.request("/api/sessions/del-1", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      expect(mocks.ptyManager.dispose).toHaveBeenCalledWith("del-1");
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "session-closed", sessionId: "del-1" }),
      );
      // Without layout, should NOT broadcast layout-updated
      expect(mocks.eventBus.broadcast).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "layout-updated" }),
      );
      expect(recorder.list().map((event) => event.type)).toEqual([
        "session-delete-request",
        "session-delete-complete",
      ]);
    });

    it("removes pane from layout on delete", async () => {
      mocks.sessions.set(
        "del-2",
        makeSession({ id: "del-2", projectId: "proj-1" }),
      );
      mocks.projectStates["proj-1"] = {
        projectId: "proj-1",
        layout: {
          type: "split",
          id: "split-1",
          direction: "horizontal",
          children: [
            { type: "terminal", id: "p1", sessionId: "del-2" },
            { type: "terminal", id: "p2", sessionId: "other" },
          ],
          sizes: [50, 50],
        },
      };
      const res = await app.request("/api/sessions/del-2", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      expect(mocks.store.mutateProjectStates).toHaveBeenCalled();
      expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "layout-updated" }),
      );
    });
  });
});

import { homedir } from "node:os";
import { join } from "node:path";
import type { ProjectState, Session } from "@parasor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PtyHost } from "../../pty/host.js";
import type {
  AppStateStore,
  ProjectStatesMutateView,
} from "../../state/app-state.js";
import type { EventBus } from "../../ws/events.js";
import { WorkspaceConflictError, WorkspaceNotFoundError } from "./errors.js";
import { createSessionCommands } from "./session-commands.js";

function makeSession(
  overrides: Partial<{
    id: string;
    projectId: string;
    state: Session["state"];
    pid: number | null;
    cwd: string;
    generation: number;
    title: string;
    titleManual: boolean;
  }> = {},
): Session {
  return {
    id: overrides.id ?? "sess-1",
    projectId: overrides.projectId ?? "proj-1",
    state: overrides.state ?? "running",
    pid: overrides.pid ?? 1234,
    cwd: overrides.cwd ?? "/tmp/project",
    generation: overrides.generation ?? 0,
    title: overrides.title ?? "bash",
    ...(overrides.titleManual !== undefined && {
      titleManual: overrides.titleManual,
    }),
    command: { type: "shell" as const },
    shell: "/bin/bash",
    createdAt: 1,
  };
}

function mustGetSession(id: string, sessions: Map<string, Session>): Session {
  const session = sessions.get(id);
  if (!session) throw new Error(`missing test session: ${id}`);
  return session;
}

function makeProjectState(
  projectId: string,
  layout: ProjectState["layout"] = null,
): ProjectState {
  return {
    projectId,
    layout,
    worktrees: [],
    openFiles: [],
    lastFocusedPaneId: null,
    focusedPaneId: null,
    lastAccessedAt: 1,
  };
}

describe("createSessionCommands", () => {
  let sessions: Map<string, ReturnType<typeof makeSession>>;
  let ptyManager: PtyHost;
  let eventBus: EventBus;
  let appStateStore: AppStateStore;

  beforeEach(() => {
    sessions = new Map();
    ptyManager = {
      create: vi.fn(async (input: { projectId: string; cwd: string }) => {
        const session = makeSession({
          projectId: input.projectId,
          cwd: input.cwd,
        });
        sessions.set(session.id, session);
        return session;
      }),
      dispose: vi.fn(async () => undefined),
      get: vi.fn((id: string) => sessions.get(id) ?? null),
      restart: vi.fn(async (id: string) => {
        const session = mustGetSession(id, sessions);
        return {
          ...session,
          state: "running",
          generation: session.generation + 1,
        };
      }),
      setTitle: vi.fn((id: string, title: string, titleManual?: boolean) => {
        const session = sessions.get(id);
        if (!session) return false;
        const next = titleManual
          ? { ...session, title, titleManual: true }
          : (() => {
              const { titleManual: _drop, ...rest } = session;
              return { ...rest, title };
            })();
        sessions.set(id, next);
        return true;
      }),
    } as unknown as PtyHost;
    eventBus = {
      broadcast: vi.fn(),
    } as unknown as EventBus;
    appStateStore = {
      get: vi.fn(() => ({
        projects: [
          {
            id: "proj-1",
            path: "/tmp/project",
            name: "project",
            createdAt: 1,
            lastAccessedAt: 1,
          },
        ],
      })),
      mutateProjectStates: vi.fn(
        (fn: (state: ProjectStatesMutateView) => void) =>
          fn({
            projectStates: {
              "proj-1": makeProjectState("proj-1", {
                type: "split",
                id: "split-1",
                direction: "horizontal",
                children: [
                  { type: "terminal", id: "pane-1", sessionId: "sess-1" },
                  { type: "terminal", id: "pane-2", sessionId: "other" },
                ],
                sizes: [50, 50],
              }),
            },
            projects: [
              {
                id: "proj-1",
                path: "/tmp/project",
                name: "project",
                createdAt: 1,
                lastAccessedAt: 1,
              },
            ],
            sessions: [...sessions.values()],
          }),
      ),
    } as unknown as AppStateStore;
  });

  it("creates a session and broadcasts it", async () => {
    const commands = createSessionCommands({
      appStateStore,
      eventBus,
      ptyManager,
    });

    const session = await commands.createSession({ projectId: "proj-1" });

    expect(session.projectId).toBe("proj-1");
    expect(ptyManager.create).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/tmp/project" }),
    );
    expect(eventBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session-created", session }),
    );
  });

  it("expands ~ in legacy project.path before spawning PTY", async () => {
    const tildePath = "~/projects/legacy";
    const expected = join(homedir(), "projects/legacy");
    const storeWithTilde = {
      get: vi.fn(() => ({
        projects: [
          {
            id: "proj-1",
            path: tildePath,
            name: "legacy",
            createdAt: 1,
            lastAccessedAt: 1,
          },
        ],
      })),
      mutateProjectStates: vi.fn(),
    } as unknown as AppStateStore;
    const commands = createSessionCommands({
      appStateStore: storeWithTilde,
      eventBus,
      ptyManager,
    });

    await commands.createSession({ projectId: "proj-1" });

    expect(ptyManager.create).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: expected }),
    );
  });

  it("throws when creating a session for an unknown project", async () => {
    const commands = createSessionCommands({
      appStateStore: {
        get: vi.fn(() => ({ projects: [] })),
      } as unknown as AppStateStore,
      eventBus,
      ptyManager,
    });

    await expect(
      commands.createSession({ projectId: "missing" }),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("restarts an ended session and broadcasts it", async () => {
    sessions.set("sess-1", makeSession({ id: "sess-1", state: "ended" }));
    const commands = createSessionCommands({
      appStateStore,
      eventBus,
      ptyManager,
    });

    const session = await commands.restartSession("sess-1");

    expect(session.generation).toBe(1);
    expect(eventBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session-restarted", session }),
    );
  });

  it("throws conflict when restarting a running session", async () => {
    sessions.set("sess-1", makeSession({ id: "sess-1", state: "running" }));
    const commands = createSessionCommands({
      appStateStore,
      eventBus,
      ptyManager,
    });

    await expect(commands.restartSession("sess-1")).rejects.toBeInstanceOf(
      WorkspaceConflictError,
    );
  });

  it("renames a session as a manual title and broadcasts it", async () => {
    sessions.set("sess-1", makeSession({ id: "sess-1" }));
    const commands = createSessionCommands({
      appStateStore,
      eventBus,
      ptyManager,
    });

    await commands.setSessionTitle("sess-1", "  Build logs  ");

    expect(ptyManager.setTitle).toHaveBeenCalledWith(
      "sess-1",
      "Build logs",
      true,
    );
    expect(eventBus.broadcast).toHaveBeenCalledWith({
      type: "session-title-changed",
      sessionId: "sess-1",
      title: "Build logs",
      titleManual: true,
    });
  });

  it("clears a manual session title with an empty title", async () => {
    sessions.set("sess-1", {
      ...makeSession({ id: "sess-1" }),
      title: "Build logs",
      titleManual: true,
    });
    const commands = createSessionCommands({
      appStateStore,
      eventBus,
      ptyManager,
    });

    await commands.setSessionTitle("sess-1", "   ");

    expect(ptyManager.setTitle).toHaveBeenCalledWith("sess-1", "", false);
    expect(eventBus.broadcast).toHaveBeenCalledWith({
      type: "session-title-changed",
      sessionId: "sess-1",
      title: "",
      titleManual: false,
    });
  });

  it("deletes a session and emits layout cleanup", async () => {
    sessions.set("sess-1", makeSession({ id: "sess-1" }));
    const commands = createSessionCommands({
      appStateStore,
      eventBus,
      ptyManager,
    });

    await commands.deleteSession("sess-1");

    expect(ptyManager.dispose).toHaveBeenCalledWith("sess-1");
    expect(eventBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "layout-updated", projectId: "proj-1" }),
    );
    expect(eventBus.broadcast).toHaveBeenCalledWith({
      type: "session-closed",
      sessionId: "sess-1",
      projectId: "proj-1",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PtyHost } from "../../pty/host.js";
import { WorkspaceConflictError, WorkspaceNotFoundError } from "./errors.js";
import { createSessionQueries } from "./session-queries.js";

function makeSession(
  overrides: Partial<{
    id: string;
    projectId: string;
    state: string;
    pid: number | null;
    cwd: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "sess-1",
    projectId: overrides.projectId ?? "proj-1",
    state: overrides.state ?? "running",
    pid: overrides.pid ?? 1234,
    cwd: overrides.cwd ?? "/tmp/project",
    generation: 0,
    title: "bash",
    command: { type: "shell" as const },
    shell: "/bin/bash",
    createdAt: 1,
  };
}

describe("createSessionQueries", () => {
  let sessions: Map<string, ReturnType<typeof makeSession>>;
  let ptyManager: PtyHost;

  beforeEach(() => {
    sessions = new Map();
    ptyManager = {
      get: vi.fn((id: string) => sessions.get(id) ?? null),
      list: vi.fn(() => [...sessions.values()]),
      listByProject: vi.fn((projectId: string) =>
        [...sessions.values()].filter(
          (session) => session.projectId === projectId,
        ),
      ),
    } as unknown as PtyHost;
  });

  it("lists all sessions or project sessions", () => {
    sessions.set("s1", makeSession({ id: "s1", projectId: "proj-1" }));
    sessions.set("s2", makeSession({ id: "s2", projectId: "proj-2" }));
    const queries = createSessionQueries({ ptyManager });

    expect(queries.listSessions()).toHaveLength(2);
    expect(queries.listSessions("proj-1")).toHaveLength(1);
  });

  it("returns cwd for a running session", async () => {
    sessions.set("s1", makeSession({ id: "s1", cwd: "/tmp/project" }));
    const queries = createSessionQueries({
      ptyManager,
      readProcessCwd: vi.fn(async () => "/resolved/cwd"),
    });

    await expect(queries.getSessionCwd("s1")).resolves.toEqual({
      cwd: "/resolved/cwd",
    });
  });

  it("throws when session is missing", async () => {
    const queries = createSessionQueries({ ptyManager });

    await expect(queries.getSessionCwd("missing")).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });

  it("throws when session is not running", async () => {
    sessions.set("s1", makeSession({ id: "s1", state: "ended", pid: null }));
    const queries = createSessionQueries({ ptyManager });

    await expect(queries.getSessionCwd("s1")).rejects.toBeInstanceOf(
      WorkspaceConflictError,
    );
  });
});

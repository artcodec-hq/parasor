import type { Project, ProjectState, Session } from "@parasor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PtyHost } from "../../pty/host.js";
import type {
  AppStateStore,
  ProjectStatesMutateView,
} from "../../state/app-state.js";
import type { ProjectManager } from "../../state/project-manager.js";
import type { EventBus } from "../../ws/events.js";
import { WorkspaceConflictError, WorkspaceNotFoundError } from "./errors.js";
import { createProjectCommands } from "./project-commands.js";

function makeProject(
  overrides: Partial<{
    id: string;
    path: string;
    name: string;
    pinned: boolean;
  }> = {},
): Project {
  return {
    id: overrides.id ?? "proj-1",
    path: overrides.path ?? "/tmp/proj",
    name: overrides.name ?? "proj",
    pinned: overrides.pinned ?? false,
    createdAt: 1,
    lastAccessedAt: 1,
  };
}

function makeSession(id: string, projectId: string): Session {
  return {
    id,
    projectId,
    state: "running",
    pid: 1234,
    cwd: "/tmp/proj",
    generation: 0,
    title: "bash",
    command: { type: "shell" },
    shell: "/bin/bash",
    createdAt: 1,
  };
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

describe("createProjectCommands", () => {
  let projects: Map<string, Project>;
  let projectManager: ProjectManager;
  let ptyManager: PtyHost;
  let eventBus: EventBus;
  let appStateStore: AppStateStore;

  beforeEach(() => {
    projects = new Map();
    projectManager = {
      create: vi.fn((input: { path: string; name?: string }) => {
        const project = makeProject({
          path: input.path,
          name: input.name ?? "proj",
        });
        projects.set(project.id, project);
        return project;
      }),
      delete: vi.fn(),
      get: vi.fn((id: string) => projects.get(id)),
      update: vi.fn((id: string, data: { name?: string; pinned?: boolean }) => {
        const project = projects.get(id);
        if (!project) return undefined;
        Object.assign(project, data);
        return project;
      }),
      reorder: vi.fn((ids: string[]) => {
        if (ids.length !== projects.size) return undefined;
        const idSet = new Set(ids);
        if (idSet.size !== ids.length) return undefined;
        for (const id of projects.keys()) {
          if (!idSet.has(id)) return undefined;
        }
        ids.forEach((id, idx) => {
          const p = projects.get(id);
          if (p) p.order = idx;
        });
        return [...projects.values()];
      }),
    } as unknown as ProjectManager;
    ptyManager = {
      dispose: vi.fn(async () => undefined),
      listByProject: vi.fn(() => []),
    } as unknown as PtyHost;
    eventBus = {
      broadcast: vi.fn(),
    } as unknown as EventBus;
    appStateStore = {
      mutateProjectStates: vi.fn(
        (fn: (state: ProjectStatesMutateView) => void) =>
          fn({
            projectStates: {
              "proj-1": makeProjectState("proj-1"),
            },
            projects: [...projects.values()],
            sessions: [],
          }),
      ),
    } as unknown as AppStateStore;
  });

  it("creates a project and broadcasts it", () => {
    const commands = createProjectCommands({
      appStateStore,
      eventBus,
      projectManager,
      ptyManager,
    });

    const project = commands.createProject({ path: "/tmp/proj", name: "Proj" });

    expect(project.name).toBe("Proj");
    expect(eventBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "project-created", project }),
    );
  });

  it("throws conflict for pinned project delete without force", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1", pinned: true }));
    const commands = createProjectCommands({
      appStateStore,
      eventBus,
      projectManager,
      ptyManager,
    });

    await expect(
      commands.deleteProject("proj-1", false),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it("disposes project sessions before delete", async () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    vi.mocked(ptyManager.listByProject).mockReturnValue([
      makeSession("s1", "proj-1"),
      makeSession("s2", "proj-1"),
    ]);
    const commands = createProjectCommands({
      appStateStore,
      eventBus,
      projectManager,
      ptyManager,
    });

    await commands.deleteProject("proj-1", true);

    expect(ptyManager.dispose).toHaveBeenCalledTimes(2);
    expect(eventBus.broadcast).toHaveBeenCalledWith({
      type: "project-deleted",
      projectId: "proj-1",
    });
  });

  it("updates layout and broadcasts it", () => {
    projects.set("proj-1", makeProject({ id: "proj-1" }));
    const commands = createProjectCommands({
      appStateStore,
      eventBus,
      projectManager,
      ptyManager,
    });
    const layout = { type: "terminal", id: "pane-1", sessionId: "s1" } as const;

    commands.updateLayout("proj-1", layout);

    expect(appStateStore.mutateProjectStates).toHaveBeenCalled();
    expect(eventBus.broadcast).toHaveBeenCalledWith({
      type: "layout-updated",
      projectId: "proj-1",
      layout,
    });
  });

  it("reorders projects and broadcasts project-updated for each", () => {
    projects.set("p1", makeProject({ id: "p1" }));
    projects.set("p2", makeProject({ id: "p2" }));
    const commands = createProjectCommands({
      appStateStore,
      eventBus,
      projectManager,
      ptyManager,
    });
    const ok = commands.reorderProjects(["p2", "p1"]);
    expect(ok).toBe(true);
    expect(projects.get("p2")?.order).toBe(0);
    expect(projects.get("p1")?.order).toBe(1);
    const updates = vi
      .mocked(eventBus.broadcast)
      .mock.calls.filter((c) => c[0].type === "project-updated");
    expect(updates).toHaveLength(2);
  });

  it("returns false from reorderProjects when ids mismatch", () => {
    projects.set("p1", makeProject({ id: "p1" }));
    const commands = createProjectCommands({
      appStateStore,
      eventBus,
      projectManager,
      ptyManager,
    });
    expect(commands.reorderProjects(["p1", "missing"])).toBe(false);
    expect(eventBus.broadcast).not.toHaveBeenCalled();
  });

  it("throws not found when updating a missing project", () => {
    const commands = createProjectCommands({
      appStateStore,
      eventBus,
      projectManager,
      ptyManager,
    });

    expect(() =>
      commands.updateProject("missing", { name: "Renamed" }),
    ).toThrow(WorkspaceNotFoundError);
  });

  describe("rememberWorktreeLocalFiles", () => {
    it("persists a filtered string allowlist via projectManager.update", () => {
      projects.set("proj-1", makeProject({ id: "proj-1" }));
      const commands = createProjectCommands({
        appStateStore,
        eventBus,
        projectManager,
        ptyManager,
      });

      commands.rememberWorktreeLocalFiles("proj-1", [".env", 42, ".envrc"]);

      expect(projectManager.update).toHaveBeenCalledWith("proj-1", {
        worktreeLocalFileAllowlist: [".env", ".envrc"],
      });
    });

    it("persists an empty allowlist when copyLocalFiles is not an array", () => {
      projects.set("proj-1", makeProject({ id: "proj-1" }));
      const commands = createProjectCommands({
        appStateStore,
        eventBus,
        projectManager,
        ptyManager,
      });

      commands.rememberWorktreeLocalFiles("proj-1", undefined);

      expect(projectManager.update).toHaveBeenCalledWith("proj-1", {
        worktreeLocalFileAllowlist: [],
      });
    });
  });
});

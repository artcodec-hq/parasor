import type { PaneNode } from "@parasor/shared";
import type { PtyHost } from "../../pty/host.js";
import type { AppStateStore } from "../../state/app-state.js";
import type { ProjectManager } from "../../state/project-manager.js";
import type { EventPublisher } from "../ports.js";
import { WorkspaceConflictError, WorkspaceNotFoundError } from "./errors.js";

interface CreateProjectCommandsDeps {
  appStateStore: AppStateStore;
  eventBus: EventPublisher;
  projectManager: ProjectManager;
  ptyManager: PtyHost;
}

export function createProjectCommands({
  appStateStore,
  eventBus,
  projectManager,
  ptyManager,
}: CreateProjectCommandsDeps) {
  return {
    createProject(input: { path: string; name?: string }) {
      const project = projectManager.create({
        path: input.path,
        ...(input.name !== undefined && { name: input.name }),
      });

      eventBus.broadcast({ type: "project-created", project });
      return project;
    },

    updateProject(
      id: string,
      input: { name?: string; pinned?: boolean; readOnly?: boolean },
    ) {
      const project = projectManager.update(id, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.pinned !== undefined && { pinned: input.pinned }),
        ...(input.readOnly !== undefined && { readOnly: input.readOnly }),
      });

      if (!project) {
        throw new WorkspaceNotFoundError();
      }

      eventBus.broadcast({ type: "project-updated", project });
      return project;
    },

    async deleteProject(id: string, force: boolean) {
      const project = projectManager.get(id);
      if (!project) {
        throw new WorkspaceNotFoundError();
      }
      if (project.pinned && !force) {
        throw new WorkspaceConflictError("Project is pinned; use ?force=true");
      }

      const sessions = ptyManager.listByProject(id);
      for (const session of sessions) {
        await ptyManager.dispose(session.id);
        eventBus.broadcast({
          type: "session-closed",
          sessionId: session.id,
          projectId: id,
        });
      }

      projectManager.delete(id, force);
      eventBus.broadcast({ type: "project-deleted", projectId: id });
    },

    reorderProjects(ids: string[]): boolean {
      const result = projectManager.reorder(ids);
      if (!result) return false;
      for (const project of result) {
        eventBus.broadcast({ type: "project-updated", project });
      }
      return true;
    },

    /**
     * Persist the worktree local-file copy selection as the project's
     * allowlist. `copyLocalFiles` is the raw request value; non-array or
     * non-string members are dropped (empty list otherwise), mirroring the
     * normalization that the worktree-creation route applied inline.
     */
    rememberWorktreeLocalFiles(projectId: string, copyLocalFiles: unknown) {
      projectManager.update(projectId, {
        worktreeLocalFileAllowlist: Array.isArray(copyLocalFiles)
          ? copyLocalFiles.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
      });
    },

    updateLayout(id: string, layout: PaneNode | null) {
      const project = projectManager.get(id);
      if (!project) {
        throw new WorkspaceNotFoundError();
      }

      appStateStore.mutateProjectStates((state) => {
        const projectState = state.projectStates[id];
        if (projectState) {
          projectState.layout = layout;
        }
      });

      eventBus.broadcast({ type: "layout-updated", projectId: id, layout });
    },
  };
}

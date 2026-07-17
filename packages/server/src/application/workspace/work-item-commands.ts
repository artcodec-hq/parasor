import { randomUUID } from "node:crypto";
import type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
} from "@parasor/shared";
import type { AppStateStore } from "../../state/app-state.js";
import type { ProjectManager } from "../../state/project-manager.js";
import type { EventPublisher } from "../ports.js";
import { WorkItemNotFoundError, WorkspaceNotFoundError } from "./errors.js";

interface CreateWorkItemCommandsDeps {
  appStateStore: AppStateStore;
  eventBus: EventPublisher;
  projectManager: ProjectManager;
  createId?: () => string;
  now?: () => number;
}

export function createWorkItemCommands({
  appStateStore,
  eventBus,
  projectManager,
  createId = randomUUID,
  now = Date.now,
}: CreateWorkItemCommandsDeps) {
  function assertProject(projectId: string): void {
    if (!projectManager.get(projectId)) {
      throw new WorkspaceNotFoundError("Project not found");
    }
  }

  return {
    list(projectId: string): WorkItem[] {
      assertProject(projectId);
      return [...(appStateStore.get().workItems[projectId] ?? [])];
    },

    create(projectId: string, input: CreateWorkItemInput): WorkItem {
      assertProject(projectId);
      const timestamp = now();
      const item: WorkItem = {
        id: createId(),
        projectId,
        title: input.title,
        status: input.status ?? "todo",
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        attachments: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.primaryWorktreePath === undefined
          ? {}
          : { primaryWorktreePath: input.primaryWorktreePath }),
      };
      appStateStore.mutateWorkItems((state) => {
        const items = state.workItems[projectId] ?? [];
        items.push(item);
        state.workItems[projectId] = items;
      });
      eventBus.broadcast({ type: "work-item-created", item });
      return item;
    },

    update(
      projectId: string,
      workItemId: string,
      input: UpdateWorkItemInput,
    ): WorkItem {
      assertProject(projectId);
      let result: WorkItem | undefined;
      appStateStore.mutateWorkItems((state) => {
        const item = state.workItems[projectId]?.find(
          (candidate) => candidate.id === workItemId,
        );
        if (!item) return;
        if (input.title !== undefined) item.title = input.title;
        if (input.status !== undefined) item.status = input.status;
        if (input.acceptanceCriteria !== undefined) {
          item.acceptanceCriteria = input.acceptanceCriteria;
        }
        if (input.notes === null) delete item.notes;
        else if (input.notes !== undefined) item.notes = input.notes;
        if (input.primaryWorktreePath === null) {
          delete item.primaryWorktreePath;
        } else if (input.primaryWorktreePath !== undefined) {
          item.primaryWorktreePath = input.primaryWorktreePath;
        }
        item.updatedAt = now();
        result = item;
      });
      if (!result) throw new WorkItemNotFoundError();
      eventBus.broadcast({ type: "work-item-updated", item: result });
      return result;
    },

    delete(projectId: string, workItemId: string): void {
      assertProject(projectId);
      let deleted = false;
      appStateStore.mutateWorkItems((state) => {
        const items = state.workItems[projectId] ?? [];
        const next = items.filter((item) => item.id !== workItemId);
        deleted = next.length !== items.length;
        if (deleted) state.workItems[projectId] = next;
      });
      if (!deleted) throw new WorkItemNotFoundError();
      let panesChanged = false;
      appStateStore.mutateProjectStates((state) => {
        const projectState = state.projectStates[projectId];
        if (!projectState) return;
        for (const worktree of projectState.worktrees) {
          const next = worktree.panes.filter(
            (pane) =>
              pane.state.kind !== "work-item" ||
              pane.state.workItemId !== workItemId,
          );
          if (next.length === worktree.panes.length) continue;
          panesChanged = true;
          worktree.panes = next;
        }
        if (
          projectState.focusedPaneId &&
          !projectState.worktrees.some((worktree) =>
            worktree.panes.some(
              (pane) => pane.id === projectState.focusedPaneId,
            ),
          )
        ) {
          projectState.focusedPaneId = null;
        }
      });
      eventBus.broadcast({ type: "work-item-deleted", projectId, workItemId });
      if (panesChanged) {
        const projectState = appStateStore.get().projectStates[projectId];
        if (projectState) {
          eventBus.broadcast({
            type: "panes-updated",
            projectId,
            worktrees: projectState.worktrees,
            focusedPaneId: projectState.focusedPaneId,
          });
        }
      }
    },
  };
}

export type WorkItemCommands = ReturnType<typeof createWorkItemCommands>;

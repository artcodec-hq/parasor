import {
  normalizeCreateWorkItemInput,
  normalizeUpdateWorkItemInput,
} from "@parasor/shared";
import { type Context, Hono } from "hono";
import {
  WorkItemNotFoundError,
  WorkspaceNotFoundError,
} from "../application/workspace/errors.js";
import { createPaneCommands } from "../application/workspace/pane-commands.js";
import { createWorkItemCommands } from "../application/workspace/work-item-commands.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { WorktreeCache } from "../state/worktree-cache.js";
import type { EventBus } from "../ws/events.js";

interface WorkItemRoutesDeps {
  appStateStore: AppStateStore;
  eventBus: EventBus;
  projectManager: ProjectManager;
  worktreeCache?: WorktreeCache;
}

export function createWorkItemRoutes(deps: WorkItemRoutesDeps): Hono {
  const routes = new Hono();
  const commands = createWorkItemCommands(deps);
  const paneCommands = createPaneCommands(deps);

  routes.get("/:projectId/work-items", (c) => {
    try {
      return c.json({ workItems: commands.list(c.req.param("projectId")) });
    } catch (error) {
      return notFound(c, error);
    }
  });

  routes.post("/:projectId/work-items", async (c) => {
    const input = normalizeCreateWorkItemInput(
      await c.req.json<unknown>().catch(() => null),
    );
    if (!input) return c.json({ error: "Invalid work item" }, 400);
    try {
      return c.json(
        { workItem: commands.create(c.req.param("projectId"), input) },
        201,
      );
    } catch (error) {
      return notFound(c, error);
    }
  });

  routes.patch("/:projectId/work-items/:workItemId", async (c) => {
    const input = normalizeUpdateWorkItemInput(
      await c.req.json<unknown>().catch(() => null),
    );
    if (!input) return c.json({ error: "Invalid work item update" }, 400);
    try {
      return c.json({
        workItem: commands.update(
          c.req.param("projectId"),
          c.req.param("workItemId"),
          input,
        ),
      });
    } catch (error) {
      return notFound(c, error);
    }
  });

  routes.delete("/:projectId/work-items/:workItemId", (c) => {
    try {
      commands.delete(c.req.param("projectId"), c.req.param("workItemId"));
      return c.json({ ok: true });
    } catch (error) {
      return notFound(c, error);
    }
  });

  routes.post("/:projectId/work-items/:workItemId/panes", async (c) => {
    const body = await c.req
      .json<{ worktreePath?: unknown }>()
      .catch(() => null);
    if (!body || typeof body.worktreePath !== "string") {
      return c.json({ error: "Invalid worktree pane" }, 400);
    }
    const projectId = c.req.param("projectId");
    const project = deps.projectManager.get(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);
    const registeredPaths = new Set([
      project.path,
      ...(deps.worktreeCache?.get()[projectId] ?? []).map(
        (worktree) => worktree.path,
      ),
    ]);
    if (!registeredPaths.has(body.worktreePath)) {
      return c.json({ error: "Worktree not found" }, 404);
    }
    try {
      const pane = paneCommands.addWorkItemPane(
        projectId,
        body.worktreePath,
        c.req.param("workItemId"),
      );
      return c.json({ pane, ...paneSnapshot(deps.appStateStore, projectId) });
    } catch (error) {
      return notFound(c, error);
    }
  });

  routes.delete("/:projectId/work-item-panes/:paneId", (c) => {
    const projectId = c.req.param("projectId");
    try {
      const closed = paneCommands.closeWorkItemPane(
        projectId,
        c.req.param("paneId"),
      );
      if (!closed) return c.json({ error: "Work item pane not found" }, 404);
      return c.json(paneSnapshot(deps.appStateStore, projectId));
    } catch (error) {
      return notFound(c, error);
    }
  });

  return routes;
}

function paneSnapshot(appStateStore: AppStateStore, projectId: string) {
  const projectState = appStateStore.get().projectStates[projectId];
  return {
    worktrees: projectState?.worktrees ?? [],
    focusedPaneId: projectState?.focusedPaneId ?? null,
  };
}

function notFound(c: Context, error: unknown) {
  if (
    error instanceof WorkspaceNotFoundError ||
    error instanceof WorkItemNotFoundError
  ) {
    return c.json({ error: error.message }, 404);
  }
  throw error;
}

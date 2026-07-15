import {
  normalizeCreateWorkItemInput,
  normalizeUpdateWorkItemInput,
} from "@parasor/shared";
import { type Context, Hono } from "hono";
import {
  WorkItemNotFoundError,
  WorkspaceNotFoundError,
} from "../application/workspace/errors.js";
import { createWorkItemCommands } from "../application/workspace/work-item-commands.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { EventBus } from "../ws/events.js";

interface WorkItemRoutesDeps {
  appStateStore: AppStateStore;
  eventBus: EventBus;
  projectManager: ProjectManager;
}

export function createWorkItemRoutes(deps: WorkItemRoutesDeps): Hono {
  const routes = new Hono();
  const commands = createWorkItemCommands(deps);

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

  return routes;
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

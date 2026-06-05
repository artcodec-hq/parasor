import { Hono } from "hono";
import { OpenUrlValidationError } from "../application/integrations/errors.js";
import { createOpenUrlCommand } from "../application/integrations/open-url.js";
import type { EventBus } from "../ws/events.js";

export function createOpenRoute(eventBus: EventBus): Hono {
  const routes = new Hono();
  const openUrlCommand = createOpenUrlCommand(eventBus);

  routes.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);

    try {
      return c.json(openUrlCommand.openUrl(body));
    } catch (error) {
      if (error instanceof OpenUrlValidationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  return routes;
}

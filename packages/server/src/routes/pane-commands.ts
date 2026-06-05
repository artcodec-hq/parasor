import { normalizePaneCommands, type PaneCommandConfig } from "@parasor/shared";
import { Hono } from "hono";
import type { AppStateStore } from "../state/app-state.js";
import type { EventBus } from "../ws/events.js";

export interface PaneCommandRouteDeps {
  appStateStore: AppStateStore;
  eventBus: EventBus;
}

export function createPaneCommandRoutes(deps: PaneCommandRouteDeps): Hono {
  const { appStateStore, eventBus } = deps;
  const routes = new Hono();

  routes.get("/", (c) => {
    return c.json({ commands: appStateStore.get().paneCommands });
  });

  routes.put("/", async (c) => {
    const body = await c.req.json<{ commands?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.commands)) {
      return c.json({ error: "commands must be an array" }, 400);
    }

    const commands: PaneCommandConfig[] = normalizePaneCommands(body.commands);
    appStateStore.mutatePaneCommands((state) => {
      state.paneCommands = commands;
    });
    eventBus.broadcast({ type: "pane-commands-changed", commands });
    return c.json({ commands });
  });

  return routes;
}

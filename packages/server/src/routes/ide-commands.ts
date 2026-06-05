import { type IdeCommandConfig, normalizeIdeCommands } from "@parasor/shared";
import { Hono } from "hono";
import type { AppStateStore } from "../state/app-state.js";
import type { EventBus } from "../ws/events.js";

export interface IdeCommandRouteDeps {
  appStateStore: AppStateStore;
  eventBus: EventBus;
}

export function createIdeCommandRoutes(deps: IdeCommandRouteDeps): Hono {
  const { appStateStore, eventBus } = deps;
  const routes = new Hono();

  routes.get("/", (c) => {
    return c.json({ commands: appStateStore.get().ideCommands });
  });

  routes.put("/", async (c) => {
    const body = await c.req.json<{ commands?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.commands)) {
      return c.json({ error: "commands must be an array" }, 400);
    }

    const commands: IdeCommandConfig[] = normalizeIdeCommands(body.commands);
    appStateStore.mutateIdeCommands((state) => {
      state.ideCommands = commands;
    });
    eventBus.broadcast({ type: "ide-commands-changed", commands });
    return c.json({ commands });
  });

  return routes;
}

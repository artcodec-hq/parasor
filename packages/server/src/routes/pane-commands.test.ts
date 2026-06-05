import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import { EventBus } from "../ws/events.js";
import { createPaneCommandRoutes } from "./pane-commands.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "parasor-pane-cmd-"));
}

describe("createPaneCommandRoutes", () => {
  let appStateStore: AppStateStore;
  let eventBus: EventBus;

  beforeEach(() => {
    appStateStore = new AppStateStore({ dir: tempDir(), debounceMs: 5 });
    eventBus = new EventBus();
  });

  afterEach(() => {
    appStateStore.destroy();
  });

  it("GET / returns persisted pane commands", async () => {
    appStateStore.mutatePaneCommands((state) => {
      state.paneCommands = [
        { id: "cmd:1", label: "Dev", initialInput: "pnpm dev" },
      ];
    });
    const app = createPaneCommandRoutes({ appStateStore, eventBus });

    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      commands: [{ id: "cmd:1", label: "Dev", initialInput: "pnpm dev" }],
    });
  });

  it("PUT / normalizes, persists, and broadcasts pane commands", async () => {
    const app = createPaneCommandRoutes({ appStateStore, eventBus });
    const broadcastSpy = vi.spyOn(eventBus, "broadcast");

    const res = await app.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { id: "cmd:1", label: " Dev ", initialInput: " pnpm dev " },
          { id: "builtin:terminal", label: "Nope", initialInput: "echo no" },
          { id: "cmd:1", label: "Duplicate", initialInput: "echo dupe" },
          { id: "cmd:2", label: "", initialInput: "echo no-label" },
        ],
      }),
    });

    const expected = [{ id: "cmd:1", label: "Dev", initialInput: "pnpm dev" }];
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commands: expected });
    expect(appStateStore.get().paneCommands).toEqual(expected);
    expect(broadcastSpy).toHaveBeenCalledWith({
      type: "pane-commands-changed",
      commands: expected,
    });
  });

  it("PUT / rejects malformed bodies", async () => {
    const app = createPaneCommandRoutes({ appStateStore, eventBus });
    const broadcastSpy = vi.spyOn(eventBus, "broadcast");

    const res = await app.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: "pnpm dev" }),
    });

    expect(res.status).toBe(400);
    expect(appStateStore.get().paneCommands).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});

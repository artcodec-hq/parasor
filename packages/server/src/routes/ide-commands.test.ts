import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import { EventBus } from "../ws/events.js";
import { createIdeCommandRoutes } from "./ide-commands.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "parasor-ide-cmd-"));
}

describe("createIdeCommandRoutes", () => {
  let appStateStore: AppStateStore;
  let eventBus: EventBus;

  beforeEach(() => {
    appStateStore = new AppStateStore({ dir: tempDir(), debounceMs: 5 });
    eventBus = new EventBus();
  });

  afterEach(() => {
    appStateStore.destroy();
  });

  it("GET / returns persisted IDE commands", async () => {
    appStateStore.mutateIdeCommands((state) => {
      state.ideCommands = [
        { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
      ];
    });
    const app = createIdeCommandRoutes({ appStateStore, eventBus });

    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      commands: [{ id: "zed", label: "Zed", command: "zed", args: ["{path}"] }],
    });
  });

  it("PUT / normalizes, persists, and broadcasts IDE commands", async () => {
    const app = createIdeCommandRoutes({ appStateStore, eventBus });
    const broadcastSpy = vi.spyOn(eventBus, "broadcast");

    const res = await app.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { id: "zed", label: " Zed ", command: " zed ", args: [" {path} "] },
          { id: "cursor", label: "Nope", command: "cursor", args: ["{path}"] },
          { id: "zed", label: "Duplicate", command: "zed", args: [] },
        ],
      }),
    });

    const expected = [
      { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
    ];
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commands: expected });
    expect(appStateStore.get().ideCommands).toEqual(expected);
    expect(broadcastSpy).toHaveBeenCalledWith({
      type: "ide-commands-changed",
      commands: expected,
    });
  });
});

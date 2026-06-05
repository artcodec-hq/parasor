import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
} from "@parasor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import { EventBus } from "../ws/events.js";
import { createServiceConfigRoutes } from "./service-config.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "parasor-svc-cfg-"));
}

describe("createServiceConfigRoutes", () => {
  let appStateStore: AppStateStore;
  let eventBus: EventBus;
  let onConfigChanged: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    appStateStore = new AppStateStore({ dir: tempDir(), debounceMs: 5 });
    eventBus = new EventBus();
    onConfigChanged = vi.fn();
  });

  afterEach(() => {
    appStateStore.destroy();
  });

  it("GET / returns current config and host platform", async () => {
    const app = createServiceConfigRoutes({
      appStateStore,
      eventBus,
      onConfigChanged,
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: { preventIdleSleep: boolean; portDetection: string };
      hostPlatform: string;
    };
    expect(body.config).toEqual({
      preventIdleSleep: false,
      portDetection: "all-interfaces",
      dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
      dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
    });
    expect(body.hostPlatform).toBe(process.platform);
  });

  it("PATCH / updates preventIdleSleep, preserves portDetection", async () => {
    const app = createServiceConfigRoutes({
      appStateStore,
      eventBus,
      onConfigChanged,
    });
    const broadcastSpy = vi.spyOn(eventBus, "broadcast");

    const res = await app.request("/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preventIdleSleep: true }),
    });

    expect(res.status).toBe(200);
    const expected = {
      preventIdleSleep: true,
      portDetection: "all-interfaces",
      dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
      dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
    };
    const body = (await res.json()) as {
      config: typeof expected;
    };
    expect(body.config).toEqual(expected);
    expect(appStateStore.get().serviceConfig).toEqual(expected);
    expect(onConfigChanged).toHaveBeenCalledWith(expected);
    expect(broadcastSpy).toHaveBeenCalledWith({
      type: "service-config-changed",
      config: expected,
    });
  });

  it("PATCH / updates portDetection alone", async () => {
    const app = createServiceConfigRoutes({
      appStateStore,
      eventBus,
      onConfigChanged,
    });
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portDetection: "off" }),
    });
    expect(res.status).toBe(200);
    expect(appStateStore.get().serviceConfig).toEqual({
      preventIdleSleep: false,
      portDetection: "off",
      dropSizeMaxBytes: DEFAULT_DROP_SIZE_MAX_BYTES,
      dropSizeHardMaxBytes: DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
    });
  });

  it("PATCH / rejects empty body with 400", async () => {
    const app = createServiceConfigRoutes({
      appStateStore,
      eventBus,
      onConfigChanged,
    });
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(onConfigChanged).not.toHaveBeenCalled();
  });

  it("PATCH / rejects invalid portDetection value", async () => {
    const app = createServiceConfigRoutes({
      appStateStore,
      eventBus,
      onConfigChanged,
    });
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portDetection: "bogus" }),
    });
    expect(res.status).toBe(400);
    expect(onConfigChanged).not.toHaveBeenCalled();
  });

  it("PATCH / tolerates malformed JSON body with 400", async () => {
    const app = createServiceConfigRoutes({
      appStateStore,
      eventBus,
      onConfigChanged,
    });
    const res = await app.request("/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    expect(onConfigChanged).not.toHaveBeenCalled();
  });
});

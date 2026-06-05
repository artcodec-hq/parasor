import {
  DEFAULT_DROP_SIZE_HARD_MAX_BYTES,
  DEFAULT_DROP_SIZE_MAX_BYTES,
  type PortDetectionMode,
  type ServiceConfig,
} from "@parasor/shared";
import { Hono } from "hono";
import type { AppStateStore } from "../state/app-state.js";
import type { EventBus } from "../ws/events.js";

export interface ServiceConfigRouteDeps {
  appStateStore: AppStateStore;
  eventBus: EventBus;
  onConfigChanged: (config: ServiceConfig) => void;
}

const PORT_DETECTION_MODES: PortDetectionMode[] = ["all-interfaces", "off"];

function isPortDetectionMode(value: unknown): value is PortDetectionMode {
  return (
    typeof value === "string" &&
    PORT_DETECTION_MODES.includes(value as PortDetectionMode)
  );
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function createServiceConfigRoutes(deps: ServiceConfigRouteDeps): Hono {
  const { appStateStore, eventBus, onConfigChanged } = deps;
  const routes = new Hono();

  routes.get("/", (c) => {
    return c.json({
      config: appStateStore.get().serviceConfig,
      hostPlatform: process.platform,
    });
  });

  routes.patch("/", async (c) => {
    const body = await c.req
      .json<{
        preventIdleSleep?: boolean;
        portDetection?: PortDetectionMode;
        dropSizeMaxBytes?: number;
      }>()
      .catch(
        () =>
          ({}) as {
            preventIdleSleep?: boolean;
            portDetection?: PortDetectionMode;
            dropSizeMaxBytes?: number;
          },
      );

    const hasPreventIdleSleep = body.preventIdleSleep !== undefined;
    const hasPortDetection = body.portDetection !== undefined;
    const hasDropSizeMax = body.dropSizeMaxBytes !== undefined;

    if (!hasPreventIdleSleep && !hasPortDetection && !hasDropSizeMax) {
      return c.json(
        {
          error:
            "preventIdleSleep, portDetection, or dropSizeMaxBytes is required",
        },
        400,
      );
    }
    if (hasPreventIdleSleep && typeof body.preventIdleSleep !== "boolean") {
      return c.json({ error: "preventIdleSleep must be a boolean" }, 400);
    }
    if (hasPortDetection && !isPortDetectionMode(body.portDetection)) {
      return c.json(
        { error: "portDetection must be 'all-interfaces' | 'off'" },
        400,
      );
    }
    if (hasDropSizeMax && !isPositiveFiniteNumber(body.dropSizeMaxBytes)) {
      return c.json(
        { error: "dropSizeMaxBytes must be a positive finite number" },
        400,
      );
    }

    const current = appStateStore.get().serviceConfig;
    const hardMax =
      current.dropSizeHardMaxBytes ?? DEFAULT_DROP_SIZE_HARD_MAX_BYTES;
    const next: ServiceConfig = {
      preventIdleSleep: hasPreventIdleSleep
        ? (body.preventIdleSleep as boolean)
        : current.preventIdleSleep,
      portDetection: hasPortDetection
        ? (body.portDetection as PortDetectionMode)
        : current.portDetection,
      dropSizeMaxBytes: hasDropSizeMax
        ? Math.min(body.dropSizeMaxBytes as number, hardMax)
        : (current.dropSizeMaxBytes ?? DEFAULT_DROP_SIZE_MAX_BYTES),
      dropSizeHardMaxBytes: hardMax,
    };
    appStateStore.mutateServiceConfig((state) => {
      state.serviceConfig = next;
    });
    onConfigChanged(next);
    eventBus.broadcast({ type: "service-config-changed", config: next });
    return c.json({ config: next });
  });

  return routes;
}

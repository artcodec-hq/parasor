import {
  isRuntimeMethodName,
  normalizeRuntimeCallRequest,
} from "@parasor/shared";
import { Hono } from "hono";
import {
  createRuntimeDispatcher,
  type RuntimeApiDeps,
  runtimeFailure,
} from "../runtime-api/dispatcher.js";

export function createRuntimeRoutes(deps: RuntimeApiDeps): Hono {
  const routes = new Hono();
  const dispatcher = createRuntimeDispatcher(deps);

  routes.post("/call", async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    if (!isPlainObject(body)) {
      return c.json(
        runtimeFailure(
          undefined,
          "invalid_arguments",
          "request must be JSON object",
        ),
        400,
      );
    }
    const id = typeof body.id === "string" ? body.id : undefined;
    if (typeof body.method !== "string") {
      return c.json(
        runtimeFailure(id, "invalid_arguments", "method is required"),
        400,
      );
    }
    if (!isRuntimeMethodName(body.method)) {
      return c.json(
        runtimeFailure(id, "unknown_method", `Unknown method: ${body.method}`),
      );
    }
    const request = normalizeRuntimeCallRequest(body);
    if (!request.ok) {
      return c.json(
        runtimeFailure(id, "invalid_arguments", request.message),
        400,
      );
    }
    return c.json(await dispatcher.call(request.value));
  });

  return routes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

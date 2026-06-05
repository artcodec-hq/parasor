import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { isLoopbackAddress } from "../application/integrations/hook-notify.js";

/*
 * Unauthenticated health probe for service managers and external
 * watchdogs. Returns 200 OK + pid/uptime to loopback clients only --
 * blocks remote hits so the endpoint cannot be used to confirm a
 * parasor instance exists on a given host from off-box.
 *
 * Mounted at /healthz (before the /api/* auth middleware) so neither
 * the session token nor the token-carrying cookie is required.
 */

interface CreateHealthzRouteOptions {
  /** Override for tests so they can avoid faking node-server conninfo. */
  remoteAddress?: () => string | null;
}

export function createHealthzRoute(opts: CreateHealthzRouteOptions = {}): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const resolve =
      opts.remoteAddress ??
      (() => {
        const info = getConnInfo(c);
        return info.remote?.address ?? null;
      });
    const remote = resolve();
    if (!isLoopbackAddress(remote)) {
      return c.json({ error: "loopback only" }, 403);
    }
    return c.json({
      status: "ok",
      pid: process.pid,
      uptime: Math.round(process.uptime()),
    });
  });

  return app;
}

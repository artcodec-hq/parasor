/*
 * daemon protocol mismatch recovery -- server-lifetime notices for the web banner. Authenticated under
 * /api/* like sessions/projects so a token cookie is required.
 *
 *   GET    /api/notices                  -> ServerNoticesResponse
 *   DELETE /api/notices/:kind            -> { dismissed: boolean }
 *
 * Notices are not persisted: the store lives only on the running server
 * instance, so a server restart clears the list and dismissal needs no
 * disk I/O.
 */

import type { ServerNoticeKind } from "@parasor/shared";
import { Hono } from "hono";
import type { ServerNoticesStore } from "../state/server-notices.js";

const KNOWN_KINDS: ReadonlySet<ServerNoticeKind> = new Set([
  "daemon-auto-restarted",
]);

export function createServerNoticesRoutes(store: ServerNoticesStore): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json({ notices: store.list() }));

  app.delete("/:kind", (c) => {
    const kind = c.req.param("kind");
    if (!KNOWN_KINDS.has(kind as ServerNoticeKind)) {
      return c.json({ error: "unknown notice kind" }, 400);
    }
    const dismissed = store.dismiss(kind as ServerNoticeKind);
    return c.json({ dismissed });
  });

  return app;
}

import type { EventPublisher } from "../ports.js";
import { OpenUrlValidationError } from "./errors.js";

interface OpenUrlRequest {
  url?: unknown;
}

export function createOpenUrlCommand(eventBus: EventPublisher) {
  return {
    openUrl(body: OpenUrlRequest | null) {
      if (!body?.url || typeof body.url !== "string") {
        throw new OpenUrlValidationError("url required");
      }

      try {
        new URL(body.url);
      } catch {
        throw new OpenUrlValidationError("invalid URL");
      }

      eventBus.broadcast({
        type: "browser-url-changed",
        paneId: "__route_open__",
        url: body.url,
      });

      return { ok: true as const };
    },
  };
}

import { describe, expect, it, vi } from "vitest";
import type { EventBus } from "../../ws/events.js";
import { OpenUrlValidationError } from "./errors.js";
import { createOpenUrlCommand } from "./open-url.js";

describe("createOpenUrlCommand", () => {
  it("broadcasts browser-url-changed for valid URLs", () => {
    const eventBus = { broadcast: vi.fn() } as unknown as EventBus;
    const command = createOpenUrlCommand(eventBus);

    expect(command.openUrl({ url: "http://localhost:3000" })).toEqual({
      ok: true,
    });
    expect(eventBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "browser-url-changed",
        url: "http://localhost:3000",
      }),
    );
  });

  it("rejects missing or malformed URLs", () => {
    const eventBus = { broadcast: vi.fn() } as unknown as EventBus;
    const command = createOpenUrlCommand(eventBus);

    expect(() => command.openUrl(null)).toThrow(OpenUrlValidationError);
    expect(() => command.openUrl({ url: "not a url" })).toThrow(
      OpenUrlValidationError,
    );
  });
});

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventBus } from "../ws/events.js";
import { createOpenRoute } from "./open.js";

function makeMocks() {
  const eventBus = { broadcast: vi.fn() } as unknown as EventBus;
  return { eventBus };
}

function createApp(mocks: ReturnType<typeof makeMocks>) {
  const app = new Hono();
  app.route("/api/open", createOpenRoute(mocks.eventBus));
  return app;
}

describe("open route", () => {
  let mocks: ReturnType<typeof makeMocks>;
  let app: Hono;

  beforeEach(() => {
    mocks = makeMocks();
    app = createApp(mocks);
  });

  it("broadcasts browser-url-changed for valid URL", async () => {
    const res = await app.request("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://localhost:3000" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mocks.eventBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "browser-url-changed",
        url: "http://localhost:3000",
      }),
    );
  });

  it("returns 400 without url", async () => {
    const res = await app.request("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("url required");
  });

  it("returns 400 for non-string url", async () => {
    const res = await app.request("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: 123 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed URL", async () => {
    const res = await app.request("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "not a url" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid URL");
  });

  it("handles malformed JSON body", async () => {
    const res = await app.request("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad json",
    });
    expect(res.status).toBe(400);
  });
});

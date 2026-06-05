import type { ServerNoticesResponse } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { ServerNoticesStore } from "../state/server-notices.js";
import { createServerNoticesRoutes } from "./server-notices.js";

describe("createServerNoticesRoutes", () => {
  it("GET / returns the empty notices array when nothing has been recorded", async () => {
    const store = new ServerNoticesStore();
    const app = createServerNoticesRoutes(store);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ServerNoticesResponse;
    expect(body.notices).toEqual([]);
  });

  it("GET / surfaces the recorded daemon-auto-restarted notice", async () => {
    const store = new ServerNoticesStore();
    store.recordDaemonAutoRestarted({
      serverProtocolVersion: "1.1.0",
      daemonProtocolVersion: "1.0.0",
    });
    const app = createServerNoticesRoutes(store);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ServerNoticesResponse;
    expect(body.notices).toHaveLength(1);
    expect(body.notices[0].kind).toBe("daemon-auto-restarted");
    expect(body.notices[0].serverProtocolVersion).toBe("1.1.0");
    expect(body.notices[0].daemonProtocolVersion).toBe("1.0.0");
  });

  it("DELETE /:kind dismisses a recorded notice and reports dismissed=true", async () => {
    const store = new ServerNoticesStore();
    store.recordDaemonAutoRestarted({});
    const app = createServerNoticesRoutes(store);
    const res = await app.request("/daemon-auto-restarted", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dismissed: boolean };
    expect(body.dismissed).toBe(true);
    expect(store.has("daemon-auto-restarted")).toBe(false);
  });

  it("DELETE /:kind on a missing notice still returns 200 with dismissed=false", async () => {
    const store = new ServerNoticesStore();
    const app = createServerNoticesRoutes(store);
    const res = await app.request("/daemon-auto-restarted", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dismissed: boolean };
    expect(body.dismissed).toBe(false);
  });

  it("DELETE /:kind rejects an unknown kind with 400", async () => {
    const store = new ServerNoticesStore();
    const app = createServerNoticesRoutes(store);
    const res = await app.request("/not-a-real-kind", { method: "DELETE" });
    expect(res.status).toBe(400);
  });
});

import { describe, expect, it } from "vitest";
import { createHealthzRoute } from "./healthz.js";

/*
 * /healthz is authentication-free but loopback-only. It exists so service
 * managers (launchd, systemd, or an external watchdog) can decide whether
 * parasor is alive without knowing the auth token. Non-loopback hits must
 * be refused so the endpoint cannot be used for unauth'd probing from the
 * network.
 */
describe("createHealthzRoute", () => {
  it("returns 200 with status/pid/uptime for loopback requests", async () => {
    const app = createHealthzRoute({ remoteAddress: () => "127.0.0.1" });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      pid: number;
      uptime: number;
    };
    expect(body.status).toBe("ok");
    expect(body.pid).toBe(process.pid);
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("accepts ::1 and ::ffff:127.* as loopback", async () => {
    for (const addr of ["::1", "::ffff:127.0.0.1"]) {
      const app = createHealthzRoute({ remoteAddress: () => addr });
      const res = await app.request("/");
      expect(res.status).toBe(200);
    }
  });

  it("returns 403 for non-loopback requests", async () => {
    const app = createHealthzRoute({ remoteAddress: () => "10.0.0.5" });
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("returns 403 when remote address is unknown", async () => {
    const app = createHealthzRoute({ remoteAddress: () => null });
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });
});

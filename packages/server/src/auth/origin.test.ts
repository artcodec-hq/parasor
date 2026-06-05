import type { NetworkInterfaceInfo } from "node:os";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  buildAllowedOrigins,
  normalizeOrigin,
  originMiddleware,
  parseAllowedOriginsEnv,
} from "./origin.js";

function ipv4(
  address: string,
  extra?: Partial<NetworkInterfaceInfo>,
): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: `${address}/24`,
    ...extra,
  } as NetworkInterfaceInfo;
}

function ipv6(
  address: string,
  extra?: Partial<NetworkInterfaceInfo>,
): NetworkInterfaceInfo {
  return {
    address,
    netmask: "ffff:ffff:ffff:ffff::",
    family: "IPv6",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: `${address}/64`,
    scopeid: 0,
    ...extra,
  } as NetworkInterfaceInfo;
}

describe("normalizeOrigin", () => {
  it("lowercases scheme and host, drops trailing slash", () => {
    expect(normalizeOrigin("HTTP://Example.COM:3000/")).toBe(
      "http://example.com:3000",
    );
  });

  it("keeps explicit port when non-default", () => {
    expect(normalizeOrigin("http://localhost:4010")).toBe(
      "http://localhost:4010",
    );
  });

  it("drops default port 80 for http", () => {
    expect(normalizeOrigin("http://example.com:80")).toBe("http://example.com");
  });

  it("drops default port 443 for https", () => {
    expect(normalizeOrigin("https://example.com:443")).toBe(
      "https://example.com",
    );
  });

  it("returns null on malformed origin", () => {
    expect(normalizeOrigin("not a url")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
  });
});

describe("parseAllowedOriginsEnv", () => {
  it("parses comma-separated list and normalizes each", () => {
    expect(
      parseAllowedOriginsEnv("http://foo.com , HTTPS://Bar.com:443/"),
    ).toEqual(["http://foo.com", "https://bar.com"]);
  });

  it("ignores empty entries and undefined input", () => {
    expect(parseAllowedOriginsEnv("")).toEqual([]);
    expect(parseAllowedOriginsEnv(undefined)).toEqual([]);
    expect(parseAllowedOriginsEnv(", ,")).toEqual([]);
  });

  it("skips malformed origins silently", () => {
    expect(parseAllowedOriginsEnv("http://ok.com, not a url")).toEqual([
      "http://ok.com",
    ]);
  });
});

describe("buildAllowedOrigins", () => {
  it("always includes loopback variants and bind host with port", () => {
    const set = buildAllowedOrigins({
      bindHost: "192.168.1.10",
      port: 7681,
      extra: [],
    });
    expect(set).toContain("http://127.0.0.1:7681");
    expect(set).toContain("http://localhost:7681");
    expect(set).toContain("http://[::1]:7681");
    expect(set).toContain("http://192.168.1.10:7681");
  });

  it("never seeds the wildcard host itself as an origin", () => {
    const set = buildAllowedOrigins({
      bindHost: "0.0.0.0",
      port: 7681,
      extra: [],
      ifaces: {},
    });
    expect(set).not.toContain("http://0.0.0.0:7681");
  });

  it("seeds non-internal IPv4 addresses when bind host is wildcard IPv4", () => {
    const set = buildAllowedOrigins({
      bindHost: "0.0.0.0",
      port: 7681,
      extra: [],
      ifaces: {
        lo0: [ipv4("127.0.0.1", { internal: true })],
        en0: [ipv4("192.168.1.10")],
        utun3: [ipv4("100.64.0.5")],
      },
    });
    expect(set).toContain("http://192.168.1.10:7681");
    expect(set).toContain("http://100.64.0.5:7681");
    // loopback is always seeded by its canonical name, not enumerated interface.
    expect(set).toContain("http://127.0.0.1:7681");
  });

  it("seeds IPv6 global addresses with brackets when bind host is wildcard IPv6", () => {
    const set = buildAllowedOrigins({
      bindHost: "::",
      port: 7681,
      extra: [],
      ifaces: {
        en0: [
          ipv4("192.168.1.10"),
          ipv6("2001:db8::1"),
          ipv6("fe80::1", { scopeid: 4 }),
        ],
      },
    });
    expect(set).toContain("http://[2001:db8::1]:7681");
    expect(set).toContain("http://192.168.1.10:7681");
  });

  it("skips IPv6 link-local (fe80::) addresses under wildcard bind", () => {
    const set = buildAllowedOrigins({
      bindHost: "::",
      port: 7681,
      extra: [],
      ifaces: {
        en0: [ipv6("fe80::abcd", { scopeid: 4 })],
      },
    });
    expect(set).not.toContain("http://[fe80::abcd]:7681");
  });

  it("does not enumerate interfaces for non-wildcard bind", () => {
    const set = buildAllowedOrigins({
      bindHost: "192.168.1.10",
      port: 7681,
      extra: [],
      ifaces: {
        en0: [ipv4("10.0.0.5")],
      },
    });
    expect(set).not.toContain("http://10.0.0.5:7681");
    expect(set).toContain("http://192.168.1.10:7681");
  });

  it("includes extras from env verbatim (after normalization)", () => {
    const set = buildAllowedOrigins({
      bindHost: "127.0.0.1",
      port: 7681,
      extra: ["https://my-host.tail.ts.net"],
    });
    expect(set).toContain("https://my-host.tail.ts.net");
  });
});

describe("originMiddleware", () => {
  function mkApp(allowed: string[]) {
    const app = new Hono();
    app.use("/ws/*", originMiddleware({ allowed: new Set(allowed) }));
    app.get("/ws/ok", (c) => c.text("ok"));
    return app;
  }

  it("allows requests without an Origin header (non-browser client)", async () => {
    const app = mkApp(["http://localhost:7681"]);
    const res = await app.request("/ws/ok");
    expect(res.status).toBe(200);
  });

  it("allows requests with a permitted Origin", async () => {
    const app = mkApp(["http://localhost:7681"]);
    const res = await app.request("/ws/ok", {
      headers: { Origin: "http://localhost:7681" },
    });
    expect(res.status).toBe(200);
  });

  it("normalizes incoming Origin before comparison", async () => {
    const app = mkApp(["http://localhost:7681"]);
    const res = await app.request("/ws/ok", {
      headers: { Origin: "HTTP://LocalHost:7681/" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects requests from disallowed Origins with 403", async () => {
    const app = mkApp(["http://localhost:7681"]);
    const res = await app.request("/ws/ok", {
      headers: { Origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects malformed Origin headers with 403", async () => {
    const app = mkApp(["http://localhost:7681"]);
    const res = await app.request("/ws/ok", {
      headers: { Origin: "not a url" },
    });
    expect(res.status).toBe(403);
  });
});

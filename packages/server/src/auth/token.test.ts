import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenAuth } from "./token.js";

describe("TokenAuth", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `parasor-token-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates a new token when none exists", () => {
    const auth = new TokenAuth({ dir });
    expect(auth.token).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(dir, "token"))).toBe(true);
  });

  it("loads existing token from file", () => {
    const auth1 = new TokenAuth({ dir });
    const token = auth1.token;
    const auth2 = new TokenAuth({ dir });
    expect(auth2.token).toBe(token);
  });

  it("regenerates token in ephemeral mode", () => {
    const auth1 = new TokenAuth({ dir });
    const token1 = auth1.token;
    const auth2 = new TokenAuth({ dir, ephemeral: true });
    expect(auth2.token).not.toBe(token1);
  });

  it("verify returns true for valid token", () => {
    const auth = new TokenAuth({ dir });
    expect(auth.verify(auth.token)).toBe(true);
    expect(auth.verify("wrong")).toBe(false);
  });

  describe("extractToken", () => {
    it("extracts from query param", () => {
      const auth = new TokenAuth({ dir });
      expect(auth.extractToken("?t=abc123", undefined)).toBe("abc123");
    });

    it("extracts from cookie header", () => {
      const auth = new TokenAuth({ dir });
      expect(auth.extractToken("", "parasor_token=abc123; other=x")).toBe(
        "abc123",
      );
    });

    it("returns null when no token present", () => {
      const auth = new TokenAuth({ dir });
      expect(auth.extractToken("", undefined)).toBeNull();
    });
  });

  describe("middleware", () => {
    function buildApp(auth: TokenAuth) {
      const app = new Hono();
      app.use("*", auth.middleware("token"));
      app.get("*", (c) => c.json({ ok: true }));
      return app;
    }

    it("does not redirect when other params contain `t=` substring", async () => {
      const auth = new TokenAuth({ dir });
      const app = buildApp(auth);
      // `limit=50` and `worktreePath=...` both contain "t=" as a literal
      // substring -- the middleware must NOT treat that as a `?t=<token>`
      // handshake or it sends an infinite-redirect response.
      const res = await app.request(
        "http://localhost/api/projects/x/git/log?worktreePath=/repo&limit=50",
        {
          headers: { cookie: `parasor_token=${auth.token}` },
        },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("redirects + sets cookie when `?t=<token>` is the actual param", async () => {
      const auth = new TokenAuth({ dir });
      const app = buildApp(auth);
      const res = await app.request(
        `http://localhost/api/projects/x/git/log?t=${auth.token}&limit=50`,
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        "/api/projects/x/git/log?limit=50",
      );
      expect(res.headers.get("set-cookie")).toMatch(/parasor_token=/);
    });

    it("returns 401 when no token present", async () => {
      const auth = new TokenAuth({ dir });
      const app = buildApp(auth);
      const res = await app.request("http://localhost/api/anything");
      expect(res.status).toBe(401);
    });
  });

  describe("middleware allowlist mode", () => {
    function buildAllowlistApp(
      auth: TokenAuth,
      cidrs: string[],
      trustProxy = false,
    ) {
      const app = new Hono();
      app.use("*", auth.middleware("allowlist", cidrs, trustProxy));
      app.get("*", (c) => c.json({ ok: true }));
      return app;
    }

    it("ignores a spoofed x-forwarded-for by default and uses the socket address", async () => {
      const auth = new TokenAuth({ dir });
      const app = buildAllowlistApp(auth, ["192.168.1.0/24"]);
      // Attacker forges an allowed XFF, but the real socket is outside the CIDR.
      const res = await app.request(
        "http://localhost/api/anything",
        { headers: { "x-forwarded-for": "192.168.1.5" } },
        { remoteAddress: "10.0.0.9" },
      );
      expect(res.status).toBe(403);
    });

    it("allows the real socket address when it is in the CIDR", async () => {
      const auth = new TokenAuth({ dir });
      const app = buildAllowlistApp(auth, ["192.168.1.0/24"]);
      const res = await app.request(
        "http://localhost/api/anything",
        {},
        { remoteAddress: "192.168.1.5" },
      );
      expect(res.status).toBe(200);
    });

    it("trusts x-forwarded-for only when trustProxy is set", async () => {
      const auth = new TokenAuth({ dir });
      const app = buildAllowlistApp(auth, ["192.168.1.0/24"], true);
      const res = await app.request(
        "http://localhost/api/anything",
        { headers: { "x-forwarded-for": "192.168.1.5" } },
        { remoteAddress: "10.0.0.9" },
      );
      expect(res.status).toBe(200);
    });

    it("denies when no client address is available", async () => {
      const auth = new TokenAuth({ dir });
      const app = buildAllowlistApp(auth, ["192.168.1.0/24"]);
      const res = await app.request("http://localhost/api/anything");
      expect(res.status).toBe(403);
    });
  });
});

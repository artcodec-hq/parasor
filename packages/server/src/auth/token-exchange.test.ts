import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PairingTokenStore } from "./pairing-token.js";
import { TokenAuth } from "./token.js";
import { createTokenExchangeMiddleware } from "./token-exchange.js";

describe("createTokenExchangeMiddleware", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `parasor-token-exchange-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  function buildApp({ now = () => 1000 }: { now?: () => number } = {}) {
    const tokenAuth = new TokenAuth({ dir });
    const pairingTokens = new PairingTokenStore({
      now,
      defaultTtlMs: 100,
    });
    const app = new Hono();
    app.use(
      "*",
      createTokenExchangeMiddleware({
        mode: "token",
        tokenAuth,
        pairingTokens,
      }),
    );
    app.get("*", (c) => c.json({ ok: true }));
    return { app, pairingTokens, tokenAuth };
  }

  it("exchanges a long-lived token and removes only the t query parameter", async () => {
    const { app, tokenAuth } = buildApp();

    const res = await app.request(
      `http://localhost/sessions/abc?t=${tokenAuth.token}&pane=1`,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/sessions/abc?pane=1");
    expect(res.headers.get("set-cookie")).toContain(
      `parasor_token=${tokenAuth.token}`,
    );
  });

  it("exchanges a short-lived pairing token on the existing t query path", async () => {
    const { app, pairingTokens, tokenAuth } = buildApp();
    const issued = pairingTokens.issue();

    const res = await app.request(
      `https://localhost/?t=${issued.token}&source=qr`,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?source=qr");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`parasor_token=${tokenAuth.token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
  });

  it("rejects a second pairing-token use without setting a cookie", async () => {
    const { app, pairingTokens } = buildApp();
    const issued = pairingTokens.issue();

    expect(
      await app.request(`http://localhost/?t=${issued.token}`),
    ).toHaveProperty("status", 302);

    const res = await app.request(`http://localhost/?t=${issued.token}`);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Pairing token rejected",
      reason: "used",
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects expired pairing tokens", async () => {
    let now = 1000;
    const { app, pairingTokens } = buildApp({ now: () => now });
    const issued = pairingTokens.issue();

    now = 1100;

    const res = await app.request(`http://localhost/?t=${issued.token}`);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Pairing token rejected",
      reason: "expired",
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an unknown t query token without setting a cookie", async () => {
    const { app } = buildApp();

    const res = await app.request("http://localhost/?t=not-a-known-token");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not treat other params containing t= as token exchange", async () => {
    const { app } = buildApp();

    const res = await app.request(
      "http://localhost/api/projects/x/git/log?worktreePath=/repo&limit=50",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

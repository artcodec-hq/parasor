import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { setCookie } from "hono/cookie";

export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function setParasorAuthCookie(
  c: Context,
  token: string,
  url: URL,
): void {
  setCookie(c, "parasor_token", token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    secure: url.protocol === "https:",
  });
}

export interface TokenAuthOpts {
  dir: string;
  ephemeral?: boolean;
}

export class TokenAuth {
  readonly token: string;
  private readonly tokenPath: string;

  constructor(opts: TokenAuthOpts) {
    this.tokenPath = join(opts.dir, "token");
    this.token = opts.ephemeral ? this.generate(false) : this.loadOrGenerate();
  }

  verify(candidate: string): boolean {
    const a = Buffer.from(candidate, "utf-8");
    const b = Buffer.from(this.token, "utf-8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  extractToken(
    search: string,
    cookieHeader: string | undefined,
  ): string | null {
    const query = search.startsWith("?") ? search : `?${search}`;
    const url = new URL(`http://localhost${query}`);
    const queryToken = url.searchParams.get("t");
    if (queryToken) return queryToken;

    if (cookieHeader) {
      const match = cookieHeader.match(/parasor_token=([^;]+)/);
      if (match) return match[1];
    }

    return null;
  }

  middleware(
    mode: "token" | "allowlist" | "none",
    allowedCidrs?: string[],
    trustProxy = false,
  ): MiddlewareHandler {
    return async (c, next) => {
      if (mode === "none") return next();
      if (c.req.path === "/api/health") return next();

      if (mode === "allowlist") {
        const remoteAddress = (c.env as { remoteAddress?: string } | undefined)
          ?.remoteAddress;
        // `x-forwarded-for` is set by the client and is trivially spoofable;
        // honoring it on a direct connection lets anyone forge an allowed IP
        // and bypass the CIDR allowlist. Only trust it when explicitly behind
        // a known reverse proxy; otherwise use the real socket address, and
        // deny when no address is available (never fall back to a wildcard).
        const clientIp = trustProxy
          ? (c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
            remoteAddress)
          : remoteAddress;
        if (
          clientIp &&
          allowedCidrs?.some((cidr) => isInCidr(clientIp, cidr))
        ) {
          return next();
        }
        return c.json({ error: "Forbidden" }, 403);
      }

      const reqUrl = new URL(c.req.url);
      const cookieHeader = c.req.header("cookie");
      const candidate = this.extractToken(reqUrl.search, cookieHeader);

      if (candidate && this.verify(candidate)) {
        // Only swap to cookie + redirect when `t` is an actual query
        // parameter, not when "t=" merely appears as a substring in any
        // other parameter name (e.g. `limit=`, `worktreePath=`,
        // `set=`). The previous `search.includes("t=")` produced an
        // infinite ERR_TOO_MANY_REDIRECTS loop on /api/projects/:id/git/log
        // because the `?worktreePath=...&limit=50` query string contains
        // `t=` inside `limit=`, but `searchParams.delete("t")` had nothing
        // to remove, so the redirect target equaled the source URL.
        if (reqUrl.searchParams.has("t")) {
          setParasorAuthCookie(c, this.token, reqUrl);
          reqUrl.searchParams.delete("t");
          return c.redirect(reqUrl.pathname + (reqUrl.search || ""));
        }
        return next();
      }

      return c.json({ error: "Unauthorized" }, 401);
    };
  }

  private loadOrGenerate(): string {
    try {
      const existing = readFileSync(this.tokenPath, "utf-8").trim();
      if (existing.length >= 32) return existing;
    } catch {
      // File doesn't exist or can't be read
    }
    return this.generate();
  }

  private generate(persist = true): string {
    const token = randomBytes(32).toString("hex");
    if (persist) {
      writeFileSync(this.tokenPath, token, { mode: 0o600 });
      chmodSync(this.tokenPath, 0o600);
    }
    return token;
  }
}

function isInCidr(ip: string, cidr: string): boolean {
  const [cidrIp, bits] = cidr.includes("/") ? cidr.split("/") : [cidr, "32"];
  const mask = ~(2 ** (32 - Number(bits)) - 1) >>> 0;
  const ipNum =
    ip.split(".").reduce((acc, oct) => (acc << 8) | Number(oct), 0) >>> 0;
  const cidrNum =
    cidrIp.split(".").reduce((acc, oct) => (acc << 8) | Number(oct), 0) >>> 0;
  return (ipNum & mask) === (cidrNum & mask);
}

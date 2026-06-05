import type { MiddlewareHandler } from "hono";
import type { PairingTokenStore } from "./pairing-token.js";
import { setParasorAuthCookie, type TokenAuth } from "./token.js";

export type TokenExchangeAuthMode = "token" | "allowlist" | "none";

export interface TokenExchangeOptions {
  mode: TokenExchangeAuthMode;
  tokenAuth: TokenAuth;
  pairingTokens?: PairingTokenStore;
}

export function createTokenExchangeMiddleware({
  mode,
  tokenAuth,
  pairingTokens,
}: TokenExchangeOptions): MiddlewareHandler {
  return async (c, next) => {
    if (mode !== "token") return next();
    const url = new URL(c.req.url);
    const token = url.searchParams.get("t");
    if (!token) return next();

    if (tokenAuth.verify(token)) {
      setParasorAuthCookie(c, tokenAuth.token, url);
      url.searchParams.delete("t");
      return c.redirect(url.pathname + (url.search || ""));
    }

    const pairingResult = pairingTokens?.consume(token);
    if (pairingResult?.ok) {
      setParasorAuthCookie(c, tokenAuth.token, url);
      url.searchParams.delete("t");
      return c.redirect(url.pathname + (url.search || ""));
    }

    if (pairingResult && pairingResult.reason !== "missing") {
      return c.json(
        { error: "Pairing token rejected", reason: pairingResult.reason },
        401,
      );
    }

    return c.json({ error: "Unauthorized" }, 401);
  };
}

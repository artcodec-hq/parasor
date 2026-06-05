/*
 * Cookie-based auth (packages/server/src/auth/token.ts) keeps API and
 * WebSocket requests authorized after the initial `?t=<token>` handshake.
 * When the cookie is absent or expired the server returns 401 for `/api/*`
 * and refuses WS upgrades, but the static SPA shell is still served -- which
 * otherwise produces a silent failure. We surface that to the UI by firing
 * a DOM event that AuthGate listens for; AuthGate unmounts the authenticated
 * tree, so no effects stay alive to retry against an unauthenticated server.
 */

export const AUTH_EXPIRED_EVENT = "parasor:auth-expired";

export class AuthExpiredError extends Error {
  constructor() {
    super("parasor session expired");
    this.name = "AuthExpiredError";
  }
}

let expiredDispatched = false;
let lastSuccessfulPreflightAt = 0;

export const AUTH_PREFLIGHT_SUCCESS_CACHE_MS = 30_000;

function dispatchAuthExpired(): void {
  lastSuccessfulPreflightAt = 0;
  if (expiredDispatched) return;
  expiredDispatched = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    lastSuccessfulPreflightAt = 0;
    dispatchAuthExpired();
    throw new AuthExpiredError();
  }
  return res;
}

/*
 * Preflight before opening a WebSocket. Browsers cannot read the 401 body
 * from a failed WS upgrade, so a blocked WS reconnect loop would otherwise
 * hide the auth failure. Hitting an auth-gated endpoint first lets us
 * raise the expired signal before we ever touch the socket.
 *
 * Returns true when the user still has a valid session, false when the
 * expired event has been dispatched. On network errors returns true so the
 * caller can attempt the WS and surface the real failure there.
 *
 * `dispatchOn401` defaults to true so WS preflight callers continue to
 * flip the AuthGate to "expired". The initial AuthGate mount passes
 * `false` because a 401 there means "the user has not authenticated yet"
 * (e.g. a truncated `?t=<token>` URL pasted from a wrapped terminal
 * line) -- that is a different UI state from "your session expired".
 */
export async function ensureAuthenticated(
  options: { dispatchOn401?: boolean; reuseRecentSuccess?: boolean } = {},
): Promise<boolean> {
  const dispatchOn401 = options.dispatchOn401 ?? true;
  if (
    options.reuseRecentSuccess &&
    lastSuccessfulPreflightAt > 0 &&
    Date.now() - lastSuccessfulPreflightAt < AUTH_PREFLIGHT_SUCCESS_CACHE_MS
  ) {
    return true;
  }

  let res: Response;
  try {
    res = await fetch("/api/auth/verify", {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return true;
  }
  if (res.status === 401) {
    lastSuccessfulPreflightAt = 0;
    if (dispatchOn401) dispatchAuthExpired();
    return false;
  }
  /*
   * 5xx typically means the backend is temporarily unreachable (e.g. a
   * dev proxy returning 502 during a server restart). Treat those like a
   * network error so callers proceed to open the socket and let the
   * WebSocket close/backoff path drive recovery -- otherwise a single
   * proxy blip during a restart can permanently park the reconnect loop.
   */
  if (res.status >= 500) return true;
  if (res.ok) {
    lastSuccessfulPreflightAt = Date.now();
  }
  return res.ok;
}

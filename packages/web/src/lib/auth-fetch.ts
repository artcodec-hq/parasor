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

export type AuthPreflightTracePhase = "start" | "complete" | "error";

export type AuthPreflightTraceEvent = {
  phase: AuthPreflightTracePhase;
  traceId: string;
  source?: string;
  httpStatus?: number;
  ok?: boolean;
  errorName?: string;
  errorMessage?: string;
  startedAtWallMs?: number;
  endedAtWallMs?: number;
  durationMs?: number;
  wallMs?: number;
  visibilityState?: string;
  hidden?: boolean;
  online?: boolean;
  visibilityChanges?: number;
  pageHideCount?: number;
  pageShowCount?: number;
  focusCount?: number;
  onlineCount?: number;
  offlineCount?: number;
};

type AuthPreflightTrace = (event: AuthPreflightTraceEvent) => void;

function emitAuthTrace(
  trace: AuthPreflightTrace | undefined,
  event: AuthPreflightTraceEvent,
): void {
  try {
    trace?.(event);
  } catch {
    // Diagnostics must never change auth or reconnect behavior.
  }
}

function createAuthTraceId(): string {
  return `auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function noPreflightLifecycle() {
  return {
    snapshot: () => ({}),
    cleanup: () => {},
  };
}

function browserState(): Pick<
  AuthPreflightTraceEvent,
  "visibilityState" | "hidden" | "online"
> {
  if (typeof window === "undefined") return {};
  return {
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    online: navigator.onLine,
  };
}

function listenDuringPreflight() {
  if (typeof window === "undefined") {
    return noPreflightLifecycle();
  }
  const state = {
    visibilityChanges: 0,
    pageHideCount: 0,
    pageShowCount: 0,
    focusCount: 0,
    onlineCount: 0,
    offlineCount: 0,
  };
  const onVisibility = () => {
    state.visibilityChanges += 1;
  };
  const onPageHide = () => {
    state.pageHideCount += 1;
  };
  const onPageShow = () => {
    state.pageShowCount += 1;
  };
  const onFocus = () => {
    state.focusCount += 1;
  };
  const onOnline = () => {
    state.onlineCount += 1;
  };
  const onOffline = () => {
    state.offlineCount += 1;
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return {
    snapshot: () => ({ ...state }),
    cleanup: () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    },
  };
}

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
  options: {
    dispatchOn401?: boolean;
    reuseRecentSuccess?: boolean;
    trace?: AuthPreflightTrace;
    source?: string;
  } = {},
): Promise<boolean> {
  const dispatchOn401 = options.dispatchOn401 ?? true;
  const trace = options.trace;
  if (
    options.reuseRecentSuccess &&
    lastSuccessfulPreflightAt > 0 &&
    Date.now() - lastSuccessfulPreflightAt < AUTH_PREFLIGHT_SUCCESS_CACHE_MS
  ) {
    return true;
  }

  const traceId = trace ? createAuthTraceId() : undefined;
  const startedAt = performance.now();
  const startedAtWall = Date.now();
  const lifecycle = trace ? listenDuringPreflight() : noPreflightLifecycle();
  if (traceId) {
    emitAuthTrace(trace, {
      phase: "start",
      traceId,
      source: options.source,
      startedAtWallMs: startedAtWall,
      ...browserState(),
    });
  }

  let res: Response;
  try {
    res = await fetch("/api/auth/verify", {
      cache: "no-store",
      credentials: "same-origin",
      ...(traceId ? { headers: { "x-parasor-auth-trace-id": traceId } } : {}),
    });
  } catch (error) {
    if (traceId) {
      const endedAtWall = Date.now();
      emitAuthTrace(trace, {
        phase: "error",
        traceId,
        source: options.source,
        startedAtWallMs: startedAtWall,
        endedAtWallMs: endedAtWall,
        durationMs: performance.now() - startedAt,
        wallMs: endedAtWall - startedAtWall,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        ...browserState(),
        ...lifecycle.snapshot(),
      });
    }
    lifecycle.cleanup();
    return true;
  }
  if (traceId) {
    const endedAtWall = Date.now();
    emitAuthTrace(trace, {
      phase: "complete",
      traceId,
      source: options.source,
      httpStatus: res.status,
      ok: res.ok,
      startedAtWallMs: startedAtWall,
      endedAtWallMs: endedAtWall,
      durationMs: performance.now() - startedAt,
      wallMs: endedAtWall - startedAtWall,
      ...browserState(),
      ...lifecycle.snapshot(),
    });
  }
  lifecycle.cleanup();
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

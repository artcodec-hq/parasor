import { type ReactNode, useEffect, useState } from "react";
import {
  AUTH_EXPIRED_EVENT,
  ensureAuthenticated,
} from "../../lib/auth-fetch.js";
import {
  scheduleClientStartupDiagnosticCapture,
  traceTerminalEvent,
} from "../../lib/terminal-trace.js";

/*
 * AuthGate is the single source of truth for "is this browser currently
 * authorized to talk to the parasor server". Children (the real App tree)
 * only mount in the `authed` state, which means:
 *   - No WS connect attempts, no data fetches, no effects run until we know
 *     the cookie is valid -- so an expired cookie cannot produce a silent
 *     failure or a redirect loop.
 *   - A 401 from any authFetch anywhere dispatches `parasor:auth-expired`,
 *     flipping this gate to `expired`. Unmounting the children tears down
 *     every WS reconnector and cache subscription in one step.
 *
 * Two distinct "not-authed" states surface different copy:
 *   - `unauthenticated` -- the initial preflight returned 401, i.e. the
 *     browser arrived here without a valid cookie. Most common cause is
 *     a truncated `?t=<token>` URL copied across a wrapped terminal
 *     line. The screen tells the user that and points them at the QR.
 *   - `expired` -- auth used to work in this tab, then a request came
 *     back 401. Prior session ended; user needs a fresh URL.
 */

type GateState = "loading" | "authed" | "unauthenticated" | "expired";

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const startedAt = performance.now();
      const ok = await ensureAuthenticated({ dispatchOn401: false });
      const durationMs = performance.now() - startedAt;
      traceTerminalEvent("auth-gate-preflight-complete", {
        durationMs,
        status: ok ? "ok" : "unauthenticated",
      });
      if (ok && durationMs >= 1000) {
        scheduleClientStartupDiagnosticCapture("auth-gate-preflight-slow", {
          type: "auth-gate-preflight-complete",
          durationMs,
          status: "ok",
        });
      }
      if (cancelled) return;
      setState(ok ? "authed" : "unauthenticated");
    })();
    const handleExpired = () => setState("expired");
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    };
  }, []);

  if (state === "loading") return null;
  if (state === "unauthenticated") return <AuthRequiredScreen />;
  if (state === "expired") return <SessionExpiredScreen />;
  return <>{children}</>;
}

function AuthRequiredScreen() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex h-full flex-col items-center justify-center gap-4 bg-[--theme-background] p-6 text-center text-[--theme-foreground]"
    >
      <h1 className="text-base font-semibold">Authentication required</h1>
      <p className="max-w-md text-sm opacity-80">
        Open the URL printed by{" "}
        <code className="rounded-control bg-black/20 px-1 py-0.5">
          parasor qr
        </code>
        , or scan the QR code on the host. If you copied the URL from a terminal
        that wrapped the line, the token may have been truncated -- scanning the
        QR avoids that.
      </p>
    </div>
  );
}

function SessionExpiredScreen() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex h-full flex-col items-center justify-center gap-4 bg-[--theme-background] p-6 text-center text-[--theme-foreground]"
    >
      <h1 className="text-base font-semibold">Session expired</h1>
      <p className="max-w-md text-sm opacity-80">
        Run{" "}
        <code className="rounded-control bg-black/20 px-1 py-0.5">
          parasor qr
        </code>{" "}
        on the host and open the refreshed URL to sign back in.
      </p>
    </div>
  );
}

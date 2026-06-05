/*
 * Tiny HTTP client used by all CLI subcommands that need to push an
 * agent-state event to the running parasor server's /hook/notify
 * endpoint. Centralized here so notify, hook (per-agent bridges), and
 * any future commands share the same env resolution, timeout, and error
 * shape.
 *
 * Loopback only -- the server's route handler enforces this independently
 * (see routes/hook.ts), but it's also the only address we ever target
 * here. Reads PARASOR_PORT from the env (set automatically when the
 * parasor server spawned the parent PTY).
 */

interface PostHookNotifyArgs {
  sessionId: string;
  agent: string;
  event: string;
}

interface PostResult {
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 3000;

export async function postHookNotify(
  args: PostHookNotifyArgs,
): Promise<PostResult> {
  const port = process.env.PARASOR_PORT;
  if (!port) {
    return {
      ok: false,
      error:
        "PARASOR_PORT not set. The parasor server is not running, or you are not inside one of its PTYs.",
    };
  }
  // Defensive validation: a hostile or buggy env value like
  // "@attacker.com:1234" or "8080#fragment" would otherwise be embedded
  // into the URL string below and produce a request that escapes the
  // 127.0.0.1 host (URL parser interprets `@` as userinfo separator,
  // shifting the host). Refuse anything that isn't a plain decimal port.
  if (!/^\d{1,5}$/.test(port) || Number(port) === 0 || Number(port) > 65535) {
    return {
      ok: false,
      error: `PARASOR_PORT is not a valid port number: ${port}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`http://127.0.0.1:${port}/hook/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: args.sessionId,
        agent: args.agent,
        event: args.event,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const serverError = await safeReadServerError(res);
      return {
        ok: false,
        error: `server returned ${res.status}${serverError ? `: ${serverError}` : ""}`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `timed out after ${TIMEOUT_MS}ms` };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `network error: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function safeReadServerError(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
    return null;
  } catch {
    return null;
  }
}

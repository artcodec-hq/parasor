const LOOPBACK_HOSTS = new Set(["localhost", "::1"]);

function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  const parts = host.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    parts[0] === 127
  );
}

/**
 * Resolve the address a per-port TCP forwarder should bind on, given the
 * address parasor's own HTTP server is bound to:
 * - loopback (`127.0.0.0/8` / `::1` / `localhost`) ⇒ `null` -- the viewer is on
 *   this machine, `localhost:<port>` already works, so no forwarder.
 * - anything else (a specific address, or `0.0.0.0` / `::`) ⇒ that host
 *   verbatim. The forwarder listens on an OS-assigned free port so binding
 *   `0.0.0.0` does not collide with the dev server's own `127.0.0.1:<port>`.
 *   Exposure is ≤ parasor's own, which the viewer already reached it through.
 */
export function resolveForwarderBindHost(
  parasorBindHost: string,
): string | null {
  if (isLoopbackHost(parasorBindHost)) return null;
  return parasorBindHost;
}

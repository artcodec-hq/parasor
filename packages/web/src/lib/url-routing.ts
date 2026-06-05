// `new URL("http://[::1]:5173").hostname` is the bracketed literal `[::1]`.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// Wildcard / unspecified bind addresses a dev server may print: it is then
// listening on *every* interface, so it is reachable on the page host at the
// same port -- no forwarder, just a host swap. (`URL` bracket-wraps `::`.)
const UNSPECIFIED_HOSTS = new Set(["0.0.0.0", "[::]"]);
const DEFAULT_EMBEDDED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  "0.0.0.0",
  "[::]",
];

/** A `URL.hostname` that resolves to this machine's loopback interface. */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** A `URL.hostname` that is a wildcard bind address (`0.0.0.0` / `[::]`). */
export function isUnspecifiedHostname(hostname: string): boolean {
  return UNSPECIFIED_HOSTS.has(hostname.toLowerCase());
}

/** A TCP port number is valid iff it is an integer in `1..65535`. */
function isValidPort(value: number | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value < 65536
  );
}

export function shouldOpenInEmbeddedBrowser(
  url: string,
  allowlist?: string[],
): boolean {
  try {
    const parsed = new URL(url);
    const hosts = allowlist ?? DEFAULT_EMBEDDED_HOSTS;
    return hosts.some((h) => parsed.hostname === h);
  } catch {
    return false;
  }
}

/**
 * Resolve a `localhost`/`127.0.0.1`/`[::1]`/`0.0.0.0`/`[::]` URL to something
 * the viewer device can actually reach:
 * - hostname is none of those ⇒ returned unchanged (no substitution).
 * - `window` undefined or `window.location.hostname` is itself loopback ⇒
 *   returned unchanged (the viewer *is* this machine -- `localhost`/`0.0.0.0`
 *   already work; nothing better to point at).
 * - hostname is a wildcard (`0.0.0.0` / `[::]`) ⇒ the dev server binds every
 *   interface, so just swap host -> `window.location.hostname`; the port is
 *   kept (it is already reachable there, no forwarder).
 * - hostname is loopback and `opts.reachablePort` is missing/malformed ⇒
 *   returned unchanged. There is nothing on the parasor host to point at --
 *   the dev server is loopback-only (else no forwarder would be needed), so
 *   rewriting the host but not the port would just be a connection-refused on
 *   `<host>:<devPort>`. The `localhost` URL still works when the viewer *is*
 *   this machine, so leave it.
 *   Mobile callers may opt into a host-only fallback via
 *   `fallbackToPageHostWithoutReachablePort`: `localhost` on the phone is
 *   always wrong, while `<page-host>:<devPort>` can work for all-interface
 *   dev servers even if port detection missed the reachable mapping.
 * - hostname is loopback with a valid `opts.reachablePort` ⇒ host ->
 *   `window.location.hostname`, port -> `opts.reachablePort` (the per-port TCP
 *   forwarder's OS-assigned listen port). Path, query and hash are preserved
 *   (the parsed `URL` is reused).
 *
 * Used when handing a terminal `localhost:<port>` link / port-detected toast
 * URL off to the device's own browser: the viewer's phone can't reach the
 * PC's loopback, so it is pointed at the parasor host + the forwarder's listen
 * port instead.
 */
export function resolveReachableBrowserUrl(
  url: string,
  opts: {
    fallbackToPageHostWithoutReachablePort?: boolean;
    reachablePort?: number;
  },
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const isLoopback = isLoopbackHostname(parsed.hostname);
  if (!isLoopback && !isUnspecifiedHostname(parsed.hostname)) return url;
  if (typeof window === "undefined") return url;
  const host = window.location.hostname;
  if (!host || isLoopbackHostname(host)) return url;
  if (!isLoopback) {
    // Wildcard bind -> reachable on the page host at the same port.
    parsed.hostname = host;
    return parsed.toString();
  }
  if (!isValidPort(opts.reachablePort)) {
    if (!opts.fallbackToPageHostWithoutReachablePort) return url;
    parsed.hostname = host;
    return parsed.toString();
  }
  parsed.hostname = host;
  parsed.port = String(opts.reachablePort);
  return parsed.toString();
}

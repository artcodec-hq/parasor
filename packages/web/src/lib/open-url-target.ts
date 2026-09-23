import type { OpenUrlOptions } from "./open-url-options.js";
import {
  isLoopbackHostname,
  resolveReachableBrowserUrl,
} from "./url-routing.js";

export type OpenUrlTarget =
  | { kind: "open"; url: string }
  | { kind: "unreachable-loopback"; port: number };

/**
 * Compute the destination URL for {@link App.openUrl} without performing the
 * `openHttpUrlInNewTab` DOM step.
 *
 * Returns an explicit unavailable result when a remote viewer taps a loopback
 * URL before parasor has a reachable port for it. Rewriting only the host in
 * that state would point the viewer at a port which is still loopback-only on
 * the parasor host.
 *
 * `findReachablePort` is injected so the orchestrator does not have to
 * carry `reachablePorts` / `activeProjectId` state -- the caller wires its
 * memoized lookup function and this helper stays free of React.
 */
export function resolveOpenUrlTarget(
  url: string,
  options: OpenUrlOptions | undefined,
  findReachablePort: (
    devPort: number,
    projectId?: string,
  ) => number | undefined,
): OpenUrlTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  let reachablePort: number | undefined;
  let loopbackPort: number | undefined;
  if (isLoopbackHostname(parsed.hostname)) {
    const devPort = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80;
    if (Number.isInteger(devPort)) {
      loopbackPort = devPort;
      reachablePort = findReachablePort(devPort, options?.projectId);
    }
  }
  const resolvedUrl = resolveReachableBrowserUrl(url, { reachablePort });
  if (
    loopbackPort !== undefined &&
    reachablePort === undefined &&
    typeof window !== "undefined" &&
    !isLoopbackHostname(window.location.hostname)
  ) {
    return { kind: "unreachable-loopback", port: loopbackPort };
  }
  return { kind: "open", url: resolvedUrl };
}

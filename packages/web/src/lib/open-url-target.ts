import type { OpenUrlOptions } from "./open-url-options.js";
import { isCoarsePointer } from "./pointer.js";
import {
  isLoopbackHostname,
  resolveReachableBrowserUrl,
} from "./url-routing.js";

/**
 * Compute the destination URL for {@link App.openUrl} without performing the
 * `openHttpUrlInNewTab` DOM step. Pure aside from the `isCoarsePointer()`
 * media-query read, which mirrors the inline implementation.
 *
 * Returns the resolved URL when the input should be handed to the device's
 * own browser; returns `null` when the input must be ignored -- non-`http(s)`
 * scheme, unparseable, or any case the loopback-rewrite contract decides not
 * to forward (`resolveReachableBrowserUrl` returning the original URL is
 * still a valid pass-through; only the parse/protocol gate produces `null`).
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
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  let reachablePort: number | undefined;
  if (isLoopbackHostname(parsed.hostname)) {
    const devPort = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80;
    if (Number.isInteger(devPort)) {
      reachablePort = findReachablePort(devPort, options?.projectId);
    }
  }
  return resolveReachableBrowserUrl(url, {
    fallbackToPageHostWithoutReachablePort: isCoarsePointer(),
    reachablePort,
  });
}

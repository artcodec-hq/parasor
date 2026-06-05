import { useEffect, useState } from "react";
import { fetchLocalIdeCapability } from "../../lib/git-api.js";
import { isLoopbackHostname } from "../../lib/url-routing.js";

export interface LocalIdeCapabilityState {
  /** Result of the one-shot capability probe -- `true`/`false` once
   * resolved, `null` while pending or after a fetch failure. */
  capability: boolean | null;
  /** Effective gate consumed by the UI: the probed capability if known,
   * otherwise a hostname fallback (page served from a loopback hostname
   * is treated as locally reachable so the IDE-open buttons render even
   * before the probe completes). Matches the inline
   * `localIdeCapability ?? localIdeHostnameFallback` derivation. */
  canOpenLocalIde: boolean;
}

/**
 * One-shot probe of the local IDE capability endpoint. Fires once on
 * mount, cancels via a closure flag if the consumer unmounts before the
 * fetch settles (matching the inline pattern), and surfaces a hostname
 * fallback so loopback-served pages keep working when the probe fails
 * or while it is in flight.
 *
 * SSR-safe: the hostname fallback is `false` when `window` is unavailable
 * (mirrors the inline `typeof window !== "undefined" && ...` guard).
 */
export function useLocalIdeCapability(): LocalIdeCapabilityState {
  const [capability, setCapability] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLocalIdeCapability()
      .then((result) => {
        if (!cancelled) setCapability(result.canOpenLocalIde);
      })
      .catch(() => {
        if (!cancelled) setCapability(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const localIdeHostnameFallback =
    typeof window !== "undefined" &&
    isLoopbackHostname(window.location.hostname);
  const canOpenLocalIde = capability ?? localIdeHostnameFallback;

  return { capability, canOpenLocalIde };
}

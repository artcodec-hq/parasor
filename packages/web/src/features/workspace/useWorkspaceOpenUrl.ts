import type { PortInfo } from "@parasor/shared";
import { useCallback, useEffect, useMemo } from "react";
import { openHttpUrlInNewTab } from "../../lib/open-external-url.js";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { resolveOpenUrlTarget } from "../../lib/open-url-target.js";
import {
  buildReachablePortLookup,
  findReachablePortForOpenUrl,
} from "../../lib/reachable-port-lookup.js";

interface UseWorkspaceOpenUrlOptions {
  activeProjectId: string | null;
  clearPendingUrl: () => void;
  onUnreachablePort: (port: number) => void;
  pendingOpenUrl: string | null;
  ports: Record<string, PortInfo[]>;
}

export function useWorkspaceOpenUrl({
  activeProjectId,
  clearPendingUrl,
  onUnreachablePort,
  pendingOpenUrl,
  ports,
}: UseWorkspaceOpenUrlOptions) {
  const reachablePorts = useMemo(
    () => buildReachablePortLookup(ports),
    [ports],
  );

  const findReachablePort = useCallback(
    (devPort: number, projectId?: string): number | undefined => {
      return findReachablePortForOpenUrl(reachablePorts, devPort, {
        activeProjectId,
        projectId,
      });
    },
    [activeProjectId, reachablePorts],
  );

  const openUrl = useCallback(
    (url: string, options?: OpenUrlOptions) => {
      const target = resolveOpenUrlTarget(url, options, findReachablePort);
      if (target === null) return;
      if (target.kind === "unreachable-loopback") {
        onUnreachablePort(target.port);
        return;
      }
      openHttpUrlInNewTab(target.url);
    },
    [findReachablePort, onUnreachablePort],
  );

  useEffect(() => {
    if (!pendingOpenUrl) return;
    openUrl(pendingOpenUrl);
    clearPendingUrl();
  }, [clearPendingUrl, openUrl, pendingOpenUrl]);

  return openUrl;
}

import { useCallback, useEffect, useState } from "react";
import {
  buildWorkspacePath,
  parseWorkspaceRoute,
  type WorkspaceRoute,
} from "../../lib/workspace-route.js";

export function useWorkspaceRoute() {
  const [route, setRoute] = useState<WorkspaceRoute>(() =>
    parseWorkspaceRoute(window.location),
  );

  useEffect(() => {
    const onPopState = () => setRoute(parseWorkspaceRoute(window.location));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback(
    (next: WorkspaceRoute, opts?: { replace?: boolean }) => {
      const path = buildWorkspacePath(next);
      const current = `${window.location.pathname}${window.location.search}`;
      if (path !== current) {
        if (opts?.replace) {
          window.history.replaceState(null, "", path);
        } else {
          window.history.pushState(null, "", path);
        }
      }
      setRoute(next);
    },
    [],
  );

  return { navigate, route };
}

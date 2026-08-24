import { useEffect } from "react";
import { refreshWorktrees } from "./worktree-api.js";

interface UseActiveWorktreeRefreshOptions {
  activeProjectId: string | null;
  connected: boolean;
  missingProjectIds?: Iterable<string>;
}

export function useActiveWorktreeRefresh({
  activeProjectId,
  connected,
  missingProjectIds,
}: UseActiveWorktreeRefreshOptions) {
  useEffect(() => {
    if (!connected || !activeProjectId) return;
    if (missingProjectIds && [...missingProjectIds].includes(activeProjectId)) {
      return;
    }
    const ac = new AbortController();
    void refreshWorktrees(activeProjectId, ac.signal).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn("Worktree refresh failed:", error);
    });
    return () => ac.abort();
  }, [activeProjectId, connected, missingProjectIds]);
}

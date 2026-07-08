import { useEffect } from "react";
import { refreshWorktrees } from "./worktree-api.js";

interface UseActiveWorktreeRefreshOptions {
  activeProjectId: string | null;
  connected: boolean;
}

export function useActiveWorktreeRefresh({
  activeProjectId,
  connected,
}: UseActiveWorktreeRefreshOptions) {
  useEffect(() => {
    if (!connected || !activeProjectId) return;
    const ac = new AbortController();
    void refreshWorktrees(activeProjectId, ac.signal).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn("Worktree refresh failed:", error);
    });
    return () => ac.abort();
  }, [activeProjectId, connected]);
}

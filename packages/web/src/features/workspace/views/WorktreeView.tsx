import type { ReactNode } from "react";

export type WorktreeTab = "files" | "git";

export interface WorktreeCounters {
  /** Commits ahead of upstream. `undefined` = no upstream tracking. */
  ahead?: number;
  /** Commits behind upstream. `undefined` = no upstream tracking. */
  behind?: number;
  /** Tracked dirty + untracked file count. `undefined` = no data yet. */
  dirty?: number;
}

export interface WorktreeGitMenuActions {
  onPull?: () => void;
  onPush?: () => void;
}

interface WorktreeViewProps {
  activeTab: WorktreeTab;
  worktreeName?: string | null;
  worktreePath?: string | null;
  counters?: WorktreeCounters;
  children: ReactNode;
}

/**
 * Worktree container. The identity row is now rendered by the persistent
 * SessionPaneHeader above the workspace; this wrapper just hosts the body.
 */
export function WorktreeView({ children }: WorktreeViewProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

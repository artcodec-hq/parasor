import type { GitState } from "@parasor/shared";
import { DEFAULT_WORKTREE_RATIO } from "@parasor/shared";
import { useMemo } from "react";
import { DiffPane } from "../../panes/diff/DiffPane.js";
import type {
  GitGraphActions,
  GitGraphSelection,
} from "../../panes/git-graph/GitGraphPane.js";
import { GitGraphPane } from "../../panes/git-graph/GitGraphPane.js";
import { GitInitEmptyState } from "../../panes/git-init/GitInitEmptyState.js";
import { UncommittedPane } from "../../panes/uncommitted/UncommittedPane.js";
import { Split2Col } from "./Split2Col.js";
import { WorktreeTabBar } from "./WorktreeTabBar.js";
import type { WorktreeTab } from "./WorktreeView.js";

interface GitPaneViewProps {
  projectId: string;
  worktreePath: string;
  fileChangeSeq: number;
  isMobile: boolean;
  gitState: GitState | null;
  projectPath: string | null;
  selection: GitGraphSelection | null;
  onSelectionChange: (next: GitGraphSelection | null) => void;
  commitBusy: boolean;
  commitError: string | null;
  onClearCommitError: () => void;
  onSubmitInlineCommit: (input: {
    message: string;
    paths: string[];
  }) => Promise<void> | void;
  onChangeTab: (tab: WorktreeTab) => void;
  onOpenFilePath: (filePath: string) => void;
  gitActions?: GitGraphActions;
}

export function buildGitGraphRefreshKey(
  fileChangeSeq: number,
  gitState: GitState | null,
): string {
  return [
    fileChangeSeq,
    gitState?.branch ?? "",
    gitState?.ahead ?? "",
    gitState?.behind ?? "",
    gitState?.dirtyCount ?? "",
    gitState?.isRepo === false ? "non-repo" : "repo",
  ].join(":");
}

/**
 * Git pane: 2-col split [commit graph | context-sensitive right column].
 * Left=`GitGraphPane` (working tree row + commit history). Right pivots on
 * the graph selection -- `working-tree` row -> in-pane `UncommittedPane`,
 * commit row (or no selection) -> diff view. When the worktree has no
 * `.git/`, the whole pane is replaced with `GitInitEmptyState`.
 */
export function GitPaneView({
  projectId,
  worktreePath,
  fileChangeSeq,
  isMobile,
  gitState,
  projectPath,
  selection,
  onSelectionChange,
  commitBusy,
  commitError,
  onClearCommitError,
  onSubmitInlineCommit,
  onChangeTab,
  onOpenFilePath,
  gitActions,
}: GitPaneViewProps) {
  const uncommittedFiles = useMemo(() => {
    if (gitState?.changes) {
      return gitState.changes
        .map((change) => ({
          path: change.path,
          status: change.code,
          area: change.area,
          oldPath: change.oldPath,
          conflict: change.conflict,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    }
    const fileStatuses = gitState?.fileStatuses;
    if (!fileStatuses) return [];
    return Object.entries(fileStatuses)
      .map(([path, status]) => ({ path, status }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [gitState?.changes, gitState?.fileStatuses]);

  if (gitState?.isRepo === false) {
    return (
      <GitInitEmptyState projectId={projectId} projectPath={projectPath} />
    );
  }

  const isWorkingTree = selection?.kind === "working-tree";
  const graphRefreshKey = buildGitGraphRefreshKey(fileChangeSeq, gitState);

  return (
    <Split2Col
      storageKey="worktree"
      defaultRatio={DEFAULT_WORKTREE_RATIO}
      isMobile={isMobile}
      secondaryActive={selection !== null}
      primary={
        <div className="flex h-full min-h-0 flex-col">
          <div className="hidden h-bar shrink-0 border-b border-border bg-tab-strip-bg md:block">
            <WorktreeTabBar activeTab="git" onChangeTab={onChangeTab} />
          </div>
          <div className="min-h-0 flex-1">
            <GitGraphPane
              projectId={projectId}
              worktreePath={worktreePath}
              refreshSeq={graphRefreshKey}
              selection={selection}
              onSelect={onSelectionChange}
              isMobile={isMobile}
              currentBranch={gitState?.branch}
              ahead={gitState?.ahead}
              behind={gitState?.behind}
              {...(gitActions && { actions: gitActions })}
            />
          </div>
        </div>
      }
      secondary={
        isWorkingTree ? (
          <UncommittedPane
            projectId={projectId}
            worktreePath={worktreePath}
            fileChangeSeq={fileChangeSeq}
            files={uncommittedFiles}
            busy={commitBusy}
            error={commitError}
            onClearError={onClearCommitError}
            onSubmit={(input) => void onSubmitInlineCommit(input)}
            onOpenFilePath={onOpenFilePath}
          />
        ) : (
          <DiffPane
            projectId={projectId}
            worktreePath={worktreePath}
            fileChangeSeq={fileChangeSeq}
            commit={selection?.kind === "commit" ? selection.commit : null}
            onOpenFilePath={onOpenFilePath}
          />
        )
      }
    />
  );
}

import type { GitState } from "@parasor/shared";
import type { GitGraphSelection } from "../panes/git-graph/GitGraphPane.js";
import type { WorkspaceBodyPane } from "../panes/pane-module-registry.js";
import { BrowserPaneView } from "./views/BrowserPaneView.js";
import { FilesPaneView } from "./views/FilesPaneView.js";
import { GitPaneView } from "./views/GitPaneView.js";
import {
  type WorktreeCounters,
  type WorktreeGitMenuActions,
  type WorktreeTab,
  WorktreeView,
} from "./views/WorktreeView.js";

interface WorkspacePaneBodyProps {
  activeProjectId: string;
  activeProjectPath: string | null;
  focusedPane: WorkspaceBodyPane;
  focusedWorktreeDirName: string | null;
  fileChangeSeq: number;
  gitState: GitState | null;
  gitFileStatuses?: Record<string, string>;
  filesSelection: string | null;
  counters?: WorktreeCounters;
  gitMenuActions?: WorktreeGitMenuActions;
  gitGraphSelection: GitGraphSelection | null;
  onGitGraphSelectionChange: (next: GitGraphSelection | null) => void;
  commitBusy: boolean;
  commitError: string | null;
  onClearCommitError: () => void;
  onSubmitInlineCommit: (input: {
    message: string;
    paths: string[];
  }) => Promise<void> | void;
  isMobile: boolean;
  browserOnClose?: () => void;
  onBrowserUrlChange?: (paneId: string, url: string) => void;
  onSelectWorktreeTab: (worktreePath: string, tab: WorktreeTab) => void;
  onOpenFilePath: (worktreePath: string, filePath: string) => void;
  allowFilesGit?: boolean;
}

export function WorkspacePaneBody({
  activeProjectId,
  activeProjectPath,
  focusedPane,
  focusedWorktreeDirName,
  fileChangeSeq,
  gitState,
  gitFileStatuses,
  filesSelection,
  counters,
  gitMenuActions,
  gitGraphSelection,
  onGitGraphSelectionChange,
  commitBusy,
  commitError,
  onClearCommitError,
  onSubmitInlineCommit,
  isMobile,
  browserOnClose,
  onBrowserUrlChange,
  onSelectWorktreeTab,
  onOpenFilePath,
  allowFilesGit = true,
}: WorkspacePaneBodyProps) {
  const { state } = focusedPane;
  switch (state.kind) {
    case "files":
      if (!allowFilesGit) return null;
      return (
        <WorktreeView
          activeTab="files"
          worktreeName={focusedWorktreeDirName}
          worktreePath={focusedPane.worktreePath}
          counters={counters}
        >
          <FilesPaneView
            paneId={focusedPane.id}
            projectId={activeProjectId}
            worktreePath={focusedPane.worktreePath}
            fileChangeSeq={fileChangeSeq}
            gitFileStatuses={gitFileStatuses}
            onChangeTab={(tab) =>
              onSelectWorktreeTab(focusedPane.worktreePath, tab)
            }
            selectedFilePath={filesSelection}
            onOpenFilePath={(filePath) =>
              onOpenFilePath(focusedPane.worktreePath, filePath)
            }
          />
        </WorktreeView>
      );
    case "browser":
      return (
        <BrowserPaneView
          state={state}
          paneId={focusedPane.id}
          onClose={browserOnClose}
          onUrlChange={
            onBrowserUrlChange
              ? (url) => onBrowserUrlChange(focusedPane.id, url)
              : undefined
          }
        />
      );
    case "git":
      if (!allowFilesGit) return null;
      return (
        <WorktreeView
          activeTab="git"
          worktreeName={focusedWorktreeDirName}
          worktreePath={focusedPane.worktreePath}
          counters={counters}
        >
          <GitPaneView
            projectId={activeProjectId}
            worktreePath={focusedPane.worktreePath}
            fileChangeSeq={fileChangeSeq}
            isMobile={isMobile}
            gitState={gitState}
            projectPath={activeProjectPath}
            selection={gitGraphSelection}
            onSelectionChange={onGitGraphSelectionChange}
            commitBusy={commitBusy}
            commitError={commitError}
            onClearCommitError={onClearCommitError}
            onSubmitInlineCommit={onSubmitInlineCommit}
            onChangeTab={(tab) =>
              onSelectWorktreeTab(focusedPane.worktreePath, tab)
            }
            onOpenFilePath={(filePath) =>
              onOpenFilePath(focusedPane.worktreePath, filePath)
            }
            {...(gitMenuActions && { gitActions: gitMenuActions })}
          />
        </WorktreeView>
      );
    default:
      return assertNeverPaneState(state);
  }
}

function assertNeverPaneState(state: never): never {
  throw new Error(`Unsupported workspace pane state: ${JSON.stringify(state)}`);
}

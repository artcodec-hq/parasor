import { useCallback } from "react";
import { FileTreePane } from "../../panes/file-tree/FileTreePane.js";
import { WorktreeTabBar } from "./WorktreeTabBar.js";
import type { WorktreeTab } from "./WorktreeView.js";

interface FilesPaneViewProps {
  paneId: string;
  projectId: string;
  worktreePath: string;
  fileChangeSeq: number;
  gitFileStatuses?: Record<string, string>;
  onChangeTab: (tab: WorktreeTab) => void;
  selectedFilePath: string | null;
  onOpenFilePath: (filePath: string) => void;
}

/**
 * Files pane: file tree surface. Selection is held by workspace-level file
 * display state and mirrored in localStorage keyed by paneId for row
 * highlighting continuity.
 */
export function FilesPaneView({
  paneId,
  projectId,
  worktreePath,
  fileChangeSeq,
  gitFileStatuses,
  onChangeTab,
  selectedFilePath,
  onOpenFilePath,
}: FilesPaneViewProps) {
  const handleSelectFile = useCallback(
    (filePath: string) => {
      onOpenFilePath(filePath);
    },
    [onOpenFilePath],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hidden h-bar shrink-0 border-b border-border bg-tab-strip-bg md:block">
        <WorktreeTabBar activeTab="files" onChangeTab={onChangeTab} />
      </div>
      <div className="min-h-0 flex-1">
        <FileTreePane
          paneId={paneId}
          projectId={projectId}
          worktreePath={worktreePath}
          initialExpanded={[]}
          fileChangeSeq={fileChangeSeq}
          onSelectFile={handleSelectFile}
          selectedFilePath={selectedFilePath}
          gitFileStatuses={gitFileStatuses}
        />
      </div>
    </div>
  );
}

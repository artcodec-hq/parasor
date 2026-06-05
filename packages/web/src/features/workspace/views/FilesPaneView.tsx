import { DEFAULT_WORKTREE_RATIO } from "@parasor/shared";
import { lazy, Suspense, useCallback } from "react";
import { PaGlyph, PaneHeader } from "../../../components/primitives/index.js";
import { FileTreePane } from "../../panes/file-tree/FileTreePane.js";
import { Split2Col } from "./Split2Col.js";
import { useFilesPaneSelection } from "./use-files-pane-selection.js";
import { WorktreeTabBar } from "./WorktreeTabBar.js";
import type { WorktreeTab } from "./WorktreeView.js";

const LazyEditorPane = lazy(() =>
  import("../../panes/editor/EditorPane.js").then(({ EditorPane }) => ({
    default: EditorPane,
  })),
);

interface FilesPaneViewProps {
  paneId: string;
  projectId: string;
  worktreePath: string;
  fileChangeSeq: number;
  gitFileStatuses?: Record<string, string>;
  isMobile: boolean;
  onChangeTab: (tab: WorktreeTab) => void;
}

/**
 * Files pane: [FileTree | Editor] split. Selection is held in localStorage
 * keyed by paneId (see `use-files-pane-selection`); the column ratio is
 * shared with the Git tab via Split2Col `storageKey="worktree"` so
 * switching tabs never reflows.
 */
export function FilesPaneView({
  paneId,
  projectId,
  worktreePath,
  fileChangeSeq,
  gitFileStatuses,
  isMobile,
  onChangeTab,
}: FilesPaneViewProps) {
  const [selectedFilePath, setSelectedFilePath] = useFilesPaneSelection(paneId);

  const handleSelectFile = useCallback(
    (filePath: string) => {
      setSelectedFilePath(filePath);
    },
    [setSelectedFilePath],
  );

  return (
    <Split2Col
      storageKey="worktree"
      defaultRatio={DEFAULT_WORKTREE_RATIO}
      isMobile={isMobile}
      secondaryActive={selectedFilePath !== null}
      primary={
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
      }
      secondary={
        selectedFilePath ? (
          <Suspense fallback={<EditorLoadingState />}>
            <LazyEditorPane
              paneId={`${paneId}:editor`}
              projectId={projectId}
              worktreePath={worktreePath}
              filePath={selectedFilePath}
              fileChangeSeq={fileChangeSeq}
            />
          </Suspense>
        ) : (
          <FilesEmptyState />
        )
      }
    />
  );
}

function EditorLoadingState() {
  return (
    <div className="flex h-full flex-col bg-bg-primary text-text-primary">
      <PaneHeader icon={<PaGlyph.doc />} title="Editor" />
      <div className="min-h-0 flex-1" />
    </div>
  );
}

function FilesEmptyState() {
  return (
    <div className="flex h-full flex-col bg-bg-primary text-text-primary">
      <PaneHeader icon={<PaGlyph.doc />} title="Editor" />
      <div className="min-h-0 flex-1 p-3 text-sm text-text-secondary">
        Select a file to view or edit.
      </div>
    </div>
  );
}

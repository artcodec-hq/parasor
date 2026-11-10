import { lazy, Suspense } from "react";

const LazyEditorPane = lazy(() =>
  import("../panes/editor/EditorPane.js").then(({ EditorPane }) => ({
    default: EditorPane,
  })),
);

export interface WorkspaceFileDisplayTarget {
  worktreePath: string;
  filePath: string;
  temporaryFilePath?: string;
  openerPaneId: string;
}

export function basename(filePath: string): string {
  const trimmed = filePath.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] ?? filePath;
}

export function isTemporaryAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/tmp/") || filePath.startsWith("/private/tmp/");
}

interface WorkspaceFileDisplayProps {
  projectId: string;
  target: WorkspaceFileDisplayTarget;
  fileChangeSeq: number;
  onClose: () => void;
}

export function WorkspaceFileDisplay({
  projectId,
  target,
  fileChangeSeq,
  onClose,
}: WorkspaceFileDisplayProps) {
  const paneId = `file-display:${target.openerPaneId}`;
  return (
    <div className="h-full min-h-0 min-w-0">
      <Suspense
        fallback={
          <div className="h-full bg-bg-primary text-sm text-text-secondary" />
        }
      >
        <LazyEditorPane
          paneId={paneId}
          projectId={projectId}
          worktreePath={target.worktreePath}
          filePath={target.filePath}
          temporaryFilePath={target.temporaryFilePath}
          fileChangeSeq={fileChangeSeq}
          onClose={onClose}
        />
      </Suspense>
    </div>
  );
}

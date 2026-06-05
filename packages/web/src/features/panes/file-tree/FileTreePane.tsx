import { useCallback, useState } from "react";
import {
  PaGlyph,
  PaMenu,
  PaneFooter,
  PaneIconButton,
} from "../../../components/primitives/index.js";
import { makeDirectory, writeFile } from "../../../lib/files-api.js";
import { useProject } from "../../workspace/projects-context.js";
import { FileTree } from "./FileTree.js";

// Mirrors HARD_EXCLUDES in packages/server/src/fs/service.ts. Server hides
// these from listings, so creating one via the client succeeds but the entry
// disappears from FileTree -- and `.git` in particular can break git
// detection in non-repo project roots.
const RESERVED_NAMES = new Set([".git", ".DS_Store", "Thumbs.db"]);

export function validateEntryName(name: string): string | null {
  if (!name) return "Name cannot be empty.";
  if (name === "." || name === "..") {
    return "Name cannot be '.' or '..'.";
  }
  if (name.includes("/") || name.includes("\\")) {
    return "Name cannot contain '/' or '\\'.";
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: file names intentionally reject C0/DEL control bytes.
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return "Name contains control characters.";
  }
  if (RESERVED_NAMES.has(name)) {
    return `'${name}' is reserved and won't appear in the tree.`;
  }
  return null;
}

interface FileTreePaneProps {
  paneId: string;
  projectId: string;
  /**
   * Absolute path of the worktree this pane lives in. Threads through to
   * `/api/files/list?worktreePath=...` so each linked worktree shows its
   * own tree instead of the project main checkout. `undefined` falls back
   * to project root (legacy behavior).
   */
  worktreePath?: string;
  initialExpanded: string[];
  fileChangeSeq?: number;
  onExpandedPathsChange?: (paneId: string, expandedPaths: string[]) => void;
  onSelectFile?: (path: string) => void;
  selectedFilePath?: string | null;
  gitFileStatuses?: Record<string, string>;
}

export function FileTreePane({
  paneId,
  projectId,
  worktreePath,
  initialExpanded,
  fileChangeSeq,
  onExpandedPathsChange,
  onSelectFile,
  selectedFilePath,
  gitFileStatuses,
}: FileTreePaneProps) {
  const project = useProject(projectId);
  const [expandedPaths, setExpandedPaths] = useState<string[]>(initialExpanded);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [rootCount, setRootCount] = useState(0);

  const handleToggleExpand = useCallback(
    (path: string, expanded: boolean) => {
      setExpandedPaths((prev) => {
        const next = expanded
          ? [...prev, path]
          : prev.filter((candidate) => candidate !== path);
        onExpandedPathsChange?.(paneId, next);
        return next;
      });
    },
    [paneId, onExpandedPathsChange],
  );

  const handleRefresh = useCallback(() => {
    setRefreshSeq((n) => n + 1);
  }, []);

  const createEntry = useCallback(
    async (kind: "file" | "folder") => {
      const promptLabel = kind === "file" ? "New file name" : "New folder name";
      const name = window.prompt(promptLabel)?.trim();
      if (!name) return;
      const validationError = validateEntryName(name);
      if (validationError) {
        window.alert(validationError);
        return;
      }
      const res =
        kind === "file"
          ? await writeFile({
              projectId,
              path: name,
              content: "",
              ...(worktreePath ? { worktreePath } : {}),
            })
          : await makeDirectory({
              projectId,
              path: name,
              ...(worktreePath ? { worktreePath } : {}),
            });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        window.alert(`Failed to create ${kind}${detail ? `: ${detail}` : ""}`);
        return;
      }
      handleRefresh();
    },
    [projectId, worktreePath, handleRefresh],
  );

  const addMenuItems = [
    {
      id: "new-file",
      label: "New file",
      onSelect: () => {
        void createEntry("file");
      },
    },
    {
      id: "new-folder",
      label: "New folder",
      onSelect: () => {
        void createEntry("folder");
      },
    },
  ];

  return (
    <div className="flex h-full flex-col bg-bg-primary text-text-primary">
      <div className="min-h-0 flex-1">
        <FileTree
          projectId={projectId}
          projectPath={worktreePath ?? project?.path}
          worktreePath={worktreePath}
          expandedPaths={expandedPaths}
          onToggleExpand={handleToggleExpand}
          onSelectFile={onSelectFile}
          selectedFilePath={selectedFilePath}
          fileChangeSeq={fileChangeSeq}
          manualRefreshSeq={refreshSeq}
          gitFileStatuses={gitFileStatuses}
          onRootCountChange={setRootCount}
        />
      </div>
      <PaneFooter
        status={`${rootCount} ${rootCount === 1 ? "file" : "files"}`}
        actions={
          <div className="flex shrink-0 items-center gap-1">
            <PaMenu
              align="end"
              placement="top"
              items={addMenuItems}
              renderTrigger={({
                toggle,
                triggerRef,
                menuId,
                open: menuOpen,
              }) => (
                <PaneIconButton
                  ref={triggerRef}
                  onClick={toggle}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls={menuId}
                  label="New file or folder"
                >
                  <PaGlyph.add />
                </PaneIconButton>
              )}
            />
            <PaneIconButton onClick={handleRefresh} label="Refresh">
              <PaGlyph.refresh />
            </PaneIconButton>
          </div>
        }
      />
    </div>
  );
}

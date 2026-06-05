import type { WorktreeLocalFileCandidate } from "@parasor/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DialogButton,
  DialogFooter,
  DialogHeader,
  DialogRoot,
} from "../primitives/index.js";

export interface WorktreeLocalFileLoadResult {
  candidates: WorktreeLocalFileCandidate[];
  rememberedPaths: string[];
}

export interface NewWorktreeDialogProps {
  open: boolean;
  project: { id: string; name: string; path: string };
  busy?: boolean;
  error?: string | null;
  loadLocalFiles?: (projectId: string) => Promise<WorktreeLocalFileLoadResult>;
  onClose: () => void;
  onCreate: (input: {
    branch: string;
    base: string;
    copyLocalFiles: string[];
    rememberLocalFiles: boolean;
  }) => Promise<void> | void;
}

/**
 * Single-flow worktree creation dialog (GitLens 2024 pattern).
 * Server auto-detects: if `branch` already exists -> checkout; else create
 * new branch from `base` (defaults to current HEAD). The path preview shows
 * `{projectPath}.worktrees/{branch}` (sibling-dir convention).
 */
export function NewWorktreeDialog({
  open,
  project,
  busy = false,
  error,
  loadLocalFiles,
  onClose,
  onCreate,
}: NewWorktreeDialogProps) {
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [localFiles, setLocalFiles] = useState<WorktreeLocalFileCandidate[]>(
    [],
  );
  const [localFilesLoading, setLocalFilesLoading] = useState(false);
  const [localFilesError, setLocalFilesError] = useState<string | null>(null);
  const [selectedLocalFiles, setSelectedLocalFiles] = useState<Set<string>>(
    () => new Set(),
  );
  const [rememberLocalFiles, setRememberLocalFiles] = useState(false);
  const branchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setBranch("");
    setBase("");
    setLocalFiles([]);
    setLocalFilesError(null);
    setSelectedLocalFiles(new Set());
    setRememberLocalFiles(false);
    const frame = requestAnimationFrame(() => branchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || !loadLocalFiles) return;
    let cancelled = false;
    setLocalFilesLoading(true);
    setLocalFilesError(null);
    void loadLocalFiles(project.id)
      .then((result) => {
        if (cancelled) return;
        setLocalFiles(result.candidates);
        const candidatePaths = new Set(
          result.candidates.map((item) => item.path),
        );
        const remembered = result.rememberedPaths.filter((item) =>
          candidatePaths.has(item),
        );
        setSelectedLocalFiles(new Set(remembered));
        setRememberLocalFiles(remembered.length > 0);
      })
      .catch((err) => {
        if (cancelled) return;
        setLocalFilesError(
          err instanceof Error ? err.message : "Failed to load local files",
        );
      })
      .finally(() => {
        if (!cancelled) setLocalFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, project.id, loadLocalFiles]);

  const previewPath = useMemo(() => {
    const trimmed = project.path.replace(/\/+$/, "");
    return branch ? `${trimmed}.worktrees/${branch}` : `${trimmed}.worktrees/…`;
  }, [project.path, branch]);

  const canSubmit = branch.trim().length > 0 && !busy;

  function submit() {
    if (!canSubmit) return;
    void onCreate({
      branch: branch.trim(),
      base: base.trim(),
      copyLocalFiles: [...selectedLocalFiles],
      rememberLocalFiles,
    });
  }

  function toggleLocalFile(path: string, checked: boolean) {
    setSelectedLocalFiles((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  return (
    <DialogRoot
      open={open}
      ariaLabel={`New worktree in ${project.name}`}
      onClose={onClose}
    >
      <DialogHeader
        title="New worktree in"
        subject={project.name}
        onClose={onClose}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3 px-4 pt-3 pb-4"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            Branch name
          </span>
          <input
            ref={branchInputRef}
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="feature/foo"
            className="cm-mono w-full rounded-control border border-border bg-bg-primary px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent/60 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-text-secondary/80">
            Existing branch is checked out; otherwise a new branch is created.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            Base{" "}
            <span className="font-normal text-text-secondary/60">
              (optional, used when creating a new branch)
            </span>
          </span>
          <input
            type="text"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="HEAD"
            className="cm-mono w-full rounded-control border border-border bg-bg-primary px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent/60 focus:outline-none"
          />
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            Path
          </span>
          <div
            className="cm-mono truncate rounded-control border border-border/60 bg-bg-primary/60 px-2.5 py-1.5 text-xs text-text-secondary"
            title={previewPath}
          >
            {previewPath}
          </div>
        </div>

        <div className="rounded-control border border-border/70 bg-bg-primary/40 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-text-secondary">
              Local files
            </span>
            {localFiles.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={rememberLocalFiles}
                  onChange={(e) => setRememberLocalFiles(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Remember
              </label>
            )}
          </div>
          {localFilesLoading ? (
            <div className="text-xs text-text-secondary">
              Loading local files…
            </div>
          ) : localFilesError ? (
            <div className="text-xs text-danger">{localFilesError}</div>
          ) : localFiles.length === 0 ? (
            <div className="text-xs text-text-secondary">
              No ignored local files found.
            </div>
          ) : (
            <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
              {localFiles.map((file) => (
                <label
                  key={file.path}
                  className="flex min-h-7 items-center gap-2 rounded-control px-1 text-xs text-text-primary hover:bg-bg-secondary"
                >
                  <input
                    type="checkbox"
                    checked={selectedLocalFiles.has(file.path)}
                    onChange={(e) =>
                      toggleLocalFile(file.path, e.target.checked)
                    }
                    className="h-3.5 w-3.5 shrink-0 accent-accent"
                  />
                  <span className="cm-mono min-w-0 flex-1 truncate">
                    {file.path}
                  </span>
                  <span className="shrink-0 text-text-secondary/70">
                    {formatBytes(file.size)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-control border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
            {error}
          </div>
        )}

        <DialogFooter>
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          <DialogButton type="submit" variant="primary" disabled={!canSubmit}>
            {busy ? "Creating…" : "Create"}
          </DialogButton>
        </DialogFooter>
      </form>
    </DialogRoot>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

import { useEffect, useRef, useState } from "react";
import {
  DialogButton,
  DialogFooter,
  DialogHeader,
  DialogRoot,
} from "../primitives/index.js";

export interface RenameWorktreeDialogProps {
  open: boolean;
  currentBranch: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (newBranch: string) => Promise<void> | void;
}

/**
 * Branch-only rename. The on-disk worktree directory keeps its original
 * path; only `git branch -m` is invoked server-side.
 */
export function RenameWorktreeDialog({
  open,
  currentBranch,
  busy = false,
  error,
  onClose,
  onSubmit,
}: RenameWorktreeDialogProps) {
  const [newBranch, setNewBranch] = useState("");
  const branchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setNewBranch(currentBranch);
    const frame = requestAnimationFrame(() => branchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, currentBranch]);

  const trimmed = newBranch.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentBranch && !busy;

  function submit() {
    if (!canSubmit) return;
    void onSubmit(trimmed);
  }

  return (
    <DialogRoot
      open={open}
      ariaLabel={`Rename branch ${currentBranch}`}
      onClose={onClose}
    >
      <DialogHeader
        title="Rename branch"
        subject={currentBranch}
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
            New branch name
          </span>
          <input
            ref={branchInputRef}
            type="text"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            placeholder="feature/foo"
            className="cm-mono w-full rounded-control border border-border bg-bg-primary px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent/60 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-text-secondary/80">
            Runs <span className="cm-mono">git branch -m</span>; the worktree
            directory keeps its original path.
          </span>
        </label>

        {error && (
          <div className="rounded-control border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
            {error}
          </div>
        )}

        <DialogFooter>
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          <DialogButton type="submit" variant="primary" disabled={!canSubmit}>
            {busy ? "Renaming…" : "Rename"}
          </DialogButton>
        </DialogFooter>
      </form>
    </DialogRoot>
  );
}

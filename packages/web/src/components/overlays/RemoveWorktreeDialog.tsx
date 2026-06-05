import { useEffect, useState } from "react";
import {
  DialogButton,
  DialogFooter,
  DialogHeader,
  DialogRoot,
} from "../primitives/index.js";

export interface RemoveWorktreeDialogProps {
  open: boolean;
  branch: string;
  worktreePath: string;
  /** Files with uncommitted changes -- when > 0, force is required. */
  dirtyCount: number;
  /**
   * `true` when the path is missing on disk. Skips the dirty-confirmation
   * gate (no files to lose) and relabels the primary action as "Prune".
   * Server treats missing-path as `git worktree prune` regardless of force.
   */
  orphan?: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: { force: boolean }) => Promise<void> | void;
}

/**
 * Removes or prunes a git worktree registration while preserving the branch.
 */
export function RemoveWorktreeDialog({
  open,
  branch,
  worktreePath,
  dirtyCount,
  orphan = false,
  busy = false,
  error,
  onClose,
  onSubmit,
}: RemoveWorktreeDialogProps) {
  const [forceConfirmed, setForceConfirmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForceConfirmed(false);
  }, [open]);

  const dirty = !orphan && dirtyCount > 0;
  const canSubmit = !busy && (!dirty || forceConfirmed);
  const intro = orphan
    ? {
        text: "The on-disk directory is gone. Run",
        command: "git worktree prune",
        rest: "to drop the stale registration. The branch is preserved.",
      }
    : {
        text: "Run",
        command: "git worktree remove",
        rest: "on this checkout. The branch is preserved; only the working directory is unlinked.",
      };
  const submitLabel = busy
    ? orphan
      ? "Pruning…"
      : "Removing…"
    : orphan
      ? "Prune"
      : dirty
        ? "Force remove"
        : "Remove";

  function submit() {
    if (!canSubmit) return;
    void onSubmit({ force: orphan || dirty });
  }

  return (
    <DialogRoot
      open={open}
      ariaLabel={`Remove worktree ${branch}`}
      onClose={onClose}
    >
      <DialogHeader
        title="Remove worktree"
        subject={branch}
        onClose={onClose}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3 px-4 pt-3 pb-4"
      >
        <p className="text-sm text-text-primary">
          {intro.text} <span className="cm-mono">{intro.command}</span>{" "}
          {intro.rest}
        </p>

        <div>
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            Path
          </span>
          <div
            className="cm-mono truncate rounded-control border border-border/60 bg-bg-primary/60 px-2.5 py-1.5 text-xs text-text-secondary"
            title={worktreePath}
          >
            {worktreePath}
          </div>
        </div>

        {dirty && (
          <label className="flex cursor-pointer items-start gap-2 rounded-control border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-text-primary">
            <input
              type="checkbox"
              checked={forceConfirmed}
              onChange={(e) => setForceConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong className="font-semibold text-warning">
                {dirtyCount} uncommitted file
                {dirtyCount === 1 ? "" : "s"}
              </strong>{" "}
              will be lost. I understand and want to force remove.
            </span>
          </label>
        )}

        {error && (
          <div className="rounded-control border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
            {error}
          </div>
        )}

        <DialogFooter>
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          <DialogButton type="submit" variant="danger" disabled={!canSubmit}>
            {submitLabel}
          </DialogButton>
        </DialogFooter>
      </form>
    </DialogRoot>
  );
}

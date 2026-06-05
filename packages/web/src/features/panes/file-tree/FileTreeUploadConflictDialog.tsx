import type { FileUploadDisposition } from "@parasor/shared";
import { useEffect, useRef, useState } from "react";
import {
  DialogButton,
  DialogFooter,
  DialogHeader,
  DialogRoot,
} from "../../../components/primitives/index.js";

export interface FileTreeUploadConflictDialogProps {
  open: boolean;
  conflicts: readonly string[];
  /** Total file count in the in-flight batch -- used in the prompt copy. */
  totalCount: number;
  /** Resolved target dir (relative to the project root) for context. */
  targetLabel: string;
  /**
   * Called with the user's choice. `applyToAll` is currently always true
   * for the v1 modal -- the contract leaves room for a future per-file
   * picker without an API change.
   */
  onResolve: (disposition: FileUploadDisposition, applyToAll: boolean) => void;
  onCancel: () => void;
}

/**
 * One-shot conflict resolution modal for `POST /files/upload`. The server
 * reports collisions; this dialog converts the reported list into a
 * Replace / Keep both / Skip choice and re-issues the upload with the
 * chosen `disposition`.
 */
export function FileTreeUploadConflictDialog({
  open,
  conflicts,
  totalCount,
  targetLabel,
  onResolve,
  onCancel,
}: FileTreeUploadConflictDialogProps) {
  const [applyToAll, setApplyToAll] = useState(true);
  const keepBothBtnRef = useRef<HTMLButtonElement>(null);

  // Reset the checkbox + focus the safest default (Keep both) every time
  // a fresh batch surfaces. "Replace" is destructive so we don't auto-focus.
  useEffect(() => {
    if (open) {
      setApplyToAll(true);
      const frame = requestAnimationFrame(() =>
        keepBothBtnRef.current?.focus(),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  const conflictCount = conflicts.length;
  const remaining = Math.max(0, totalCount - conflictCount);
  const totalFileCopy =
    totalCount === 1 ? "file already exists" : "files already exist";

  return (
    <DialogRoot
      open={open}
      ariaLabel="Resolve upload conflict"
      onClose={onCancel}
    >
      <DialogHeader title="Files already exist" onClose={onCancel} />
      <div className="px-4 py-3 text-sm text-text-primary">
        <p className="mb-2 text-text-secondary">
          <span className="font-medium text-text-primary">{conflictCount}</span>{" "}
          of <span className="font-medium">{totalCount}</span> {totalFileCopy}{" "}
          in{" "}
          <code className="rounded-control bg-bg-primary px-1 text-xs">
            {targetLabel || "."}
          </code>
          .
        </p>
        <ul className="mb-3 max-h-32 overflow-y-auto rounded-control border border-border bg-bg-primary px-2 py-1 text-xs text-text-secondary">
          {conflicts.map((name) => (
            <li key={name} className="truncate">
              {name}
            </li>
          ))}
        </ul>
        {remaining > 0 ? (
          <p className="mb-2 text-xs text-text-secondary">
            {remaining} other file{remaining === 1 ? "" : "s"} will follow your
            chosen action.
          </p>
        ) : null}
        <label className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
            className="accent-accent"
          />
          Apply to all files in this drop
        </label>
      </div>
      <div className="border-t border-border px-4 py-3">
        <DialogFooter>
          <DialogButton onClick={onCancel}>Cancel</DialogButton>
          <DialogButton onClick={() => onResolve("skip", applyToAll)}>
            Skip
          </DialogButton>
          <DialogButton
            ref={keepBothBtnRef}
            variant="primary"
            onClick={() => onResolve("keep-both", applyToAll)}
          >
            Keep both
          </DialogButton>
          <DialogButton
            variant="danger"
            onClick={() => onResolve("replace", applyToAll)}
          >
            Replace
          </DialogButton>
        </DialogFooter>
      </div>
    </DialogRoot>
  );
}

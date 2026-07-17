import type {
  UpdateWorkItemInput,
  WorkItem,
  WorkItemCriterion,
  WorkItemStatus,
  Worktree,
} from "@parasor/shared";
import { useEffect, useState } from "react";
import { PaneCloseButton } from "../../workspace/views/PaneCloseButton.js";

interface WorkItemPaneViewProps {
  item: WorkItem;
  worktrees: Worktree[];
  onClose?: () => void;
  onDelete: () => Promise<void> | void;
  onSave: (input: UpdateWorkItemInput) => Promise<void> | void;
}

const STATUSES: Array<{ value: WorkItemStatus; label: string }> = [
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

export function WorkItemPaneView({
  item,
  worktrees,
  onClose,
  onDelete,
  onSave,
}: WorkItemPaneViewProps) {
  const [title, setTitle] = useState(item.title);
  const [status, setStatus] = useState(item.status);
  const [criteria, setCriteria] = useState(item.acceptanceCriteria);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [primaryWorktreePath, setPrimaryWorktreePath] = useState(
    item.primaryWorktreePath ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(item.title);
    setStatus(item.status);
    setCriteria(item.acceptanceCriteria);
    setNotes(item.notes ?? "");
    setPrimaryWorktreePath(item.primaryWorktreePath ?? "");
  }, [item]);

  const save = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: trimmedTitle,
        status,
        acceptanceCriteria: criteria.flatMap((criterion) => {
          const text = criterion.text.trim();
          return text ? [{ ...criterion, text }] : [];
        }),
        notes: notes.trim() ? notes : null,
        primaryWorktreePath: primaryWorktreePath || null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete “${item.title}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete.");
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.title}
        </span>
        {onClose ? <PaneCloseButton onClick={onClose} /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
            Title
            <input
              className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
              Status
              <select
                className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as WorkItemStatus)
                }
              >
                {STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
              Primary worktree
              <select
                className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                value={primaryWorktreePath}
                onChange={(event) => setPrimaryWorktreePath(event.target.value)}
              >
                <option value="">Not set</option>
                {worktrees.map((worktree) => (
                  <option key={worktree.path} value={worktree.path}>
                    {worktree.path}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-text-secondary">
                Acceptance criteria
              </h2>
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() =>
                  setCriteria((current) => [
                    ...current,
                    { id: crypto.randomUUID(), text: "", checked: false },
                  ])
                }
              >
                Add criterion
              </button>
            </div>
            {criteria.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-sm text-text-tertiary">
                No acceptance criteria yet.
              </p>
            ) : (
              criteria.map((criterion, index) => (
                <CriterionRow
                  key={criterion.id}
                  criterion={criterion}
                  onChange={(next) =>
                    setCriteria((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? next : entry,
                      ),
                    )
                  }
                  onRemove={() =>
                    setCriteria((current) =>
                      current.filter((_, entryIndex) => entryIndex !== index),
                    )
                  }
                />
              ))
            )}
          </section>
          <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
            Notes
            <textarea
              className="min-h-36 resize-y rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-text-secondary">
              Attachments
            </h2>
            <p className="rounded-md border border-dashed border-border p-3 text-sm text-text-tertiary">
              No attachments yet. Attachments will be available in a later
              release.
            </p>
          </section>
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <button
              type="button"
              disabled={busy}
              className="rounded-md px-3 py-2 text-sm text-error hover:bg-error/10 disabled:opacity-50"
              onClick={() => void remove()}
            >
              Delete work item
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CriterionRow({
  criterion,
  onChange,
  onRemove,
}: {
  criterion: WorkItemCriterion;
  onChange: (next: WorkItemCriterion) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        aria-label="Criterion complete"
        checked={criterion.checked}
        onChange={(event) =>
          onChange({ ...criterion, checked: event.target.checked })
        }
      />
      <input
        aria-label="Criterion"
        className="min-w-0 flex-1 rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
        value={criterion.text}
        onChange={(event) =>
          onChange({ ...criterion, text: event.target.value })
        }
      />
      <button
        type="button"
        aria-label="Remove criterion"
        className="rounded px-2 py-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}

import type { WorkItem } from "@parasor/shared";
import { useState } from "react";
import { DialogFooter, DialogHeader, DialogRoot } from "../primitives/index.js";

interface WorkItemPickerDialogProps {
  items: WorkItem[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (title: string) => Promise<void> | void;
  onOpen: (workItemId: string) => Promise<void> | void;
}

export function WorkItemPickerDialog({
  items,
  busy,
  error,
  onClose,
  onCreate,
  onOpen,
}: WorkItemPickerDialogProps) {
  const [title, setTitle] = useState("");

  return (
    <DialogRoot open ariaLabel="Open work item" onClose={onClose}>
      <DialogHeader title="Open work item" onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {items.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-secondary">Existing work items</p>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-secondary px-3 py-2 text-left hover:border-accent/60 disabled:opacity-50"
                onClick={() => void onOpen(item.id)}
              >
                <span className="min-w-0 truncate text-sm text-text-primary">
                  {item.title}
                </span>
                <span className="shrink-0 text-xs text-text-tertiary">
                  {item.status.replace("_", " ")}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-text-tertiary">
            No work items yet. Create the first one below.
          </p>
        )}
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          New work item title
          <input
            className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && title.trim() && !busy) {
                void onCreate(title.trim());
              }
            }}
          />
        </label>
        {error ? <p className="text-sm text-error">{error}</p> : null}
      </div>
      <DialogFooter>
        <button
          type="button"
          disabled={busy || !title.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void onCreate(title.trim())}
        >
          {busy ? "Opening…" : "Create and open"}
        </button>
      </DialogFooter>
    </DialogRoot>
  );
}

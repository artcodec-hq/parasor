import { useEffect, useMemo, useRef, useState } from "react";
import {
  type DiffFile,
  DiffHunkBody,
} from "../../features/panes/diff/diff-render.js";
import { ChevronRightIcon } from "../icons/index.js";
import {
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogRoot,
  PaGlyph,
} from "../primitives/index.js";

export interface CommitFileEntry {
  path: string;
  /** Single-letter porcelain status: 'M', 'A', 'D', 'R', '?', etc. */
  status: string;
  area?: "staged" | "unstaged" | "untracked";
  oldPath?: string;
  conflict?: boolean;
}

export interface CommitDialogProps {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  branchName: string | null;
  files: ReadonlyArray<CommitFileEntry>;
  isMobile: boolean;
  onClose: () => void;
  onCommit: (input: {
    message: string;
    paths: string[];
  }) => Promise<void> | void;
}

export const SUBJECT_LIMIT = 72;

function Caret({ open }: { open: boolean }) {
  return (
    <ChevronRightIcon
      className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
    />
  );
}

function statusTone(status: string): string {
  if (status === "U") return "text-danger";
  if (status === "?") return "text-text-secondary/70";
  if (status === "D") return "text-danger";
  if (status === "A") return "text-success";
  return "text-text-primary/85";
}

function fileTitle(file: CommitFileEntry): string {
  const parts = [file.path];
  if (file.oldPath) parts.push(`from ${file.oldPath}`);
  if (file.area) parts.push(file.area);
  if (file.conflict) parts.push("conflict");
  return parts.join(" · ");
}

export interface CommitBodyProps {
  files: ReadonlyArray<CommitFileEntry>;
  selected: Set<string>;
  toggle: (path: string) => void;
  toggleAll: (next: boolean) => void;
  message: string;
  setMessage: (next: string) => void;
  /**
   * Layout density. `inline` lets the file list grow to fill available
   * height and removes the message-textarea min-height clamp.
   */
  layout: "modal" | "sheet" | "inline";
  /**
   * Optional per-path diff data. When supplied, each file row shows a
   * caret that toggles inline diff display below the row. Caller is
   * responsible for parsing the diff and indexing it by file path.
   */
  diffsByPath?: ReadonlyMap<string, DiffFile>;
  onOpenFilePath?: (filePath: string) => void;
}

export function CommitBody({
  files,
  selected,
  toggle,
  toggleAll,
  message,
  setMessage,
  layout,
  diffsByPath,
  onOpenFilePath,
}: CommitBodyProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpand = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const allSelected = files.length > 0 && selected.size === files.length;
  const someSelected = selected.size > 0 && !allSelected;
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);
  useEffect(() => {
    if (layout !== "inline") messageRef.current?.focus();
  }, [layout]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`cm-scroll overflow-auto border-b border-border ${
          layout === "inline" ? "min-h-0 flex-1" : "flex-none"
        }`}
        style={
          layout === "inline"
            ? undefined
            : { maxHeight: layout === "sheet" ? 180 : 220 }
        }
      >
        <label className="flex h-7 cursor-pointer items-center gap-2.5 border-b border-border bg-bg-tertiary px-3 text-xs font-medium tracking-[0.04em] text-text-secondary uppercase">
          <input
            ref={headerCheckboxRef}
            type="checkbox"
            className="h-3.5 w-3.5 accent-accent"
            checked={allSelected}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          <span className="cm-mono">
            Selected · {selected.size} of {files.length}
          </span>
        </label>
        {files.map((f) => {
          const isSelected = selected.has(f.path);
          const fileDiff = diffsByPath?.get(f.path);
          const isExpanded = expanded.has(f.path);
          return (
            <div key={f.path}>
              <div
                className={`flex h-7 items-center gap-2.5 pl-3 pr-1 text-sm cm-mono ${
                  isSelected ? "text-text-primary" : "text-text-secondary"
                }`}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(f.path)}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  <span
                    className="cm-scroll-x min-w-0 flex-1"
                    title={fileTitle(f)}
                  >
                    {f.path}
                  </span>
                  {f.conflict && (
                    <span className="text-xs text-danger">conflict</span>
                  )}
                  <span className={`text-xs ${statusTone(f.status)}`}>
                    {f.status}
                  </span>
                </label>
                {onOpenFilePath && (
                  <button
                    type="button"
                    onClick={() => onOpenFilePath(f.path)}
                    aria-label={`Open ${f.path}`}
                    className="flex h-tap-sm w-tap-sm shrink-0 items-center justify-center rounded-control text-text-secondary hover:bg-row-hover-bg hover:text-text-primary"
                  >
                    <PaGlyph.doc />
                  </button>
                )}
                {fileDiff ? (
                  <button
                    type="button"
                    onClick={() => toggleExpand(f.path)}
                    aria-label={isExpanded ? "Collapse diff" : "Expand diff"}
                    aria-expanded={isExpanded}
                    className="flex h-tap-sm w-tap-sm shrink-0 items-center justify-center rounded-control text-text-secondary hover:bg-row-hover-bg hover:text-text-primary"
                  >
                    <Caret open={isExpanded} />
                  </button>
                ) : (
                  <span className="h-tap-sm w-tap-sm shrink-0" aria-hidden />
                )}
              </div>
              {isExpanded && fileDiff && (
                <div className="border-y border-border/60 bg-bg-secondary/40 py-1">
                  <DiffHunkBody hunks={fileDiff.hunks} />
                </div>
              )}
            </div>
          );
        })}
        {files.length === 0 && (
          <div className="px-3 py-3 text-sm text-text-secondary">
            No changes to commit.
          </div>
        )}
      </div>
      <div
        className={`flex flex-col gap-2 p-3 ${layout === "inline" ? "flex-none" : "min-h-0 flex-1"}`}
      >
        <span className="cm-mono text-xs tracking-[0.04em] text-text-secondary uppercase">
          Message
        </span>
        <textarea
          ref={messageRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={"Subject line\n\nDetails…"}
          className="cm-mono flex-1 resize-none rounded-control border border-border bg-bg-primary px-2.5 py-2 text-sm leading-snug text-text-primary outline-none focus:border-accent/60"
          style={{
            minHeight: layout === "sheet" ? 110 : layout === "modal" ? 150 : 96,
          }}
        />
      </div>
    </div>
  );
}

export function CommitDialog({
  open,
  busy = false,
  error,
  branchName,
  files,
  isMobile,
  onClose,
  onCommit,
}: CommitDialogProps) {
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const submitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setSelected(new Set(files.map((f) => f.path)));
  }, [open, files]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "Enter") {
        e.preventDefault();
        submitRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const trimmedMessage = message.trim();
  const canSubmit = !busy && trimmedMessage.length > 0 && selected.size > 0;
  const subjectOverflow = Math.max(
    0,
    (message.split("\n", 1)[0]?.length ?? 0) - SUBJECT_LIMIT,
  );

  function submit() {
    if (!canSubmit) return;
    void onCommit({
      message: trimmedMessage,
      paths: Array.from(selected),
    });
  }
  submitRef.current = submit;

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(files.map((f) => f.path)) : new Set());
  }

  const title = useMemo(
    () => (branchName ? `Commit · ${branchName}` : "Commit"),
    [branchName],
  );

  if (!open) return null;

  if (isMobile) {
    return (
      <DialogRoot
        open={open}
        presentation="sheet"
        onClose={onClose}
        ariaLabel={title}
      >
        <div className="flex h-[calc(80vh-1.5rem)] min-h-0 flex-col">
          <div className="flex h-8 flex-none items-center gap-2 border-b border-border px-3">
            <span className="cm-mono flex-1 truncate text-sm font-semibold">
              {title}
            </span>
            <DialogCloseButton onClick={onClose} />
          </div>
          <CommitBody
            files={files}
            selected={selected}
            toggle={toggle}
            toggleAll={toggleAll}
            message={message}
            setMessage={setMessage}
            layout="sheet"
          />
          {error && (
            <div className="border-t border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          <div className="flex flex-none flex-col gap-2 border-t border-border px-3 py-2.5">
            {subjectOverflow > 0 && (
              <span className="cm-mono text-xs text-danger">
                subject +{subjectOverflow} over
              </span>
            )}
            <DialogFooter layout="stack">
              <DialogButton
                variant="primary"
                onClick={submit}
                disabled={!canSubmit}
              >
                {busy ? "Committing…" : "Commit"}
              </DialogButton>
            </DialogFooter>
          </div>
        </div>
      </DialogRoot>
    );
  }

  return (
    <DialogRoot
      open={open}
      ariaLabel={title}
      onClose={onClose}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      panelClassName="flex max-h-[80vh] flex-col"
    >
      <div className="flex h-8 flex-none items-center gap-2 border-b border-border px-3">
        <span className="cm-mono flex-1 truncate text-sm font-semibold">
          {title}
        </span>
        <DialogCloseButton onClick={onClose} />
      </div>
      <CommitBody
        files={files}
        selected={selected}
        toggle={toggle}
        toggleAll={toggleAll}
        message={message}
        setMessage={setMessage}
        layout="modal"
      />
      <div className="border-t border-border px-3 py-2.5">
        {error && (
          <div
            role="alert"
            className="mb-2 rounded-control border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger"
          >
            {error}
          </div>
        )}
        <DialogFooter>
          {subjectOverflow > 0 && (
            <span className="cm-mono mr-auto text-xs text-danger">
              subject +{subjectOverflow} over
            </span>
          )}
          <DialogButton onClick={onClose} disabled={busy}>
            Cancel
          </DialogButton>
          <DialogButton
            variant="primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy
              ? "Committing…"
              : selected.size > 0
                ? `Commit ${selected.size}`
                : "Commit"}
          </DialogButton>
        </DialogFooter>
      </div>
    </DialogRoot>
  );
}

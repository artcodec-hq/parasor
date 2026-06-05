import { useEffect, useMemo, useRef, useState } from "react";
import {
  CommitBody,
  SUBJECT_LIMIT,
} from "../../../components/overlays/CommitDialog.js";
import {
  PaButton,
  PaGlyph,
  PaneFooter,
  PaneHeader,
} from "../../../components/primitives/index.js";
import { fetchDiff } from "../../../lib/git-api.js";
import { type DiffFile, parseDiff } from "../diff/diff-render.js";

export interface UncommittedFileEntry {
  path: string;
  status: string;
}

interface UncommittedPaneProps {
  projectId: string;
  worktreePath: string;
  /** Bumped by parent on filesystem change so we re-fetch the diff. */
  fileChangeSeq?: number;
  files: ReadonlyArray<UncommittedFileEntry>;
  busy: boolean;
  error: string | null;
  /** Called when user dismisses the inline error. */
  onClearError: () => void;
  onSubmit: (input: { message: string; paths: string[] }) => void;
}

/**
 * Right column of the Git pane when the "Working tree" row is selected in
 * the graph. Replaces the modal CommitDialog on desktop -- file list, commit
 * message and submit live inline so add/del is reachable from the same
 * surface as the graph. The modal CommitDialog stays around for mobile and
 * any place that opens commit out of context (⋯ menu, primary action on
 * very small viewports).
 */
export function UncommittedPane({
  projectId,
  worktreePath,
  fileChangeSeq,
  files,
  busy,
  error,
  onClearError,
  onSubmit,
}: UncommittedPaneProps) {
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(files.map((f) => f.path)),
  );
  const [rawDiff, setRawDiff] = useState("");
  const diffAbortRef = useRef<AbortController | null>(null);

  // Fetch the full uncommitted diff so each file row can expand to show
  // its hunks inline. One fetch covers all files; per-row expand only
  // gates the rendering. Re-runs when the worktree or filesystem state
  // (fileChangeSeq) changes.
  useEffect(() => {
    void fileChangeSeq;
    if (files.length === 0) {
      setRawDiff("");
      return;
    }
    diffAbortRef.current?.abort();
    const controller = new AbortController();
    diffAbortRef.current = controller;
    fetchDiff({ projectId, worktreePath }, controller.signal)
      .then((next) => {
        if (next === null || controller.signal.aborted) return;
        setRawDiff(next);
      })
      .catch(() => {
        // ignore (includes AbortError)
      });
    return () => {
      controller.abort();
    };
  }, [projectId, worktreePath, fileChangeSeq, files.length]);

  const diffsByPath = useMemo(() => {
    const map = new Map<string, DiffFile>();
    for (const f of parseDiff(rawDiff)) map.set(f.path, f);
    return map;
  }, [rawDiff]);

  // When the file list changes (new edit, save, file deleted), keep the
  // selection in sync -- auto-add brand-new entries, drop ones that vanished.
  // Avoids the user having to re-tick everything after saving another file.
  useEffect(() => {
    const present = new Set(files.map((f) => f.path));
    setSelected((prev) => {
      const next = new Set<string>();
      for (const p of prev) if (present.has(p)) next.add(p);
      // Pre-select newly appearing entries.
      for (const f of files) if (!prev.has(f.path)) next.add(f.path);
      return next;
    });
  }, [files]);

  const trimmedMessage = message.trim();
  const canSubmit = !busy && trimmedMessage.length > 0 && selected.size > 0;
  const subjectOverflow = Math.max(
    0,
    (message.split("\n", 1)[0]?.length ?? 0) - SUBJECT_LIMIT,
  );

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

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      message: trimmedMessage,
      paths: Array.from(selected),
    });
    setMessage("");
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary text-text-primary">
      <PaneHeader
        icon={<PaGlyph.diff />}
        iconTone="warning"
        title="Working tree"
      />

      {files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-text-secondary">
          No uncommitted changes.
        </div>
      ) : (
        <CommitBody
          files={files}
          selected={selected}
          toggle={toggle}
          toggleAll={toggleAll}
          message={message}
          setMessage={setMessage}
          layout="inline"
          diffsByPath={diffsByPath}
        />
      )}

      {error && (
        <div className="flex items-start gap-2 bg-danger/10 px-3 py-2 text-xs text-danger">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={onClearError}
            aria-label="Dismiss"
            className="text-danger/80 hover:text-danger"
          >
            <PaGlyph.close />
          </button>
        </div>
      )}

      <PaneFooter
        status={
          <>
            {selected.size}/{files.length} selected
            {subjectOverflow > 0 && (
              <span className="ml-3 text-danger">
                subject +{subjectOverflow} over
              </span>
            )}
          </>
        }
        actions={
          <PaButton
            kind="submit"
            onClick={submit}
            disabled={!canSubmit}
            className="shrink-0"
          >
            {busy ? "Committing…" : "Commit"}
          </PaButton>
        }
      />
    </div>
  );
}

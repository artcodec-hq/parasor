import type { GitCommit } from "@parasor/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PaGlyph, PaneHeader } from "../../../components/primitives/index.js";
import { fetchDiff as fetchGitDiff } from "../../../lib/git-api.js";
import { formatLocalDateTime } from "../../../lib/git-format.js";
import { DiffFileBlock, parseDiff } from "./diff-render.js";

interface DiffPaneProps {
  projectId: string;
  worktreePath: string;
  fileChangeSeq?: number;
  /** When set, the pane shows that commit's diff and metadata header. */
  commit?: GitCommit | null;
}

export function DiffPane({
  projectId,
  worktreePath,
  fileChangeSeq,
  commit,
}: DiffPaneProps) {
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(true);
  const isCommit = !!commit;
  const commitSha = commit?.sha ?? null;

  // Abort any in-flight fetch when worktreePath/commitSha change so a late
  // response from the previous selection cannot overwrite the diff for the
  // current one.
  const abortRef = useRef<AbortController | null>(null);
  const fetchDiff = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const next = await fetchGitDiff(
        {
          projectId,
          worktreePath,
          ...(commitSha ? { sha: commitSha } : {}),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (next !== null) {
        setDiff(next);
      }
    } catch {
      // ignore (includes AbortError)
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [projectId, worktreePath, commitSha]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void fileChangeSeq;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchDiff();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [fetchDiff, fileChangeSeq]);

  const files = useMemo(() => parseDiff(diff), [diff]);

  return (
    <div className="flex h-full flex-col bg-bg-primary text-text-primary">
      <PaneHeader
        icon={<PaGlyph.diff />}
        title={isCommit ? "Commit" : "Diff"}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {commit && <CommitMetadata commit={commit} />}
        {loading ? (
          <div className="cm-mono p-3 text-sm text-text-secondary">
            Loading...
          </div>
        ) : files.length === 0 ? (
          <div className="cm-mono p-3 text-sm text-text-secondary">
            No changes
          </div>
        ) : (
          files.map((file) => (
            <DiffFileBlock
              key={`${file.status}:${file.oldPath ?? ""}:${file.path}`}
              file={file}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CommitMetadata({ commit }: { commit: GitCommit }) {
  const sha = commit.sha.slice(0, 7);
  const time = formatLocalDateTime(commit.time);
  return (
    <div className="border-b border-border px-3 py-3">
      <div className="flex items-baseline gap-2 text-sm">
        <span
          className="cm-mono shrink-0 text-text-secondary/70"
          title={commit.sha}
        >
          {sha}
        </span>
        <span className="min-w-0 flex-1 break-words font-semibold text-text-primary">
          {commit.subject}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-text-secondary">
        <span title={commit.author}>{commit.author}</span>
        <span aria-hidden>·</span>
        <span className="cm-mono">{time}</span>
      </div>
    </div>
  );
}

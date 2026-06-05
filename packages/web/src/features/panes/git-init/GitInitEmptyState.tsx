import { useState } from "react";
import { PaButton } from "../../../components/primitives/index.js";
import { GitOperationError, initRepository } from "../../../lib/git-api.js";
import { showSyncToast } from "../../../lib/sync-toast.js";

interface GitInitEmptyStateProps {
  projectId: string;
  /**
   * Hint shown alongside the init button so the user knows which directory
   * the repository will live in. Cosmetic -- the actual path is the project
   * root on the server.
   */
  projectPath: string | null;
}

/**
 * Rendered in place of the Git split when the focused worktree has no
 * `.git/` directory. Offers a single "Initialize git repository" affordance
 * -- anything more elaborate (template selection, .gitignore prefill) belongs
 * in a future settings flow, not this empty-state.
 */
export function GitInitEmptyState({
  projectId,
  projectPath,
}: GitInitEmptyStateProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function init() {
    setBusy(true);
    setError(null);
    try {
      await initRepository(projectId);
      showSyncToast({
        tone: "ok",
        title: "Initialized git repository",
        sub: projectPath ?? undefined,
        mono: true,
        durationMs: 4000,
      });
    } catch (err) {
      const msg =
        err instanceof GitOperationError
          ? err.message
          : err instanceof Error
            ? err.message
            : "git init failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg-primary p-8 text-center">
      <div className="flex flex-col items-center gap-1">
        <span className="cm-mono text-sm font-semibold tracking-[-0.005em] text-text-primary">
          No git repository
        </span>
        <span className="text-sm text-text-secondary">
          This project is not a git repository yet.
        </span>
        {projectPath && (
          <span className="cm-mono mt-0.5 truncate text-xs text-text-secondary/70">
            {projectPath}
          </span>
        )}
      </div>
      <PaButton
        kind="submit"
        size="sm"
        onClick={() => void init()}
        disabled={busy}
      >
        {busy ? "Initializing…" : "Initialize git repository"}
      </PaButton>
      {error && (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

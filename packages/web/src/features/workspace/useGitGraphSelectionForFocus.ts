import { useEffect, useRef, useState } from "react";
import type { GitGraphSelection } from "../panes/git-graph/GitGraphPane.js";

/**
 * Inline git-graph selection that resets whenever the focused worktree
 * changes, so a stale `working-tree` selection from a different worktree
 * doesn't paint the wrong UncommittedPane on the new pane's first render.
 *
 * Tracked via a ref so biome's exhaustive-deps pass sees
 * `focusedWorktreePath` actually consumed in the effect body, not only as
 * a trigger dep -- matching the original inline implementation byte-for-byte.
 */
export function useGitGraphSelectionForFocus(
  focusedWorktreePath: string | null,
): readonly [
  GitGraphSelection | null,
  (next: GitGraphSelection | null) => void,
] {
  const [selection, setSelection] = useState<GitGraphSelection | null>(null);
  const prevFocusedWorktreeRef = useRef<string | null>(focusedWorktreePath);

  useEffect(() => {
    if (prevFocusedWorktreeRef.current !== focusedWorktreePath) {
      prevFocusedWorktreeRef.current = focusedWorktreePath;
      setSelection(null);
    }
  }, [focusedWorktreePath]);

  return [selection, setSelection] as const;
}

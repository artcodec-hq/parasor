/**
 * Worktree directory name shown as crumb[1] in `SessionPaneHeader` and as
 * the worktree label in `OpenContainerDialog`. Always derived from the
 * path, never the branch -- distinct from `focusedWorktreeName` which
 * prefers the live `gitState.branch` and falls back to the dir name only
 * when no branch is known.
 *
 * - `worktreePath === projectPath` -> the project root: `"main"` when the
 *   root is a git repo (the canonical default branch label, regardless
 *   of `HEAD`), `"root"` when the root has been confirmed not a repo
 *   (mirrors `buildSidebarProjects`'s `isRepo === false` convention).
 *   Pre-hydration / missing `gitState` ≡ treat as repo, so callers may
 *   default `projectIsRepo` to `true` until a `git-state` lands.
 * - otherwise -> the path basename with trailing slashes stripped,
 *   falling back to the raw path if basename extraction returns
 *   `undefined` (an empty / root-only path).
 */
export function resolveWorktreeDirName(
  worktreePath: string,
  projectPath: string,
  projectIsRepo: boolean,
): string {
  if (worktreePath === projectPath) {
    return projectIsRepo ? "main" : "root";
  }
  return worktreePath.replace(/\/+$/, "").split("/").pop() ?? worktreePath;
}

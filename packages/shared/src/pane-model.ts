/**
 * Worktree-scoped pane model.
 *
 * Replaces the legacy `PaneNode` split-tree in `panes.ts`. Both models
 * co-exist while consumers move to `ProjectState.worktrees`; older reducers
 * still read `ProjectState.layout`.
 */

export type PaneKind = "files" | "terminal" | "browser" | "git";

export interface FilesPaneState {
  kind: "files";
  selectedFilePath: string | null;
}

export interface TerminalPaneState {
  kind: "terminal";
  sessionId: string;
}

export interface BrowserPaneState {
  kind: "browser";
  url: string;
  /** true = created by auto port detection; false/undefined = user-opened. */
  auto?: boolean;
}

export interface GitPaneState {
  kind: "git";
  selectedCommitSha: string | null;
}

export type PaneState =
  | FilesPaneState
  | TerminalPaneState
  | BrowserPaneState
  | GitPaneState;

export interface PaneEntry {
  /** Singleton ids are deterministic: `files:<wtPath>` / `git:<wtPath>`. */
  id: string;
  kind: PaneKind;
  worktreePath: string;
  state: PaneState;
}

export interface WorktreePanes {
  path: string;
  /** true when this pane group represents a worktree path that disappeared. */
  orphan?: boolean;
  panes: PaneEntry[];
}

export function filesPaneId(worktreePath: string): string {
  return `files:${worktreePath}`;
}

export function gitPaneId(worktreePath: string): string {
  return `git:${worktreePath}`;
}

export function terminalPaneId(sessionId: string): string {
  return `terminal:${sessionId}`;
}

/**
 * Single shared default for the worktree split. Files and Git tabs persist
 * one ratio under the same `parasor:pane-ratio:worktree` localStorage key
 * so toggling tabs never reshuffles the split.
 */
export const DEFAULT_WORKTREE_RATIO: [number, number] = [35, 65];

export function makeFilesPane(worktreePath: string): PaneEntry {
  return {
    id: filesPaneId(worktreePath),
    kind: "files",
    worktreePath,
    state: {
      kind: "files",
      selectedFilePath: null,
    },
  };
}

export function makeGitPane(worktreePath: string): PaneEntry {
  return {
    id: gitPaneId(worktreePath),
    kind: "git",
    worktreePath,
    state: {
      kind: "git",
      selectedCommitSha: null,
    },
  };
}

export function makeTerminalPane(
  id: string,
  worktreePath: string,
  sessionId: string,
): PaneEntry {
  return {
    id,
    kind: "terminal",
    worktreePath,
    state: { kind: "terminal", sessionId },
  };
}

export function makeBrowserPane(
  id: string,
  worktreePath: string,
  url: string,
): PaneEntry {
  return {
    id,
    kind: "browser",
    worktreePath,
    state: { kind: "browser", url },
  };
}

/**
 * Canonical pane order: files -> terminals -> browsers -> git.
 * Terminals and browsers preserve insertion order.
 */
export function sortPanesForList(panes: PaneEntry[]): PaneEntry[] {
  const files = panes.filter((p) => p.kind === "files");
  const terminals = panes.filter((p) => p.kind === "terminal");
  const browsers = panes.filter((p) => p.kind === "browser");
  const git = panes.filter((p) => p.kind === "git");
  return [...files, ...terminals, ...browsers, ...git];
}

/**
 * Ensure a worktree has the two singletons (`files`, `git`). Leaves existing
 * terminals/browsers untouched. Returns a new array if a singleton was
 * inserted; otherwise returns the original reference.
 */
export function ensureSingletons(
  worktreePath: string,
  panes: PaneEntry[],
): PaneEntry[] {
  const hasFiles = panes.some((p) => p.kind === "files");
  const hasGit = panes.some((p) => p.kind === "git");
  if (hasFiles && hasGit) return panes;
  const next = [...panes];
  if (!hasFiles) next.unshift(makeFilesPane(worktreePath));
  if (!hasGit) next.push(makeGitPane(worktreePath));
  return next;
}

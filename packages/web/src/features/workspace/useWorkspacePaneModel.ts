import {
  ensureSingletons,
  filesPaneId,
  makeBrowserPane,
  makeTerminalPane,
  type PaneEntry,
  type Session,
  sortPanesForList,
  terminalPaneId,
  type Worktree,
  type WorktreePanes,
} from "@parasor/shared";
import { useMemo } from "react";

/**
 * Client-derived worktree-scoped pane model.
 *
 * Derivation rules:
 * - one `WorktreePanes` per entry from the AppStore-hydrated worktrees
 *   map (fallback: a single group at `projectPath` when empty), plus
 *   session cwd rows that are outside the known worktree list so active and
 *   inactive project sidebar projections do not disagree while worktree
 *   discovery is stale.
 * - `files`/`git` singletons are auto-inserted per worktree via
 *   `ensureSingletons`
 * - each live session -> one `terminal` pane with deterministic id
 *   `terminal:<sessionId>`, routed to the matching worktree by longest
 *   cwd-prefix (falls back to its own cwd when no known worktree contains it)
 * - browser panes come from `clientBrowserPanes`; entries map
 *   worktreePath -> list of `{ id, url }` and are routed only to worktrees
 *   still present in the active project's worktree list
 * - focus falls back to the files pane of the main worktree when the
 *   stored `focusedPaneId` no longer matches any pane (e.g. the session
 *   backing a terminal has ended since last load)
 */

export interface ClientBrowserPaneInput {
  id: string;
  url: string;
}

export interface WorkspacePaneModel {
  worktrees: WorktreePanes[];
  allPanes: PaneEntry[];
  paneById: Map<string, PaneEntry>;
  focusedPane: PaneEntry | null;
  /** The pane id to focus now -- may differ from `focusedPaneId` when stale. */
  effectiveFocusedPaneId: string | null;
}

interface UseWorkspacePaneModelOptions {
  projectId: string | null;
  projectPath: string | null;
  worktrees: Worktree[];
  sessions: Session[];
  focusedPaneId: string | null;
  /**
   * Per-worktree-path browser panes for the active project. Empty / omitted
   * yields no browser panes; entries pointing at worktree paths that no
   * longer exist in `worktrees` are silently dropped so a stale localStorage
   * payload from a removed worktree can't strand panes outside the model.
   */
  clientBrowserPanes?: Record<string, ClientBrowserPaneInput[]>;
}

export function useWorkspacePaneModel({
  projectId,
  projectPath,
  worktrees,
  sessions,
  focusedPaneId,
  clientBrowserPanes,
}: UseWorkspacePaneModelOptions): WorkspacePaneModel {
  return useMemo<WorkspacePaneModel>(() => {
    if (!projectId || !projectPath) {
      return {
        worktrees: [],
        allPanes: [],
        paneById: new Map(),
        focusedPane: null,
        effectiveFocusedPaneId: null,
      };
    }

    const projectSessions = sessions.filter((s) => s.projectId === projectId);
    const paths = resolveWorktreePaths(worktrees, projectPath, projectSessions);

    const groups: WorktreePanes[] = paths.map((path) => ({
      path,
      panes: [],
    }));

    for (const session of projectSessions) {
      const wtPath = findMatchingWorktreePath(session.cwd, paths, projectPath);
      const group = groups.find((g) => g.path === wtPath);
      if (!group) continue;
      group.panes.push(
        makeTerminalPane(terminalPaneId(session.id), wtPath, session.id),
      );
    }

    if (clientBrowserPanes) {
      for (const group of groups) {
        const entries = clientBrowserPanes[group.path];
        if (!entries) continue;
        for (const entry of entries) {
          group.panes.push(makeBrowserPane(entry.id, group.path, entry.url));
        }
      }
    }

    for (const group of groups) {
      group.panes = sortPanesForList(ensureSingletons(group.path, group.panes));
    }

    const allPanes = groups.flatMap((g) => g.panes);
    const paneById = new Map(allPanes.map((p) => [p.id, p]));

    const fallback =
      paneById.get(filesPaneId(projectPath)) ?? allPanes[0] ?? null;
    const focused = focusedPaneId
      ? (paneById.get(focusedPaneId) ?? null)
      : null;
    const focusedPane = focused ?? fallback;

    return {
      worktrees: groups,
      allPanes,
      paneById,
      focusedPane,
      effectiveFocusedPaneId: focusedPane?.id ?? null,
    };
  }, [
    projectId,
    projectPath,
    worktrees,
    sessions,
    focusedPaneId,
    clientBrowserPanes,
  ]);
}

function resolveWorktreePaths(
  worktrees: Worktree[],
  projectPath: string,
  sessions: Session[],
): string[] {
  // Ensure projectPath (main worktree) is first, then linked worktrees.
  // `git worktree list --porcelain` already orders it that way but guard
  // against divergence defensively.
  const ordered =
    worktrees.length > 0
      ? [...worktrees]
      : [
          {
            path: projectPath,
            head: "",
            branch: null,
            ahead: 0,
            behind: 0,
            dirtyCount: 0,
          },
        ];
  ordered.sort((a, b) => {
    if (a.path === projectPath) return -1;
    if (b.path === projectPath) return 1;
    return 0;
  });
  const paths = ordered.map((w) => w.path);
  for (const session of sessions) {
    if (findContainingWorktreePath(session.cwd, paths)) continue;
    if (!paths.includes(session.cwd)) paths.push(session.cwd);
  }
  return paths;
}

function findMatchingWorktreePath(
  cwd: string,
  paths: string[],
  fallback: string,
): string {
  const match = findContainingWorktreePath(cwd, paths);
  if (match) return match;
  if (paths.includes(cwd)) return cwd;
  if (!cwd.startsWith(`${fallback}/`)) return cwd;
  return fallback;
}

function findContainingWorktreePath(
  cwd: string,
  paths: string[],
): string | null {
  const matches = paths
    .filter((p) => cwd === p || cwd.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length);
  return matches[0] ?? null;
}

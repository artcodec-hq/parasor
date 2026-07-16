import { randomUUID } from "node:crypto";
import {
  ensureSingletons,
  makeBrowserPane,
  makeTerminalPane,
  makeWorkItemPane,
  type PaneEntry,
  type WorktreePanes,
} from "@parasor/shared";
import type { AppStateStore } from "../../state/app-state.js";
import type { ProjectManager } from "../../state/project-manager.js";
import type { EventPublisher } from "../ports.js";
import { WorkItemNotFoundError, WorkspaceNotFoundError } from "./errors.js";

/**
 * Worktree-scoped pane ops. Thin wrappers over
 * `AppStateStore.mutate` that keep `ProjectState.worktrees` in sync and
 * broadcast a single `panes-updated` per change.
 *
 * `setWorktrees` is the reconciler: when the server detects git worktrees
 * for a project it replaces the previous list, auto-inserting the `files`
 * + `git` singletons per worktree. Terminal / browser panes are preserved
 * by path match; if a worktree path disappears, its non-singleton panes
 * are dropped (caller is expected to have already closed backing
 * sessions).
 */

interface CreatePaneCommandsDeps {
  appStateStore: AppStateStore;
  eventBus: EventPublisher;
  projectManager: ProjectManager;
}

export function createPaneCommands({
  appStateStore,
  eventBus,
  projectManager,
}: CreatePaneCommandsDeps) {
  function broadcastPanes(projectId: string) {
    const state = appStateStore.get();
    const ps = state.projectStates[projectId];
    if (!ps) return;
    eventBus.broadcast({
      type: "panes-updated",
      projectId,
      worktrees: ps.worktrees,
      focusedPaneId: ps.focusedPaneId,
    });
  }

  function requireProject(id: string) {
    const project = projectManager.get(id);
    if (!project) throw new WorkspaceNotFoundError();
    return project;
  }

  return {
    /**
     * Replace the worktree list. Preserves existing terminal/browser panes
     * for worktrees whose path remains, drops panes for removed paths, and
     * re-ensures `files` + `git` singletons per worktree.
     */
    setWorktrees(projectId: string, paths: string[]) {
      requireProject(projectId);
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        const prev = new Map(ps.worktrees.map((w) => [w.path, w.panes]));
        ps.worktrees = paths.map<WorktreePanes>((path) => ({
          path,
          panes: ensureSingletons(path, prev.get(path) ?? []),
        }));
        const validIds = new Set(
          ps.worktrees.flatMap((w) => w.panes.map((p) => p.id)),
        );
        if (ps.focusedPaneId && !validIds.has(ps.focusedPaneId)) {
          ps.focusedPaneId = null;
        }
      });
      broadcastPanes(projectId);
    },

    addTerminalPane(
      projectId: string,
      worktreePath: string,
      sessionId: string,
    ): PaneEntry {
      requireProject(projectId);
      const id = `terminal:${randomUUID()}`;
      const pane = makeTerminalPane(id, worktreePath, sessionId);
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        const wt = ps.worktrees.find((w) => w.path === worktreePath);
        if (!wt) return;
        // Insert after existing terminals, before browsers/git.
        const lastTermIdx = lastIndex(wt.panes, (p) => p.kind === "terminal");
        const firstBrowserIdx = wt.panes.findIndex((p) => p.kind === "browser");
        const insertAt =
          lastTermIdx >= 0
            ? lastTermIdx + 1
            : firstBrowserIdx >= 0
              ? firstBrowserIdx
              : Math.max(
                  0,
                  wt.panes.findIndex((p) => p.kind === "git"),
                );
        wt.panes.splice(insertAt, 0, pane);
        ps.focusedPaneId = pane.id;
      });
      broadcastPanes(projectId);
      return pane;
    },

    addWorkItemPane(
      projectId: string,
      worktreePath: string,
      workItemId: string,
    ): PaneEntry {
      requireProject(projectId);
      const itemExists = (appStateStore.get().workItems[projectId] ?? []).some(
        (item) => item.id === workItemId,
      );
      if (!itemExists) throw new WorkItemNotFoundError();

      let result: PaneEntry | undefined;
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        let wt = ps.worktrees.find((entry) => entry.path === worktreePath);
        if (!wt) {
          wt = {
            path: worktreePath,
            panes: ensureSingletons(worktreePath, []),
          };
          ps.worktrees.push(wt);
        }
        const existing = wt.panes.find(
          (pane) =>
            pane.state.kind === "work-item" &&
            pane.state.workItemId === workItemId,
        );
        if (existing) {
          result = existing;
          ps.focusedPaneId = existing.id;
          return;
        }
        const pane = makeWorkItemPane(
          `work-item:${randomUUID()}`,
          worktreePath,
          workItemId,
        );
        const firstNonWorkItem = wt.panes.findIndex(
          (candidate) =>
            candidate.kind === "terminal" ||
            candidate.kind === "browser" ||
            candidate.kind === "git",
        );
        wt.panes.splice(
          firstNonWorkItem >= 0 ? firstNonWorkItem : wt.panes.length,
          0,
          pane,
        );
        ps.focusedPaneId = pane.id;
        result = pane;
      });
      if (!result) throw new WorkspaceNotFoundError();
      broadcastPanes(projectId);
      return result;
    },

    addBrowserPane(
      projectId: string,
      worktreePath: string,
      url: string,
    ): PaneEntry {
      requireProject(projectId);
      const id = `browser:${randomUUID()}`;
      const pane = makeBrowserPane(id, worktreePath, url);
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        const wt = ps.worktrees.find((w) => w.path === worktreePath);
        if (!wt) return;
        const gitIdx = wt.panes.findIndex((p) => p.kind === "git");
        const insertAt = gitIdx >= 0 ? gitIdx : wt.panes.length;
        wt.panes.splice(insertAt, 0, pane);
        ps.focusedPaneId = pane.id;
      });
      broadcastPanes(projectId);
      return pane;
    },

    /**
     * Close a work-item, terminal, or browser pane. Singletons (`files`/`git`) cannot
     * be closed; the call is a no-op for those ids to keep callers simple.
     */
    closePane(projectId: string, paneId: string) {
      requireProject(projectId);
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        for (const wt of ps.worktrees) {
          const idx = wt.panes.findIndex((p) => p.id === paneId);
          if (idx === -1) continue;
          const target = wt.panes[idx];
          if (target.kind === "files" || target.kind === "git") return;
          wt.panes.splice(idx, 1);
          if (ps.focusedPaneId === paneId) {
            ps.focusedPaneId = wt.panes[0]?.id ?? null;
          }
          return;
        }
      });
      broadcastPanes(projectId);
    },

    closeWorkItemPane(projectId: string, paneId: string): boolean {
      requireProject(projectId);
      let closed = false;
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        for (const wt of ps.worktrees) {
          const idx = wt.panes.findIndex((pane) => pane.id === paneId);
          if (idx === -1) continue;
          if (wt.panes[idx].state.kind !== "work-item") return;
          wt.panes.splice(idx, 1);
          closed = true;
          if (ps.focusedPaneId === paneId) {
            ps.focusedPaneId = wt.panes[0]?.id ?? null;
          }
          return;
        }
      });
      if (closed) broadcastPanes(projectId);
      return closed;
    },

    focusPane(projectId: string, paneId: string | null) {
      requireProject(projectId);
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        if (paneId === null) {
          ps.focusedPaneId = null;
          return;
        }
        const exists = ps.worktrees.some((w) =>
          w.panes.some((p) => p.id === paneId),
        );
        if (exists) ps.focusedPaneId = paneId;
      });
      broadcastPanes(projectId);
    },

    updateFilesPaneState(
      projectId: string,
      paneId: string,
      partial: { selectedFilePath?: string | null },
    ) {
      requireProject(projectId);
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        const pane = findPane(ps.worktrees, paneId);
        if (!pane || pane.state.kind !== "files") return;
        if (partial.selectedFilePath !== undefined) {
          pane.state.selectedFilePath = partial.selectedFilePath;
        }
      });
      broadcastPanes(projectId);
    },

    updateGitPaneState(
      projectId: string,
      paneId: string,
      partial: { selectedCommitSha?: string | null },
    ) {
      requireProject(projectId);
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        const pane = findPane(ps.worktrees, paneId);
        if (!pane || pane.state.kind !== "git") return;
        if (partial.selectedCommitSha !== undefined) {
          pane.state.selectedCommitSha = partial.selectedCommitSha;
        }
      });
      broadcastPanes(projectId);
    },

    updateBrowserPaneState(projectId: string, paneId: string, url: string) {
      requireProject(projectId);
      appStateStore.mutateProjectStates((state) => {
        const ps = state.projectStates[projectId];
        if (!ps) return;
        const pane = findPane(ps.worktrees, paneId);
        if (!pane || pane.state.kind !== "browser") return;
        pane.state.url = url;
      });
      broadcastPanes(projectId);
    },
  };
}

export type PaneCommands = ReturnType<typeof createPaneCommands>;

function findPane(
  worktrees: WorktreePanes[],
  paneId: string,
): PaneEntry | undefined {
  for (const wt of worktrees) {
    const found = wt.panes.find((p) => p.id === paneId);
    if (found) return found;
  }
  return undefined;
}

function lastIndex<T>(arr: T[], pred: (value: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

import type {
  UpdateWorkItemInput,
  WorkItem,
  WorktreePanes,
} from "@parasor/shared";
import { useCallback, useMemo, useState } from "react";
import type { WorkspaceRoute } from "../../lib/workspace-route.js";
import {
  closeWorkItemPane,
  createWorkItem,
  deleteWorkItem,
  openWorkItemPane,
  updateWorkItem,
} from "./work-item-api.js";

export interface WorkItemPickerTarget {
  projectId: string;
  worktreePath: string;
}

interface Options {
  itemsByProject: Record<string, WorkItem[]>;
  navigate: (route: WorkspaceRoute, opts?: { replace?: boolean }) => void;
  removeItem: (projectId: string, workItemId: string) => void;
  seedItem: (item: WorkItem) => void;
  seedPanes: (
    projectId: string,
    worktrees: WorktreePanes[],
    focusedPaneId: string | null,
  ) => void;
  setActiveProjectId: (projectId: string) => void;
  setFocusedPaneId: (paneId: string) => void;
}

export function useWorkItemPaneActions({
  itemsByProject,
  navigate,
  removeItem,
  seedItem,
  seedPanes,
  setActiveProjectId,
  setFocusedPaneId,
}: Options) {
  const [target, setTarget] = useState<WorkItemPickerTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(
    () => (target ? (itemsByProject[target.projectId] ?? []) : []),
    [itemsByProject, target],
  );

  const openTargetPane = useCallback(
    async (pickerTarget: WorkItemPickerTarget, workItemId: string) => {
      const snapshot = await openWorkItemPane(
        pickerTarget.projectId,
        workItemId,
        pickerTarget.worktreePath,
      );
      seedPanes(
        pickerTarget.projectId,
        snapshot.worktrees,
        snapshot.focusedPaneId,
      );
      setActiveProjectId(pickerTarget.projectId);
      setFocusedPaneId(snapshot.pane.id);
      navigate({
        kind: "pane",
        projectId: pickerTarget.projectId,
        paneId: snapshot.pane.id,
      });
      setTarget(null);
    },
    [navigate, seedPanes, setActiveProjectId, setFocusedPaneId],
  );

  const open = useCallback(
    async (workItemId: string) => {
      if (!target) return;
      setBusy(true);
      setError(null);
      try {
        await openTargetPane(target, workItemId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not open.");
      } finally {
        setBusy(false);
      }
    },
    [openTargetPane, target],
  );

  const create = useCallback(
    async (title: string) => {
      if (!target) return;
      setBusy(true);
      setError(null);
      try {
        const item = await createWorkItem(target.projectId, {
          title,
          primaryWorktreePath: target.worktreePath,
        });
        seedItem(item);
        await openTargetPane(target, item.id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not create.");
      } finally {
        setBusy(false);
      }
    },
    [openTargetPane, seedItem, target],
  );

  return {
    picker: {
      target,
      items,
      busy,
      error,
      open: (projectId: string, worktreeId: string) => {
        setError(null);
        setTarget({
          projectId,
          worktreePath: worktreeId.startsWith("wt:")
            ? worktreeId.slice(3)
            : worktreeId,
        });
      },
      close: () => setTarget(null),
      create,
      select: open,
    },
    closePane: async (projectId: string, paneId: string) => {
      const snapshot = await closeWorkItemPane(projectId, paneId);
      seedPanes(projectId, snapshot.worktrees, snapshot.focusedPaneId);
    },
    update: async (
      projectId: string,
      workItemId: string,
      input: UpdateWorkItemInput,
    ) => {
      seedItem(await updateWorkItem(projectId, workItemId, input));
    },
    delete: async (projectId: string, workItemId: string) => {
      await deleteWorkItem(projectId, workItemId);
      navigate({ kind: "root" });
      removeItem(projectId, workItemId);
    },
  };
}

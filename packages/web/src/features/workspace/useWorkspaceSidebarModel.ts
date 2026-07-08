import type {
  AgentState,
  GitState,
  Project,
  ProjectSidebarState,
  ProjectSidebarStatePatch,
  ProjectState,
  RuntimeServiceInfo,
  Session,
  Worktree,
} from "@parasor/shared";
import {
  applyProjectSidebarStatePatch,
  normalizeProjectSidebarState,
} from "@parasor/shared";
import { useCallback, useMemo, useRef } from "react";
import {
  applyPaneOrderOverrides,
  buildSidebarProjects,
  readClientBrowserChildPanes,
  type SidebarProject,
} from "../../components/sidebar/index.js";
import { saveProjectSidebarState } from "./sidebar-state-api.js";
import type { AttentionDismissals } from "./useAttentionDismissals.js";
import { useLegacySidebarStateMigration } from "./useLegacySidebarStateMigration.js";
import { useProjectReorder } from "./useProjectReorder.js";
import type { WorkspacePaneModel } from "./useWorkspacePaneModel.js";

interface UseWorkspaceSidebarModelOptions {
  activeProjectId: string | null;
  activeWorktrees: WorkspacePaneModel["worktrees"];
  agentStates: Record<string, AgentState>;
  attentionDismissed: AttentionDismissals;
  gitStates: Record<string, Record<string, GitState | null>>;
  hydrated: boolean;
  projectStates: Record<string, ProjectState>;
  projects: Project[];
  reviewPendingSessions: Set<string>;
  seedSidebarState: (projectId: string, sidebar: ProjectSidebarState) => void;
  services: Record<string, RuntimeServiceInfo[]>;
  sessions: Session[];
  setErrorToast: (message: string) => void;
  worktreesWithCounters: Record<string, Worktree[]>;
}

export function useWorkspaceSidebarModel({
  activeProjectId,
  activeWorktrees,
  agentStates,
  attentionDismissed,
  gitStates,
  hydrated,
  projectStates,
  projects,
  reviewPendingSessions,
  seedSidebarState,
  services,
  sessions,
  setErrorToast,
  worktreesWithCounters,
}: UseWorkspaceSidebarModelOptions) {
  const {
    reorderResetSignal,
    pendingProjectReorderCount,
    reorder: reorderProjects,
  } = useProjectReorder({ onError: setErrorToast });

  const patchProjectSidebarState = useCallback(
    (
      projectId: string,
      patch: ProjectSidebarStatePatch,
      errorMessage: string,
    ) => {
      const previous = normalizeProjectSidebarState(
        projectStates[projectId]?.sidebar,
      );
      const next = applyProjectSidebarStatePatch(previous, patch);
      seedSidebarState(projectId, next);
      const request = saveProjectSidebarState(projectId, patch);
      void request.catch(() => {
        seedSidebarState(projectId, previous);
        setErrorToast(errorMessage);
      });
      return request;
    },
    [projectStates, seedSidebarState, setErrorToast],
  );

  const sidebarProjects = useMemo(() => {
    return applyPaneOrderOverrides(
      buildSidebarProjects({
        projects,
        activeProjectId,
        activeWorktrees,
        sessions,
        agentStates,
        reviewPendingSessions,
        worktreesByProject: worktreesWithCounters,
        gitStates,
        servicesByProject: services,
        attentionDismissed,
        inactiveChildPanesByProject: readClientBrowserChildPanes(projects),
      }),
      projectStates,
    );
  }, [
    activeProjectId,
    activeWorktrees,
    agentStates,
    attentionDismissed,
    gitStates,
    projectStates,
    projects,
    reviewPendingSessions,
    services,
    sessions,
    worktreesWithCounters,
  ]);

  const sidebarProjectsRef = useRef<SidebarProject[]>(sidebarProjects);
  sidebarProjectsRef.current = sidebarProjects;

  const reorderPanes = useCallback(
    (projectId: string, worktreePath: string, childIds: string[]) => {
      const current = normalizeProjectSidebarState(
        projectStates[projectId]?.sidebar,
      );
      const validPaths =
        sidebarProjectsRef.current
          .find((p) => p.id === projectId)
          ?.worktrees.map((w) => w.path) ?? [];
      const allowed = new Set(validPaths);
      allowed.add(worktreePath);
      const paneOrder: NonNullable<ProjectSidebarStatePatch["paneOrder"]> = {};
      for (const path of Object.keys(current.paneOrder)) {
        if (!allowed.has(path)) paneOrder[path] = null;
      }
      paneOrder[worktreePath] = childIds;
      patchProjectSidebarState(
        projectId,
        { paneOrder },
        "Failed to save pane order",
      );
    },
    [patchProjectSidebarState, projectStates],
  );

  const setWorktreeOpen = useCallback(
    (projectId: string, worktreePath: string, open: boolean) => {
      patchProjectSidebarState(
        projectId,
        { worktreeOpen: { [worktreePath]: open } },
        "Failed to save sidebar open state",
      );
    },
    [patchProjectSidebarState],
  );

  useLegacySidebarStateMigration({
    hydrated,
    projects: sidebarProjects,
    projectStates,
    onMigrate: (projectId, patch) =>
      patchProjectSidebarState(
        projectId,
        patch,
        "Failed to migrate sidebar state",
      ),
  });

  const worktreeOpenByProject = useMemo(() => {
    const out: Record<string, ProjectSidebarState["worktreeOpen"]> = {};
    for (const project of projects) {
      out[project.id] = normalizeProjectSidebarState(
        projectStates[project.id]?.sidebar,
      ).worktreeOpen;
    }
    return out;
  }, [projects, projectStates]);

  return {
    pendingProjectReorderCount,
    reorderPanes,
    reorderProjects,
    reorderResetSignal,
    setWorktreeOpen,
    sidebarProjects,
    worktreeOpenByProject,
  };
}

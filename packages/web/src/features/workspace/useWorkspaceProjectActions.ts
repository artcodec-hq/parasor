import type { Project } from "@parasor/shared";
import { useCallback } from "react";
import { authFetch } from "../../lib/auth-fetch.js";

interface UseWorkspaceProjectActionsOptions {
  activeProjectId: string | null;
  projects: Project[];
  setActiveProjectId: (id: string | null) => void;
  /** Optimistic local seed; closes the WS-broadcast gap after POST. */
  seedProject?: (project: Project) => void;
}

export function useWorkspaceProjectActions({
  activeProjectId,
  projects,
  setActiveProjectId,
  seedProject,
}: UseWorkspaceProjectActionsOptions) {
  const createProject = useCallback(
    async (path: string, name?: string) => {
      const res = await authFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name }),
      });
      if (res.ok) {
        const project = (await res.json()) as Project;
        seedProject?.(project);
        setActiveProjectId(project.id);
      }
    },
    [seedProject, setActiveProjectId],
  );

  const renameProject = useCallback(async (id: string, name: string) => {
    await authFetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }, []);

  const deleteProject = useCallback(
    async (id: string) => {
      await authFetch(`/api/projects/${id}?force=true`, { method: "DELETE" });
      if (activeProjectId === id) {
        const next = projects.find((p) => p.id !== id);
        setActiveProjectId(next?.id ?? null);
      }
    },
    [activeProjectId, projects, setActiveProjectId],
  );

  const pinProject = useCallback(
    async (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      await authFetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !project.pinned }),
      });
    },
    [projects],
  );

  const toggleProjectReadOnly = useCallback(
    async (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      await authFetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readOnly: !project.readOnly }),
      });
    },
    [projects],
  );

  return {
    createProject,
    deleteProject,
    pinProject,
    renameProject,
    toggleProjectReadOnly,
  };
}

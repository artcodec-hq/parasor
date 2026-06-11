import type { ProjectSidebarStatePatch } from "@parasor/shared";
import { authFetch } from "../../lib/auth-fetch.js";

export async function saveProjectSidebarState(
  projectId: string,
  patch: ProjectSidebarStatePatch,
): Promise<void> {
  const res = await authFetch(`/api/projects/${projectId}/sidebar-state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to save sidebar state");
}

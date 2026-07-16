import type {
  CreateWorkItemInput,
  PaneEntry,
  UpdateWorkItemInput,
  WorkItem,
  WorktreePanes,
} from "@parasor/shared";
import { authFetch } from "../../lib/auth-fetch.js";

export interface PaneSnapshot {
  worktrees: WorktreePanes[];
  focusedPaneId: string | null;
}

export async function createWorkItem(
  projectId: string,
  input: CreateWorkItemInput,
): Promise<WorkItem> {
  const response = await request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return (await response.json()).workItem;
}

export async function updateWorkItem(
  projectId: string,
  workItemId: string,
  input: UpdateWorkItemInput,
): Promise<WorkItem> {
  const response = await request(
    `/api/projects/${projectId}/work-items/${workItemId}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return (await response.json()).workItem;
}

export async function deleteWorkItem(
  projectId: string,
  workItemId: string,
): Promise<void> {
  await request(`/api/projects/${projectId}/work-items/${workItemId}`, {
    method: "DELETE",
  });
}

export async function openWorkItemPane(
  projectId: string,
  workItemId: string,
  worktreePath: string,
): Promise<PaneSnapshot & { pane: PaneEntry }> {
  const response = await request(
    `/api/projects/${projectId}/work-items/${workItemId}/panes`,
    { method: "POST", body: JSON.stringify({ worktreePath }) },
  );
  return response.json();
}

export async function closeWorkItemPane(
  projectId: string,
  paneId: string,
): Promise<PaneSnapshot> {
  const response = await request(
    `/api/projects/${projectId}/work-item-panes/${encodeURIComponent(paneId)}`,
    { method: "DELETE" },
  );
  return response.json();
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const response = await authFetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (response.ok) return response;
  const body = await response.json().catch(() => null);
  throw new Error(
    body && typeof body.error === "string" ? body.error : "Request failed",
  );
}

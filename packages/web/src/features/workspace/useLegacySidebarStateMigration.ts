import {
  normalizeProjectSidebarState,
  type ProjectSidebarStatePatch,
  type ProjectState,
} from "@parasor/shared";
import { useEffect, useRef } from "react";
import type { SidebarProject } from "../../components/sidebar/index.js";
import { parsePaneOrderStore } from "../../lib/pane-order-store.js";

const WORKTREE_DISCLOSURE_STORAGE_PREFIX = "parasor:sidebar:worktree-open";

interface UseLegacySidebarStateMigrationOptions {
  hydrated: boolean;
  projects: SidebarProject[];
  projectStates: Record<string, ProjectState>;
  onMigrate: (
    projectId: string,
    patch: ProjectSidebarStatePatch,
  ) => Promise<void>;
}

export function useLegacySidebarStateMigration({
  hydrated,
  projects,
  projectStates,
  onMigrate,
}: UseLegacySidebarStateMigrationOptions) {
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current || !hydrated) return;
    attemptedRef.current = true;

    for (const project of projects) {
      const worktrees = Array.isArray(project.worktrees)
        ? project.worktrees
        : [];
      const validPaths = new Set(
        worktrees.length > 0 ? worktrees.map((wt) => wt.path) : [project.path],
      );
      const server = normalizeProjectSidebarState(
        projectStates[project.id]?.sidebar,
      );
      const patch: ProjectSidebarStatePatch = {};

      if (Object.keys(server.paneOrder).length === 0) {
        const paneOrder = readLegacyPaneOrder(project.id, validPaths);
        if (Object.keys(paneOrder).length > 0) patch.paneOrder = paneOrder;
      }

      if (Object.keys(server.worktreeOpen).length === 0) {
        const worktreeOpen = readLegacyWorktreeOpen(project.id, validPaths);
        if (Object.keys(worktreeOpen).length > 0) {
          patch.worktreeOpen = worktreeOpen;
        }
      }

      if (!patch.paneOrder && !patch.worktreeOpen) continue;
      void onMigrate(project.id, patch).then(() => {
        removeLegacySidebarState(project.id);
      });
    }
  }, [hydrated, onMigrate, projectStates, projects]);
}

function readLegacyPaneOrder(
  projectId: string,
  validPaths: ReadonlySet<string>,
): NonNullable<ProjectSidebarStatePatch["paneOrder"]> {
  const raw = safeGet(`paneOrder:${projectId}`);
  const parsed = parsePaneOrderStore(raw);
  const out: NonNullable<ProjectSidebarStatePatch["paneOrder"]> = {};
  for (const [path, ids] of Object.entries(parsed)) {
    if (validPaths.has(path)) out[path] = ids;
  }
  return out;
}

function readLegacyWorktreeOpen(
  projectId: string,
  validPaths: ReadonlySet<string>,
): NonNullable<ProjectSidebarStatePatch["worktreeOpen"]> {
  const raw = safeGet(`${WORKTREE_DISCLOSURE_STORAGE_PREFIX}:${projectId}`);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out: NonNullable<ProjectSidebarStatePatch["worktreeOpen"]> = {};
  for (const [path, open] of Object.entries(parsed)) {
    if (validPaths.has(path) && typeof open === "boolean") out[path] = open;
  }
  return out;
}

function removeLegacySidebarState(projectId: string): void {
  try {
    globalThis.localStorage.removeItem(`paneOrder:${projectId}`);
    globalThis.localStorage.removeItem(
      `${WORKTREE_DISCLOSURE_STORAGE_PREFIX}:${projectId}`,
    );
  } catch {
    // localStorage unavailable; migration has already reached the server.
  }
}

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

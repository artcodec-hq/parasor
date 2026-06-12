import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  createEmptyProjectSidebarState,
  normalizeWorktreeLocalFileAllowlist,
  type Project,
  type Session,
} from "@parasor/shared";
import { expandUserHome } from "../lib/path.js";
import type { AppStateStore } from "./app-state.js";

export interface CreateProjectOpts {
  path: string;
  name?: string;
}

export interface UpdateProjectOpts {
  name?: string;
  pinned?: boolean;
  readOnly?: boolean;
  worktreeLocalFileAllowlist?: string[];
}

export class ProjectManager {
  constructor(private readonly store: AppStateStore) {}

  create(opts: CreateProjectOpts): Project {
    const path = expandUserHome(opts.path);
    const existing = this.store.get().projects.find((p) => p.path === path);
    if (existing) return existing;

    const now = Date.now();
    const project: Project = {
      id: randomUUID(),
      name: opts.name ?? basename(path),
      path,
      createdAt: now,
      lastAccessedAt: now,
    };

    this.store.mutateProjects((s) => {
      s.projects.push(project);
      s.projectStates[project.id] = {
        projectId: project.id,
        layout: null,
        worktrees: [],
        openFiles: [],
        lastFocusedPaneId: null,
        focusedPaneId: null,
        sidebar: createEmptyProjectSidebarState(),
        worktreeMetadata: {},
        lastAccessedAt: now,
      };
    });

    return project;
  }

  list(): Project[] {
    return [...this.store.get().projects];
  }

  get(id: string): Project | undefined {
    return this.store.get().projects.find((p) => p.id === id);
  }

  update(id: string, opts: UpdateProjectOpts): Project | undefined {
    let result: Project | undefined;

    this.store.mutateProjects((s) => {
      const idx = s.projects.findIndex((p) => p.id === id);
      if (idx === -1) return;

      const project = s.projects[idx];
      if (opts.name !== undefined) project.name = opts.name;
      if (opts.pinned !== undefined) project.pinned = opts.pinned;
      if (opts.readOnly !== undefined) project.readOnly = opts.readOnly;
      if (opts.worktreeLocalFileAllowlist !== undefined) {
        project.worktreeLocalFileAllowlist =
          normalizeWorktreeLocalFileAllowlist(opts.worktreeLocalFileAllowlist);
      }

      result = project;
    });

    return result;
  }

  delete(id: string, force = false): boolean {
    const project = this.get(id);
    if (!project) return false;
    if (project.pinned && !force) return false;

    this.store.mutateProjects((s) => {
      s.projects = s.projects.filter((p) => p.id !== id);
      delete s.projectStates[id];
    });
    /*
     * daemon state ownership -- orphan-session cleanup is cross-domain (sessions are
     * daemon-owned in remote mode). Use internalMutate so the call
     * succeeds in both modes: in-process flushes the filtered list,
     * remote applies mirror-only (daemon's own SESSION_LIST broadcast
     * is the source of truth there).
     */
    this.store.internalMutate((s) => {
      s.sessions = s.sessions.filter((sess) => sess.projectId !== id);
    });

    return true;
  }

  getProjectSessions(projectId: string): Session[] {
    return this.store.get().sessions.filter((s) => s.projectId === projectId);
  }

  touchProject(id: string): void {
    const now = Date.now();
    this.store.mutateProjects((s) => {
      const project = s.projects.find((p) => p.id === id);
      if (project) project.lastAccessedAt = now;
      const ps = s.projectStates[id];
      if (ps) ps.lastAccessedAt = now;
    });
  }

  /**
   * Apply a manual sort order via DnD reorder. `ids` must contain every
   * existing project id exactly once. Assigns `order` = index for each.
   * Returns the new project list, or `undefined` when the id set mismatches.
   */
  reorder(ids: string[]): Project[] | undefined {
    const current = this.store.get().projects;
    if (ids.length !== current.length) return undefined;
    const idSet = new Set(ids);
    if (idSet.size !== ids.length) return undefined;
    for (const p of current) if (!idSet.has(p.id)) return undefined;

    let result: Project[] = [];
    this.store.mutateProjects((s) => {
      const byId = new Map(s.projects.map((p) => [p.id, p]));
      ids.forEach((id, idx) => {
        const project = byId.get(id);
        if (project) project.order = idx;
      });
      result = [...s.projects];
    });
    return result;
  }
}

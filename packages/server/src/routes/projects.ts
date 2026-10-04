import { getConnInfo } from "@hono/node-server/conninfo";
import {
  normalizeProjectSidebarStatePatch,
  type PaneNode,
  type Worktree,
  type WorktreeCreationSource,
} from "@parasor/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
} from "../application/workspace/errors.js";
import { createProjectCommands } from "../application/workspace/project-commands.js";
import { createProjectQueries } from "../application/workspace/project-queries.js";
import { createSidebarStateCommands } from "../application/workspace/sidebar-state-commands.js";
import { createWorktreeCommands } from "../application/workspace/worktree-commands.js";
import {
  ideEditorLabel,
  isSupportedIdeEditor,
  OpenInIdeError,
  openInIde,
} from "../lib/open-in-ide.js";
import { OpenInOsError, openInOs } from "../lib/open-in-os.js";
import { isLocalMachineAddress } from "../net/local-machine.js";
import type { PtyHost } from "../pty/host.js";
import type { AppStateStore } from "../state/app-state.js";
import type { ProjectManager } from "../state/project-manager.js";
import type { WorktreeCache } from "../state/worktree-cache.js";
import type { EventBus } from "../ws/events.js";
import { resolveWorktreeOrError } from "./lib/resolve-worktree.js";

const WORKTREE_CREATION_SOURCES = new Set<WorktreeCreationSource>([
  "ui",
  "cli",
  "runtime",
  "agent",
  "unknown",
]);

function normalizeCreateWorktreeLineage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const lineage: {
    creationSource?: WorktreeCreationSource;
    parentWorktreePath?: string;
    createdWithAgent?: string;
    createdBySessionId?: string;
    createdByPaneCommandId?: string;
    createdByPaneCommandLabel?: string;
  } = {};
  if (
    typeof raw.creationSource === "string" &&
    WORKTREE_CREATION_SOURCES.has(raw.creationSource as WorktreeCreationSource)
  ) {
    lineage.creationSource = raw.creationSource as WorktreeCreationSource;
  }
  const parentWorktreePath = optionalString(raw, "parentWorktreePath");
  if (parentWorktreePath) lineage.parentWorktreePath = parentWorktreePath;
  const createdWithAgent = optionalString(raw, "createdWithAgent");
  if (createdWithAgent) lineage.createdWithAgent = createdWithAgent;
  const createdBySessionId = optionalString(raw, "createdBySessionId");
  if (createdBySessionId) lineage.createdBySessionId = createdBySessionId;
  const createdByPaneCommandId = optionalString(raw, "createdByPaneCommandId");
  if (createdByPaneCommandId) {
    lineage.createdByPaneCommandId = createdByPaneCommandId;
  }
  const createdByPaneCommandLabel = optionalString(
    raw,
    "createdByPaneCommandLabel",
  );
  if (createdByPaneCommandLabel) {
    lineage.createdByPaneCommandLabel = createdByPaneCommandLabel;
  }
  return Object.keys(lineage).length > 0 ? lineage : undefined;
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createProjectRoutes(
  pm: ProjectManager,
  eventBus: EventBus,
  ptyManager: PtyHost,
  store: AppStateStore,
  worktreeCache: WorktreeCache,
  reconcileWorktrees?: (
    projectId: string,
    prefetched?: Worktree[],
  ) => Promise<void>,
  opts: {
    openInIde?: typeof openInIde;
    isLocalMachineAddress?: (address: string | null) => boolean;
    remoteAddress?: (c: Context) => string | null;
    isProjectMissing?: (projectId: string) => boolean;
    noteMissingPath?: (projectId: string) => void;
  } = {},
): Hono {
  const routes = new Hono();
  const projectCommands = createProjectCommands({
    appStateStore: store,
    eventBus,
    projectManager: pm,
    ptyManager,
  });
  const projectQueries = createProjectQueries({
    projectManager: pm,
    getWorktreeMetadata: (projectId) =>
      store.get().projectStates[projectId]?.worktreeMetadata ?? {},
  });
  const worktreeCommands = createWorktreeCommands({
    projectManager: pm,
    eventBus,
    getProjectWorktrees: (projectId) => worktreeCache.get()[projectId] ?? [],
    getWorktreeMetadata: (projectId, worktreePath) =>
      store.get().projectStates[projectId]?.worktreeMetadata?.[worktreePath],
    setWorktreeMetadata: (projectId, worktreePath, metadata) => {
      store.mutateProjectStates((state) => {
        const projectState = state.projectStates[projectId];
        if (!projectState) return;
        projectState.worktreeMetadata = {
          ...(projectState.worktreeMetadata ?? {}),
          [worktreePath]: metadata,
        };
      });
    },
    removeWorktreeMetadata: (projectId, worktreePath) => {
      store.mutateProjectStates((state) => {
        const projectState = state.projectStates[projectId];
        if (!projectState?.worktreeMetadata) return;
        const { [worktreePath]: _drop, ...rest } =
          projectState.worktreeMetadata;
        projectState.worktreeMetadata = rest;
      });
    },
  });
  const sidebarStateCommands = createSidebarStateCommands({
    appStateStore: store,
    eventBus,
    projectManager: pm,
  });
  const launchIde = opts.openInIde ?? openInIde;
  const canOpenLocalIdeFromAddress =
    opts.isLocalMachineAddress ?? isLocalMachineAddress;
  const remoteAddress =
    opts.remoteAddress ??
    ((c: Context) => {
      const info = getConnInfo(c);
      return info.remote?.address ?? null;
    });

  routes.get("/", (c) => {
    return c.json({ projects: projectQueries.listProjects() });
  });

  routes.get("/local-ide-capability", (c) => {
    return c.json({
      canOpenLocalIde: canOpenLocalIdeFromAddress(remoteAddress(c)),
    });
  });

  routes.put("/order", async (c) => {
    let body: { ids?: unknown };
    try {
      body = await c.req.json<{ ids?: unknown }>();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const ids = body.ids;
    if (
      !Array.isArray(ids) ||
      !ids.every((id): id is string => typeof id === "string")
    ) {
      return c.json({ error: "ids must be string[]" }, 400);
    }
    const ok = projectCommands.reorderProjects(ids);
    if (!ok) {
      return c.json({ error: "ids must match the current project set" }, 400);
    }
    return c.json({ ok: true });
  });

  routes.patch("/:id/sidebar-state", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<unknown>().catch(() => null);
    const patch = normalizeProjectSidebarStatePatch(body);
    if (!patch) {
      return c.json(
        { error: "paneOrder or worktreeOpen patch is required" },
        400,
      );
    }

    try {
      const sidebar = sidebarStateCommands.updateSidebarState(id, patch);
      return c.json({ sidebar });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      throw error;
    }
  });

  routes.post("/", async (c) => {
    const body = await c.req
      .json<{ path?: string; name?: string }>()
      .catch(() => ({}) as { path?: string; name?: string });

    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }

    const project = projectCommands.createProject({
      path: body.path,
      ...(body.name !== undefined && { name: body.name }),
    });
    return c.json(project, 201);
  });

  routes.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req
      .json<{ name?: string; pinned?: boolean; readOnly?: boolean }>()
      .catch(
        () =>
          ({}) as {
            name?: string;
            pinned?: boolean;
            readOnly?: boolean;
          },
      );

    try {
      const project = projectCommands.updateProject(id, body);
      return c.json(project);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      throw error;
    }
  });

  routes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const force = c.req.query("force") === "true";

    try {
      await projectCommands.deleteProject(id, force);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      if (error instanceof WorkspaceConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // Git diff. `?sha=<hex>` returns `git show <sha>` body (commit diff);
  // otherwise returns the working-tree diff. `worktreePath` is required so
  // the diff resolves against the selected worktree, mirroring `/git/log`.
  routes.get("/:id/diff", async (c) => {
    const id = c.req.param("id");
    const sha = c.req.query("sha");
    const worktreePath = c.req.query("worktreePath");

    const resolved = await resolveWorktreeOrError(
      worktreeCommands.fenceWorktreePath,
      id,
      worktreePath,
    );
    if (!resolved.ok) return c.json(resolved.body, resolved.status);

    if (sha !== undefined) {
      if (!/^[0-9a-f]{4,40}$/.test(sha)) {
        return c.json({ error: "Invalid sha" }, 400);
      }
      try {
        return c.json({
          diff: await projectQueries.getProjectCommitDiff(
            id,
            sha,
            resolved.resolved,
          ),
        });
      } catch (error) {
        if (error instanceof WorkspaceNotFoundError) {
          return c.json({ error: "Not found" }, 404);
        }
        throw error;
      }
    }

    try {
      return c.json({
        diff: await projectQueries.getProjectDiff(id, resolved.resolved),
      });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      throw error;
    }
  });

  // Git worktrees
  routes.get("/:id/worktree-local-files", async (c) => {
    const id = c.req.param("id");
    try {
      return c.json(await projectQueries.getWorktreeLocalFiles(id));
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      throw error;
    }
  });

  routes.get("/:id/worktrees", async (c) => {
    const id = c.req.param("id");
    try {
      const result = await projectQueries.getProjectWorktrees(id);
      // Fan-out deltas so other clients' sidebars catch up without waiting on
      // the next poll. Forward the freshly-enumerated list so the reconciler
      // does not re-run `git worktree list` + N×`git status` on every request.
      // missing-path and git-error must not pass prefetched [] (that deletes cache).
      if (result.status === "ok") {
        if (reconcileWorktrees) {
          void reconcileWorktrees(id, result.worktrees);
        }
        return c.json({ worktrees: result.worktrees });
      }
      if (result.status === "missing-path") {
        opts.noteMissingPath?.(id);
        return c.json({ worktrees: [], missing: true });
      }
      return c.json({
        worktrees: worktreeCache.get()[id] ?? [],
        error: "git-error",
      });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      throw error;
    }
  });

  routes.post("/:id/worktrees", async (c) => {
    const id = c.req.param("id");
    const body = await c.req
      .json<{
        branch?: string;
        base?: string;
        copyLocalFiles?: unknown;
        rememberLocalFiles?: unknown;
        lineage?: {
          creationSource?: unknown;
          parentWorktreePath?: unknown;
          createdWithAgent?: unknown;
          createdBySessionId?: unknown;
          createdByPaneCommandId?: unknown;
          createdByPaneCommandLabel?: unknown;
        };
      }>()
      .catch(
        () =>
          ({}) as {
            branch?: string;
            base?: string;
            copyLocalFiles?: unknown;
            rememberLocalFiles?: unknown;
            lineage?: unknown;
          },
      );
    if (!body.branch) {
      return c.json({ error: "branch is required" }, 400);
    }
    if (opts.isProjectMissing?.(id)) {
      return c.json({ error: "Project directory is missing" }, 409);
    }
    try {
      const worktree = await worktreeCommands.createProjectWorktree(id, {
        branch: body.branch,
        ...(body.base !== undefined && { base: body.base }),
        ...(body.copyLocalFiles !== undefined && {
          copyLocalFiles: body.copyLocalFiles,
        }),
        ...(body.lineage !== undefined && {
          lineage: normalizeCreateWorktreeLineage(body.lineage),
        }),
      });
      if (body.rememberLocalFiles === true) {
        projectCommands.rememberWorktreeLocalFiles(id, body.copyLocalFiles);
      }
      return c.json(worktree, 201);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      if (error instanceof WorkspaceValidationError) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof WorkspaceConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // Reveal worktree directory in the host OS file manager.
  routes.post("/:id/worktrees/open-os", async (c) => {
    const id = c.req.param("id");
    if (opts.isProjectMissing?.(id)) {
      return c.json({ error: "Project directory is missing" }, 409);
    }
    const body = await c.req
      .json<{ worktreePath?: string }>()
      .catch(() => ({}) as { worktreePath?: string });
    if (!body.worktreePath || typeof body.worktreePath !== "string") {
      return c.json({ error: "worktreePath is required" }, 400);
    }
    let resolved: string;
    try {
      ({ resolved } = await worktreeCommands.fenceWorktreePath(
        id,
        body.worktreePath,
      ));
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: error.message ?? "Not found" }, 404);
      }
      throw error;
    }
    try {
      await openInOs(resolved);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof OpenInOsError) {
        return c.json({ error: error.message }, 500);
      }
      throw error;
    }
  });

  // Open worktree directory in a whitelisted IDE on the parasor server host.
  routes.post("/:id/worktrees/open-ide", async (c) => {
    const id = c.req.param("id");
    if (opts.isProjectMissing?.(id)) {
      return c.json({ error: "Project directory is missing" }, 409);
    }
    const body = await c.req
      .json<{ worktreePath?: string; editor?: unknown }>()
      .catch(() => ({}) as { worktreePath?: string; editor?: unknown });
    if (!body.worktreePath || typeof body.worktreePath !== "string") {
      return c.json({ error: "worktreePath is required" }, 400);
    }
    if (typeof body.editor !== "string") {
      return c.json({ error: "Unsupported editor" }, 400);
    }
    const ideCommands = store.get().ideCommands;
    if (
      !isSupportedIdeEditor(body.editor) &&
      !ideCommands.some((command) => command.id === body.editor)
    ) {
      return c.json({ error: "Unsupported editor" }, 400);
    }
    if (!canOpenLocalIdeFromAddress(remoteAddress(c))) {
      return c.json({ error: "local machine only" }, 403);
    }
    let resolved: string;
    try {
      ({ resolved } = await worktreeCommands.fenceWorktreePath(
        id,
        body.worktreePath,
      ));
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: error.message ?? "Not found" }, 404);
      }
      throw error;
    }
    try {
      await launchIde(resolved, body.editor, { customCommands: ideCommands });
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof OpenInIdeError) {
        return c.json({ error: error.message }, 500);
      }
      const message =
        error instanceof Error
          ? error.message
          : `Could not open in ${ideEditorLabel(body.editor, ideCommands)}`;
      return c.json({ error: message }, 500);
    }
  });

  // Rename a worktree's branch (`git branch -m`). The on-disk dir keeps
  // its original path -- see worktree-commands.renameProjectWorktree.
  routes.patch("/:id/worktrees", async (c) => {
    const id = c.req.param("id");
    const body = await c.req
      .json<{ worktreePath?: string; newBranch?: string }>()
      .catch(() => ({}) as { worktreePath?: string; newBranch?: string });
    if (!body.worktreePath || typeof body.worktreePath !== "string") {
      return c.json({ error: "worktreePath is required" }, 400);
    }
    if (!body.newBranch || typeof body.newBranch !== "string") {
      return c.json({ error: "newBranch is required" }, 400);
    }
    try {
      const result = await worktreeCommands.renameProjectWorktree(
        id,
        body.worktreePath,
        body.newBranch,
      );
      return c.json(result);
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      if (error instanceof WorkspaceValidationError) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof WorkspaceConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // Remove a worktree (`git worktree remove [--force]`).
  routes.delete("/:id/worktrees", async (c) => {
    const id = c.req.param("id");
    const body = await c.req
      .json<{ worktreePath?: string; force?: boolean }>()
      .catch(() => ({}) as { worktreePath?: string; force?: boolean });
    if (!body.worktreePath || typeof body.worktreePath !== "string") {
      return c.json({ error: "worktreePath is required" }, 400);
    }
    try {
      await worktreeCommands.removeProjectWorktree(id, body.worktreePath, {
        ...(body.force === true && { force: true }),
      });
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      if (error instanceof WorkspaceConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // Layout update
  routes.put("/:id/layout", async (c) => {
    const id = c.req.param("id");
    let body: { layout: PaneNode | null };
    try {
      body = await c.req.json<{ layout: PaneNode | null }>();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    try {
      projectCommands.updateLayout(id, body.layout);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return c.json({ error: "Not found" }, 404);
      }
      throw error;
    }
  });

  return routes;
}

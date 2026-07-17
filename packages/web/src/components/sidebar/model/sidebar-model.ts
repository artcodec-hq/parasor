import {
  type AgentLifecycle,
  type AgentState,
  deriveAgentStatusContext,
  type GitState,
  type Project,
  type RuntimeServiceInfo,
  type Session,
  terminalPaneId,
  type WorkItem,
  type Worktree,
  type WorktreePanes,
} from "@parasor/shared";
import {
  type AttentionDismissals,
  isAttentionDismissed,
} from "../../../features/workspace/useAttentionDismissals.js";
import { displayTitleForTerminal } from "../../../lib/session-title.js";
import type { AgentDotState } from "../../primitives/index.js";
import type { SidebarChild, SidebarProject, SidebarWorktree } from "./types.js";

export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return b.lastAccessedAt - a.lastAccessedAt;
  });
}

/**
 * Projections from server state -> sidebar view model. Kept pure so both the
 * active-project full tree and inactive-project placeholder rows come from
 * the same pipeline.
 */

interface BuildSidebarProjectsOptions {
  projects: Project[];
  activeProjectId: string | null;
  /** Authoritative worktrees + panes for the active project only. */
  activeWorktrees: WorktreePanes[];
  sessions: Session[];
  agentStates: Record<string, AgentState>;
  reviewPendingSessions: Set<string>;
  /**
   * Per-project worktree metadata (ahead/behind/dirtyCount). Indexed by
   * project id and looked up by worktree path. Optional so older callsites
   * and fixtures degrade to zeroed counters.
   */
  worktreesByProject?: Record<string, Worktree[]>;
  /**
   * Per-project per-worktree git poll snapshots. Used here only to surface
   * the project root's `isRepo` flag so per-project actions (e.g. *New
   * worktree*) can be gated when the root directory has no `.git`.
   */
  gitStates?: Record<string, Record<string, GitState | null>>;
  /** Runtime services grouped by project id. Used for compact worktree counts. */
  servicesByProject?: Record<string, RuntimeServiceInfo[]>;
  /**
   * Per-session "viewed waiting" timestamps. When a session's `waiting`
   * lifecycle has already been viewed (focused pane match + same
   * `detectedAt`), we suppress the `attention` badge for that session.
   * Optional so existing fixtures degrade to "no dismissals".
   */
  attentionDismissed?: AttentionDismissals;
  /**
   * Client-side child panes for projects whose full pane model is not active.
   * Today this is populated by browser panes persisted per project; keeping
   * the shape generic at the sidebar boundary means inactive projects do not
   * drop children merely because their backing source is client-side.
   */
  inactiveChildPanesByProject?: Record<
    string,
    Record<string, InactiveChildPane[]>
  >;
  workItemsByProject?: Record<string, WorkItem[]>;
}

type InactiveChildPane =
  | { id: string; kind: "browser"; url: string }
  | { id: string; kind: "work-item"; workItemId: string };

/**
 * Path-tolerant lookup index for per-worktree counters. Server-supplied
 * `Worktree.path` (from `git worktree list --porcelain`) and the lookup key
 * (`session.cwd` for inactive projects, `WorktreePanes.path` for active) can
 * disagree on:
 *   - macOS `/private` aliasing (`/private/tmp/x` ↔ `/tmp/x`)
 *   - trailing slashes
 *   - the cwd being a subdirectory of the worktree (sessions launched deeper)
 * `lookup(path)` returns the worktree whose canonical root contains the
 * supplied path, falling back to direct equality.
 */
interface CounterIndex {
  lookup(path: string): SidebarWorktreeCounters | undefined;
}

interface SidebarWorktreeCounters {
  path: string;
  ahead?: number;
  behind?: number;
  dirtyCount?: number;
  /** Added/deleted line counts from the live git watcher. */
  dirtyAdded?: number;
  dirtyDeleted?: number;
  origin?: Worktree["origin"];
  lineage?: Worktree["lineage"];
  orphan?: Worktree["orphan"];
}

interface ServiceCountIndex {
  lookup(path: string): number;
}

interface GitStateIndex {
  lookup(path: string): GitState | null | undefined;
}

function normalizePath(p: string): string {
  let n = p.replace(/\/+$/, "");
  if (n.startsWith("/private/")) n = n.slice("/private".length);
  return n;
}

function counterLookup(
  worktreesByProject: Record<string, Worktree[]> | undefined,
  gitStates: Record<string, Record<string, GitState | null>> | undefined,
  projectId: string,
): CounterIndex {
  const projectGitStates = gitStates?.[projectId] ?? {};
  const gitStateByNormalizedPath = new Map(
    Object.entries(projectGitStates).map(([path, state]) => [
      normalizePath(path),
      state,
    ]),
  );
  const list = worktreesByProject?.[projectId] ?? [];
  const byNormalizedPath = new Map<string, SidebarWorktreeCounters>();
  for (const w of list) {
    const key = normalizePath(w.path);
    byNormalizedPath.set(key, {
      ...w,
      ...lineStatsFromGitState(gitStateByNormalizedPath.get(key)),
    });
  }
  for (const [path, state] of Object.entries(projectGitStates)) {
    const key = normalizePath(path);
    if (byNormalizedPath.has(key)) continue;
    byNormalizedPath.set(key, {
      path,
      ahead: state?.ahead,
      behind: state?.behind,
      dirtyCount: state?.dirtyCount,
      ...lineStatsFromGitState(state),
    });
  }
  // Sort descending by length so prefix-matching picks the deepest worktree
  // (e.g. /repo/wt-a wins over /repo when cwd is /repo/wt-a/sub).
  const keys = [...byNormalizedPath.keys()].sort((a, b) => b.length - a.length);
  return {
    lookup(target) {
      const t = normalizePath(target);
      const direct = byNormalizedPath.get(t);
      if (direct) return direct;
      for (const k of keys) {
        if (t === k || t.startsWith(`${k}/`)) return byNormalizedPath.get(k);
      }
      return undefined;
    },
  };
}

function lineStatsFromGitState(
  state: GitState | null | undefined,
): Pick<SidebarWorktreeCounters, "dirtyAdded" | "dirtyDeleted"> {
  if (!state) return {};
  return {
    dirtyAdded: state.addedLines ?? 0,
    dirtyDeleted: state.deletedLines ?? 0,
  };
}

function gitStateLookup(
  gitStates: Record<string, Record<string, GitState | null>> | undefined,
  projectId: string,
): GitStateIndex {
  const states = gitStates?.[projectId] ?? {};
  const byNormalizedPath = new Map<string, GitState | null>();
  for (const [path, state] of Object.entries(states)) {
    byNormalizedPath.set(normalizePath(path), state);
  }
  const keys = [...byNormalizedPath.keys()].sort((a, b) => b.length - a.length);
  return {
    lookup(target) {
      const t = normalizePath(target);
      const direct = byNormalizedPath.get(t);
      if (direct !== undefined) return direct;
      for (const k of keys) {
        if (t === k || t.startsWith(`${k}/`)) return byNormalizedPath.get(k);
      }
      return undefined;
    },
  };
}

function serviceCountLookup(
  servicesByProject: Record<string, RuntimeServiceInfo[]> | undefined,
  projectId: string,
): ServiceCountIndex {
  const counts = new Map<string, number>();
  for (const service of servicesByProject?.[projectId] ?? []) {
    if (
      service.kind !== "workspace" ||
      service.lifecycle === "disappeared" ||
      !service.attribution.worktreePath
    ) {
      continue;
    }
    const key = normalizePath(service.attribution.worktreePath);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    lookup(path) {
      return counts.get(normalizePath(path)) ?? 0;
    },
  };
}

export function buildSidebarProjects({
  projects,
  activeProjectId,
  activeWorktrees,
  sessions,
  agentStates,
  reviewPendingSessions,
  worktreesByProject,
  gitStates,
  attentionDismissed,
  inactiveChildPanesByProject,
  servicesByProject,
  workItemsByProject,
}: BuildSidebarProjectsOptions): SidebarProject[] {
  const dismissed = attentionDismissed ?? {};
  return sortProjects(projects).map((project) => {
    const isActive = project.id === activeProjectId;
    const counters = counterLookup(worktreesByProject, gitStates, project.id);
    const gitStateIndex = gitStateLookup(gitStates, project.id);
    const serviceCounts = serviceCountLookup(servicesByProject, project.id);
    const rootGit = gitStateIndex.lookup(project.path);
    const isNotRepo = rootGit?.isRepo === false;
    const worktrees = isActive
      ? buildActiveWorktrees({
          project,
          worktrees: activeWorktrees,
          sessions,
          agentStates,
          reviewPendingSessions,
          counters,
          serviceCounts,
          isNotRepo,
          attentionDismissed: dismissed,
          workItems: workItemsByProject?.[project.id] ?? [],
        })
      : buildInactiveWorktrees({
          project,
          sessions,
          agentStates,
          reviewPendingSessions,
          counters,
          serviceCounts,
          projectWorktrees: worktreesByProject?.[project.id] ?? [],
          childPanes: inactiveChildPanesByProject?.[project.id] ?? {},
          isNotRepo,
          attentionDismissed: dismissed,
          workItems: workItemsByProject?.[project.id] ?? [],
        });
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      pinned: Boolean(project.pinned),
      readOnly: Boolean(project.readOnly),
      ...(isNotRepo ? { isRepo: false } : {}),
      worktrees,
    };
  });
}

interface BuildActiveWorktreesOptions {
  project: Project;
  worktrees: WorktreePanes[];
  sessions: Session[];
  agentStates: Record<string, AgentState>;
  reviewPendingSessions: Set<string>;
  counters: CounterIndex;
  serviceCounts: ServiceCountIndex;
  attentionDismissed: AttentionDismissals;
  workItems: WorkItem[];
  /**
   * `true` when project root is confirmed not a git repo. Drives the
   * label swap (`main` -> `root`) for the project-path worktree row.
   */
  isNotRepo: boolean;
}

function buildActiveWorktrees({
  project,
  worktrees,
  sessions,
  agentStates,
  reviewPendingSessions,
  counters,
  serviceCounts,
  isNotRepo,
  attentionDismissed,
  workItems,
}: BuildActiveWorktreesOptions): SidebarWorktree[] {
  if (worktrees.length === 0) {
    return buildPlaceholderWorktrees(
      project,
      counters,
      serviceCounts,
      isNotRepo,
    );
  }
  return worktrees.map((wt) => {
    const children = buildChildren({
      panes: wt.panes,
      sessions,
      agentStates,
      reviewPendingSessions,
      attentionDismissed,
      workItems,
    });
    const meta = counters.lookup(wt.path);
    const isRoot = wt.path === project.path;
    return {
      id: `wt:${wt.path}`,
      name: isRoot ? (isNotRepo ? "root" : "main") : lastSegment(wt.path),
      path: wt.path,
      active: isRoot,
      dirty: meta?.dirtyCount ?? 0,
      dirtyAdded: meta?.dirtyAdded ?? 0,
      dirtyDeleted: meta?.dirtyDeleted ?? 0,
      ahead: meta?.ahead ?? 0,
      behind: meta?.behind ?? 0,
      serviceCount: serviceCounts.lookup(wt.path),
      children,
      hasWorkingChild: children.some((c) => c.status === "working"),
      hasAlertChild: children.some((c) => c.status === "attention"),
      ...(meta?.origin ? { origin: meta.origin } : {}),
      ...worktreeProvenance({
        isRoot,
        meta,
        orphan: wt.orphan === true || meta?.orphan === true,
      }),
      ...(meta?.lineage ? { lineage: meta.lineage } : {}),
      ...(wt.orphan || meta?.orphan ? { orphan: true } : {}),
    };
  });
}

function buildPlaceholderWorktrees(
  project: Project,
  counters: CounterIndex,
  serviceCounts: ServiceCountIndex,
  isNotRepo: boolean,
): SidebarWorktree[] {
  const meta = counters.lookup(project.path);
  return [
    {
      id: `wt:${project.path}`,
      name: isNotRepo ? "root" : "main",
      path: project.path,
      active: true,
      dirty: meta?.dirtyCount ?? 0,
      dirtyAdded: meta?.dirtyAdded ?? 0,
      dirtyDeleted: meta?.dirtyDeleted ?? 0,
      ahead: meta?.ahead ?? 0,
      behind: meta?.behind ?? 0,
      serviceCount: serviceCounts.lookup(project.path),
      children: [],
      hasWorkingChild: false,
      hasAlertChild: false,
    },
  ];
}

interface BuildInactiveWorktreesOptions {
  project: Project;
  sessions: Session[];
  agentStates: Record<string, AgentState>;
  reviewPendingSessions: Set<string>;
  counters: CounterIndex;
  serviceCounts: ServiceCountIndex;
  // Seeds the row set so worktrees with no sessions still appear.
  projectWorktrees: Worktree[];
  // Additional non-session children keyed by worktree path.
  childPanes: Record<string, InactiveChildPane[]>;
  isNotRepo: boolean;
  attentionDismissed: AttentionDismissals;
  workItems: WorkItem[];
}

// Union of project.path ("main"), server worktree snapshot, and distinct
// session cwds. When a session cwd no longer belongs to the authoritative
// snapshot, keep it as an orphan row so the user can close the remaining
// session without presenting the path as a live worktree. Client-side child
// panes may attach to known rows, but do not seed rows on their own because
// their persisted paths can be stale.
function buildInactiveWorktrees({
  project,
  sessions,
  agentStates,
  reviewPendingSessions,
  counters,
  serviceCounts,
  projectWorktrees,
  childPanes,
  isNotRepo,
  attentionDismissed,
  workItems,
}: BuildInactiveWorktreesOptions): SidebarWorktree[] {
  const projectSessions = sessions.filter((s) => s.projectId === project.id);
  const byCwd = new Map<string, Session[]>();
  const syntheticOrphanPaths = new Set<string>();
  byCwd.set(project.path, []);
  const hasAuthoritativeWorktrees = projectWorktrees.length > 0;
  for (const wt of projectWorktrees) {
    if (!byCwd.has(wt.path)) byCwd.set(wt.path, []);
  }
  for (const s of projectSessions) {
    let cwd = inactiveSessionWorktreePath(
      s.cwd,
      project.path,
      projectWorktrees,
    );
    if (!cwd) {
      cwd = s.cwd;
      if (hasAuthoritativeWorktrees) syntheticOrphanPaths.add(cwd);
    }
    const list = byCwd.get(cwd) ?? [];
    list.push(s);
    byCwd.set(cwd, list);
  }
  // Preserve the same root-first, server snapshot order used once the project
  // becomes active. Sorting inactive rows alphabetically makes worktrees jump
  // when selecting one of their children switches the active project.
  const cwds = [...byCwd.keys()];
  return cwds.map((cwd) => {
    const wtSessions = byCwd.get(cwd) ?? [];
    const labelCounts = new Map<string, number>();
    const children: SidebarChild[] = [];
    for (const session of wtSessions) {
      const state = agentStates[session.id];
      const statusContext = statusContextForSession(
        session,
        state,
        attentionDismissed,
      );
      const inReview = reviewPendingSessions.has(session.id);
      const baseLabel = labelForTerminal(session);
      const seen = labelCounts.get(baseLabel) ?? 0;
      labelCounts.set(baseLabel, seen + 1);
      children.push({
        // Must match the pane id format used by the active path
        // (`terminalPaneId(sessionId)` -> `terminal:<sessionId>`). The sidebar
        // passes this id through to `setFocusedPaneId`; if it diverges from
        // the format produced by `useWorkspacePaneModel` for the now-active
        // project, the lookup misses and the focus falls back to the main
        // worktree's files pane (worktree screen instead of terminal).
        id: terminalPaneId(session.id),
        kind: "terminal",
        label: seen === 0 ? baseLabel : `${baseLabel} (${seen + 1})`,
        hint:
          statusContext?.reason ??
          (session.state === "ended" ? "ended" : undefined),
        status: lifecycleToStatus(statusContext?.state, inReview),
        ...(statusContext ? { statusContext } : {}),
        pinned: session.pinned === true,
        agentType: agentTypeForSession(session),
      });
    }
    const meta = counters.lookup(cwd);
    const isRoot = cwd === project.path;
    const isSyntheticOrphan = syntheticOrphanPaths.has(cwd);
    if (!isSyntheticOrphan) {
      for (const pane of childPanes[cwd] ?? []) {
        const item =
          pane.kind === "work-item"
            ? workItems.find((candidate) => candidate.id === pane.workItemId)
            : undefined;
        const baseLabel =
          pane.kind === "browser"
            ? browserLabel(pane.url)
            : (item?.title ?? "Missing work item");
        const seen = labelCounts.get(baseLabel) ?? 0;
        labelCounts.set(baseLabel, seen + 1);
        children.push({
          id: pane.id,
          kind: pane.kind,
          label: seen === 0 ? baseLabel : `${baseLabel} (${seen + 1})`,
          hint:
            pane.kind === "browser" ? pane.url : item?.status.replace("_", " "),
          status: "idle",
          pinned: false,
        });
      }
    }
    children.sort(
      (a, b) => inactiveChildOrder(a.kind) - inactiveChildOrder(b.kind),
    );
    return {
      id: `wt:${cwd}`,
      name: isRoot ? (isNotRepo ? "root" : "main") : lastSegment(cwd),
      path: cwd,
      active: isRoot,
      dirty: meta?.dirtyCount ?? 0,
      dirtyAdded: meta?.dirtyAdded ?? 0,
      dirtyDeleted: meta?.dirtyDeleted ?? 0,
      ahead: meta?.ahead ?? 0,
      behind: meta?.behind ?? 0,
      serviceCount: serviceCounts.lookup(cwd),
      children,
      hasWorkingChild: children.some((c) => c.status === "working"),
      hasAlertChild: children.some((c) => c.status === "attention"),
      ...(meta?.origin ? { origin: meta.origin } : {}),
      ...worktreeProvenance({
        isRoot,
        meta,
        orphan: meta?.orphan === true || isSyntheticOrphan,
      }),
      ...(meta?.lineage ? { lineage: meta.lineage } : {}),
      ...(meta?.orphan || isSyntheticOrphan ? { orphan: true } : {}),
    };
  });
}

function inactiveChildOrder(kind: SidebarChild["kind"]): number {
  if (kind === "work-item") return 0;
  if (kind === "terminal") return 1;
  return 2;
}

function worktreeProvenance({
  isRoot,
  meta,
  orphan,
}: {
  isRoot: boolean;
  meta: SidebarWorktreeCounters | undefined;
  orphan: boolean;
}): Pick<SidebarWorktree, "provenance"> {
  if (!isRoot && meta && !orphan && !meta.origin && !meta.lineage) {
    return { provenance: "imported" };
  }
  return {};
}

function inactiveSessionWorktreePath(
  cwd: string,
  projectPath: string,
  projectWorktrees: Worktree[],
): string | null {
  const nCwd = normalizePath(cwd);
  const nProjectPath = normalizePath(projectPath);
  const matches = projectWorktrees
    .map((w) => w.path)
    .filter((path) => {
      const nPath = normalizePath(path);
      if (nPath === nProjectPath) return nCwd === nPath;
      return nCwd === nPath || nCwd.startsWith(`${nPath}/`);
    })
    .sort((a, b) => normalizePath(b).length - normalizePath(a).length);
  return matches[0] ?? null;
}

interface BuildChildrenOptions {
  panes: WorktreePanes["panes"];
  sessions: Session[];
  agentStates: Record<string, AgentState>;
  reviewPendingSessions: Set<string>;
  attentionDismissed: AttentionDismissals;
  workItems: WorkItem[];
}

function buildChildren({
  panes,
  sessions,
  agentStates,
  reviewPendingSessions,
  attentionDismissed,
  workItems,
}: BuildChildrenOptions): SidebarChild[] {
  const labelCounts = new Map<string, number>();
  const out: SidebarChild[] = [];
  for (const pane of panes) {
    if (
      pane.state.kind !== "terminal" &&
      pane.state.kind !== "browser" &&
      pane.state.kind !== "work-item"
    ) {
      continue;
    }
    const base = paneToChild(
      pane,
      sessions,
      agentStates,
      reviewPendingSessions,
      attentionDismissed,
      workItems,
    );
    if (!base) continue;
    const seen = labelCounts.get(base.label) ?? 0;
    labelCounts.set(base.label, seen + 1);
    out.push(
      seen === 0 ? base : { ...base, label: `${base.label} (${seen + 1})` },
    );
  }
  return out;
}

function paneToChild(
  pane: WorktreePanes["panes"][number],
  sessions: Session[],
  agentStates: Record<string, AgentState>,
  reviewPendingSessions: Set<string>,
  attentionDismissed: AttentionDismissals,
  workItems: WorkItem[],
): SidebarChild | null {
  const { state } = pane;
  if (state.kind === "terminal") {
    const session = sessions.find((s) => s.id === state.sessionId);
    const agentState = session ? agentStates[session.id] : undefined;
    const statusContext = session
      ? statusContextForSession(session, agentState, attentionDismissed)
      : undefined;
    const inReview = session ? reviewPendingSessions.has(session.id) : false;
    return {
      id: pane.id,
      kind: "terminal",
      label: session ? labelForTerminal(session) : "terminal",
      hint:
        statusContext?.reason ??
        (session?.state === "ended" ? "ended" : undefined),
      status: lifecycleToStatus(statusContext?.state, inReview),
      ...(statusContext ? { statusContext } : {}),
      pinned: session?.pinned === true,
      agentType: session ? agentTypeForSession(session) : undefined,
    };
  }
  if (state.kind === "browser") {
    return {
      id: pane.id,
      kind: "browser",
      label: browserLabel(state.url),
      hint: state.url,
      status: "idle",
      pinned: false,
      auto: state.auto === true,
    };
  }
  if (state.kind === "work-item") {
    const item = workItems.find(
      (candidate) => candidate.id === state.workItemId,
    );
    return {
      id: pane.id,
      kind: "work-item",
      label: item?.title ?? "Missing work item",
      hint: item?.status.replace("_", " "),
      status: "idle",
      pinned: false,
    };
  }
  return null;
}

function labelForTerminal(session: Session): string {
  return displayTitleForTerminal(session);
}

function agentTypeForSession(session: Session): string | undefined {
  if (session.command?.type === "claude") return "claude";
  const runtimeId = session.launchPreset?.runtimeHint?.runtimeId;
  return runtimeId && runtimeId !== "terminal" ? runtimeId : undefined;
}

function browserLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname || "browser";
    const port = u.port;
    return port ? `${host}:${port}` : host;
  } catch {
    return "Browser";
  }
}

function lifecycleToStatus(
  liveness:
    | ReturnType<typeof deriveAgentStatusContext>["state"]
    | AgentLifecycle
    | undefined,
  inReview: boolean,
): AgentDotState {
  if (inReview) return "review";
  if (liveness === "waiting_for_user" || liveness === "waiting")
    return "attention";
  if (liveness === "active" || liveness === "running") return "working";
  return "idle";
}

function statusContextForSession(
  session: Session,
  agentState: AgentState | undefined,
  attentionDismissed: AttentionDismissals,
): ReturnType<typeof deriveAgentStatusContext> | undefined {
  const context = deriveAgentStatusContext({ session, agentState });
  if (
    context.state === "waiting_for_user" &&
    isAttentionDismissed(agentState, attentionDismissed)
  ) {
    return {
      ...context,
      state: "idle",
      reason: "Waiting status already viewed",
    };
  }
  return context;
}

function lastSegment(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const seg = trimmed.split("/").pop();
  return seg && seg.length > 0 ? seg : path;
}

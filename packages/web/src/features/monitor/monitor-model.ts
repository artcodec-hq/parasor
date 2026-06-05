import type { GitState, Project, Session } from "@parasor/shared";

export interface PinnedTerminalEntry {
  session: Session;
  project: Project | undefined;
  /** Worktree segment derived from cwd (e.g. "fix/cli", "main", "root"). */
  worktreeName: string;
  /** Compact label `project / worktree-name`. */
  label: string;
  /** Path crumb (`~/proj/worktree`) for header tooltip display. */
  crumb: string;
}

/**
 * Returns at most one entry per pinned session, sorted by project then
 * creation time so column order is stable. `gitStates` decides whether a
 * project root labels its worktree segment as `main` (repo) or `root`
 * (non-repo).
 */
export function collectPinnedTerminals(
  projects: Project[],
  sessions: Session[],
  gitStates?: Record<string, Record<string, GitState | null>>,
): PinnedTerminalEntry[] {
  const byId = new Map<string, Project>();
  for (const p of projects) byId.set(p.id, p);
  const pinned = sessions.filter((s) => s.pinned === true);
  pinned.sort((a, b) => {
    const pa = byId.get(a.projectId)?.name ?? "";
    const pb = byId.get(b.projectId)?.name ?? "";
    if (pa !== pb) return pa.localeCompare(pb);
    return a.createdAt - b.createdAt;
  });
  return pinned.map((session) => {
    const project = byId.get(session.projectId);
    const projectIsRepo = project
      ? gitStates?.[project.id]?.[project.path]?.isRepo !== false
      : true;
    const worktreeName = worktreeSegment(
      session.cwd,
      project?.path,
      projectIsRepo,
    );
    const label = project ? `${project.name} / ${worktreeName}` : worktreeName;
    return {
      session,
      project,
      worktreeName,
      label,
      crumb: session.cwd,
    };
  });
}

function worktreeSegment(
  cwd: string,
  projectPath: string | undefined,
  projectIsRepo: boolean,
): string {
  if (projectPath && cwd === projectPath) {
    return projectIsRepo ? "main" : "root";
  }
  const trimmed = cwd.replace(/\/+$/, "");
  const seg = trimmed.split("/").pop();
  return seg && seg.length > 0 ? seg : cwd;
}

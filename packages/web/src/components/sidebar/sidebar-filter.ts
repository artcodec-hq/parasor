import type { SidebarProject, SidebarWorktree } from "./model/types.js";

/**
 * Tree filter -- a project is kept when its own name matches OR any of its
 * descendants do. A worktree is kept (with all children) when project or
 * worktree matches; otherwise only matching children survive and the
 * worktree carries them.
 */
export function filterSidebarProjects(
  projects: SidebarProject[],
  query: string,
): SidebarProject[] {
  const q = query.toLowerCase();
  const result: SidebarProject[] = [];
  for (const project of projects) {
    const projectMatches = project.name.toLowerCase().includes(q);
    const worktrees: SidebarWorktree[] = [];
    for (const wt of project.worktrees) {
      const wtMatches = wt.name.toLowerCase().includes(q);
      if (projectMatches || wtMatches) {
        worktrees.push(wt);
        continue;
      }
      const children = wt.children.filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          (c.hint?.toLowerCase().includes(q) ?? false),
      );
      if (children.length > 0) {
        worktrees.push({ ...wt, children });
      }
    }
    if (projectMatches || worktrees.length > 0) {
      const projectWorktree = project.worktrees.find(
        (worktree) => worktree.path === project.path,
      );
      if (
        !projectMatches &&
        projectWorktree &&
        !worktrees.some((worktree) => worktree.id === projectWorktree.id)
      ) {
        worktrees.unshift({ ...projectWorktree, children: [] });
      }
      result.push({ ...project, worktrees });
    }
  }
  return result;
}

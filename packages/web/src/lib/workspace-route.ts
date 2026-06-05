export type WorkspaceRoute =
  | { kind: "root" }
  | { kind: "monitor" }
  | { kind: "session"; sessionId: string }
  | { kind: "pane"; paneId: string; projectId?: string }
  | {
      kind: "worktree";
      projectId: string;
      worktreePath: string;
      tab: "files" | "git";
    };

export function parseWorkspaceRoute(
  locationLike: Pick<Location, "pathname" | "search">,
): WorkspaceRoute {
  const pathname = normalizePath(locationLike.pathname);
  if (pathname === "/" || pathname === "") return { kind: "root" };
  if (pathname === "/monitor") return { kind: "monitor" };

  const sessionId = matchSingleSegment(pathname, "/sessions/");
  if (sessionId !== null) {
    return { kind: "session", sessionId };
  }

  const paneId = matchSingleSegment(pathname, "/panes/");
  if (paneId !== null) {
    const params = new URLSearchParams(locationLike.search);
    const projectId = params.get("project") ?? undefined;
    return { kind: "pane", paneId, projectId };
  }

  if (pathname === "/worktree") {
    const params = new URLSearchParams(locationLike.search);
    const projectId = params.get("project");
    const worktreePath = params.get("path");
    const rawTab = params.get("tab");
    const tab = rawTab === "git" ? "git" : "files";
    if (projectId && worktreePath) {
      return { kind: "worktree", projectId, worktreePath, tab };
    }
  }

  return { kind: "root" };
}

export function buildWorkspacePath(route: WorkspaceRoute): string {
  switch (route.kind) {
    case "root":
      return "/";
    case "monitor":
      return "/monitor";
    case "session":
      return `/sessions/${encodeURIComponent(route.sessionId)}`;
    case "pane": {
      const query = route.projectId
        ? `?project=${encodeURIComponent(route.projectId)}`
        : "";
      return `/panes/${encodeURIComponent(route.paneId)}${query}`;
    }
    case "worktree": {
      const params = new URLSearchParams({
        project: route.projectId,
        path: route.worktreePath,
        tab: route.tab,
      });
      return `/worktree?${params.toString()}`;
    }
  }
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }
  return pathname;
}

function matchSingleSegment(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  if (!raw || raw.includes("/")) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

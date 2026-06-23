import {
  type AgentState,
  type GitState,
  makeTerminalPane,
  type Project,
  type Session,
  terminalPaneId,
  type Worktree,
  type WorktreePanes,
} from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { buildSidebarProjects, sortProjects } from "./sidebar-model.js";

function project(overrides: Partial<Project>): Project {
  return {
    id: "p1",
    name: "p1",
    path: "/repos/p1",
    createdAt: 0,
    lastAccessedAt: 0,
    ...overrides,
  };
}

function session(overrides: Partial<Session>): Session {
  return {
    id: "s1",
    projectId: "p1",
    pid: 1234,
    state: "running",
    generation: 0,
    title: "",
    command: { type: "shell" },
    cwd: "/repos/p1",
    shell: "/bin/zsh",
    createdAt: 0,
    ...overrides,
  };
}

function gitState(overrides: Partial<GitState> = {}): GitState {
  return {
    branch: "main",
    dirty: false,
    lastChecked: 1,
    ...overrides,
  };
}

describe("sortProjects", () => {
  it("orders projects without manual order by lastAccessedAt desc", () => {
    const out = sortProjects([
      project({ id: "old", lastAccessedAt: 1 }),
      project({ id: "new", lastAccessedAt: 100 }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["new", "old"]);
  });
  it("honors manual order over lastAccessedAt", () => {
    const out = sortProjects([
      project({ id: "a", order: 2, lastAccessedAt: 100 }),
      project({ id: "b", order: 0, lastAccessedAt: 50 }),
      project({ id: "c", order: 1, lastAccessedAt: 200 }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["b", "c", "a"]);
  });
  it("ignores pinned flag when ordering (manual order is the only signal)", () => {
    const out = sortProjects([
      project({ id: "a", order: 0 }),
      project({ id: "b", order: 1, pinned: true }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("buildSidebarProjects -- inactive project (sessions-derived)", () => {
  it("returns a placeholder main with no children when project has no sessions", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: null,
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.worktrees).toHaveLength(1);
    expect(result[0]?.worktrees[0]?.name).toBe("main");
    expect(result[0]?.worktrees[0]?.children).toHaveLength(0);
  });

  it("derives terminal children from sessions when project is inactive", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [
      session({ id: "s1", projectId: "p1", cwd: "/repos/p1" }),
      session({ id: "s2", projectId: "p1", cwd: "/repos/p1" }),
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    const main = result[0]?.worktrees[0];
    expect(main?.children).toHaveLength(2);
    expect(main?.children.map((c) => c.kind)).toEqual(["terminal", "terminal"]);
  });

  it("keeps browser children visible when project is inactive", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [
      session({ id: "s1", projectId: "p1", cwd: "/repos/p1" }),
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
      inactiveChildPanesByProject: {
        p1: {
          "/repos/p1": [
            {
              id: "browser:p1-root",
              kind: "browser",
              url: "https://example.com/app",
            },
          ],
        },
      },
    });

    const main = result[0]?.worktrees[0];
    expect(main?.children.map((c) => c.kind)).toEqual(["terminal", "browser"]);
    expect(main?.children[1]).toMatchObject({
      id: "browser:p1-root",
      label: "example.com",
      hint: "https://example.com/app",
    });
  });

  it("keeps browser-only children visible on server-known worktrees when project is inactive", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/repos/p1/wt-browser",
          head: "def",
          branch: "feature",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
      ],
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
      inactiveChildPanesByProject: {
        p1: {
          "/repos/p1/wt-browser": [
            {
              id: "browser:p1-branch",
              kind: "browser",
              url: "http://localhost:5173",
            },
          ],
        },
      },
    });

    const wts = result[0]?.worktrees ?? [];
    expect(wts.map((w) => w.path)).toEqual([
      "/repos/p1",
      "/repos/p1/wt-browser",
    ]);
    expect(wts[1]?.children).toEqual([
      expect.objectContaining({
        id: "browser:p1-branch",
        kind: "browser",
        label: "localhost:5173",
      }),
    ]);
  });

  it("does not create inactive worktree rows from stale browser child pane paths", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
      ],
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
      inactiveChildPanesByProject: {
        p1: {
          "/repos/p1/deleted-worktree": [
            {
              id: "browser:p1-stale",
              kind: "browser",
              url: "https://stale.example.com",
            },
          ],
        },
      },
    });

    const wts = result[0]?.worktrees ?? [];
    expect(wts.map((w) => w.path)).toEqual(["/repos/p1"]);
    expect(wts.flatMap((w) => w.children.map((c) => c.id))).not.toContain(
      "browser:p1-stale",
    );
  });

  it("keeps stale session cwd paths as orphan rows when a worktree snapshot exists", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
      ],
    };
    const sessions: Session[] = [
      session({
        id: "stale",
        projectId: "p1",
        cwd: "/repos/p1.worktrees/deleted",
      }),
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
    });

    const wts = result[0]?.worktrees ?? [];
    expect(wts.map((w) => w.path)).toEqual([
      "/repos/p1",
      "/repos/p1.worktrees/deleted",
    ]);
    const orphan = wts.find((w) => w.path === "/repos/p1.worktrees/deleted");
    expect(orphan).toMatchObject({ orphan: true });
    expect(orphan?.children.map((c) => c.id)).toEqual([
      terminalPaneId("stale"),
    ]);
  });

  it("does not attach stale browser child panes to session-created orphan rows", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
      ],
    };
    const sessions: Session[] = [
      session({
        id: "stale",
        projectId: "p1",
        cwd: "/repos/p1.worktrees/deleted",
      }),
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
      inactiveChildPanesByProject: {
        p1: {
          "/repos/p1.worktrees/deleted": [
            {
              id: "browser:p1-stale",
              kind: "browser",
              url: "https://stale.example.com",
            },
          ],
        },
      },
    });

    const orphan = result[0]?.worktrees.find(
      (w) => w.path === "/repos/p1.worktrees/deleted",
    );
    expect(orphan).toMatchObject({ orphan: true });
    expect(orphan?.children.map((c) => c.id)).toEqual([
      terminalPaneId("stale"),
    ]);
  });

  it("inactive-project terminal child ids match the active path's pane id format", () => {
    // Regression guard: clicking a terminal under an inactive project in the
    // sidebar feeds child.id straight into `setFocusedPaneId`. After the
    // active project switch, the pane model rebuilds with `terminalPaneId()`
    // ids -- if the inactive builder uses a different prefix (`session:` was
    // the old bug), the lookup misses and focus falls back to the main
    // worktree's files pane, surfacing the worktree screen instead of the
    // terminal the user just clicked.
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [
      session({ id: "s1", projectId: "p1", cwd: "/repos/p1" }),
      session({ id: "s2", projectId: "p1", cwd: "/repos/p1/wt-a" }),
    ];
    const inactive = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    const active = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees: [
        {
          path: "/repos/p1",
          panes: [makeTerminalPane(terminalPaneId("s1"), "/repos/p1", "s1")],
        },
        {
          path: "/repos/p1/wt-a",
          panes: [
            makeTerminalPane(terminalPaneId("s2"), "/repos/p1/wt-a", "s2"),
          ],
        },
      ],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    const inactiveIds = inactive[0]?.worktrees
      .flatMap((w) => w.children)
      .map((c) => c.id);
    const activeIds = active[0]?.worktrees
      .flatMap((w) => w.children)
      .map((c) => c.id);
    expect(inactiveIds).toEqual([terminalPaneId("s1"), terminalPaneId("s2")]);
    expect(inactiveIds).toEqual(activeIds);
  });

  it("groups sessions by cwd into separate worktrees and sorts main first", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [
      session({ id: "s1", projectId: "p1", cwd: "/repos/p1/wt-a" }),
      session({ id: "s2", projectId: "p1", cwd: "/repos/p1" }),
      session({ id: "s3", projectId: "p1", cwd: "/repos/p1/wt-b" }),
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    const wts = result[0]?.worktrees ?? [];
    expect(wts.map((w) => w.name)).toEqual(["main", "wt-a", "wt-b"]);
    expect(wts[0]?.children).toHaveLength(1);
    expect(wts[1]?.children).toHaveLength(1);
    expect(wts[2]?.children).toHaveLength(1);
  });

  it("disambiguates duplicate labels within the same worktree", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [
      session({ id: "s1", shell: "/bin/zsh" }),
      session({ id: "s2", shell: "/bin/zsh" }),
      session({ id: "s3", shell: "/bin/zsh" }),
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: null,
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    const labels = result[0]?.worktrees[0]?.children.map((c) => c.label);
    expect(labels).toEqual(["zsh", "zsh (2)", "zsh (3)"]);
  });

  it("flags ended sessions with session-derived status context", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [session({ id: "s1", state: "ended" })];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: null,
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    expect(result[0]?.worktrees[0]?.children[0]).toMatchObject({
      hint: "Terminal session ended",
      status: "idle",
      statusContext: {
        sessionId: "s1",
        state: "ended",
        reason: "Terminal session ended",
        source: "session",
        confidence: "high",
        stale: false,
      },
    });
  });

  it("ignores sessions belonging to other projects", () => {
    const projects = [
      project({ id: "p1", path: "/repos/p1" }),
      project({ id: "p2", path: "/repos/p2" }),
    ];
    const sessions: Session[] = [
      session({ id: "a", projectId: "p1" }),
      session({ id: "b", projectId: "p2", cwd: "/repos/p2" }),
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: null,
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    const p1 = result.find((p) => p.id === "p1");
    const p2 = result.find((p) => p.id === "p2");
    expect(p1?.worktrees[0]?.children).toHaveLength(1);
    expect(p2?.worktrees[0]?.children).toHaveLength(1);
  });

  it("groups inactive-project sessions under the containing worktree root", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [
      // Session launched two levels deep inside the worktree root.
      session({ id: "s1", projectId: "p1", cwd: "/repos/p1/wt-a/sub" }),
    ];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/repos/p1/wt-a",
          head: "def",
          branch: "feature",
          ahead: 3,
          behind: 1,
          dirtyCount: 5,
        },
      ],
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
      inactiveChildPanesByProject: {
        p1: {
          "/repos/p1/wt-a": [
            {
              id: "browser:p1-wt-a",
              kind: "browser",
              url: "http://localhost:5173",
            },
          ],
        },
      },
    });
    const wts = result[0]?.worktrees ?? [];
    expect(wts.map((w) => w.path)).toEqual(["/repos/p1", "/repos/p1/wt-a"]);
    // The deepest worktree containing the cwd wins, so the terminal and
    // browser child stay visible together under wt-a even though the
    // session.cwd is /repos/p1/wt-a/sub.
    const wtA = wts.find((w) => w.path === "/repos/p1/wt-a");
    expect(wtA).toMatchObject({ ahead: 3, behind: 1, dirty: 5 });
    expect(wtA?.children.map((c) => c.id)).toEqual([
      terminalPaneId("s1"),
      "browser:p1-wt-a",
    ]);
  });

  it("includes worktrees from projectWorktrees snapshot even with no sessions", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/repos/p1/wt-a",
          head: "def",
          branch: "feature",
          ahead: 1,
          behind: 0,
          dirtyCount: 2,
        },
        {
          path: "/repos/p1/wt-b",
          head: "ghi",
          branch: "fix",
          ahead: 0,
          behind: 3,
          dirtyCount: 0,
        },
      ],
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
    });
    const wts = result[0]?.worktrees ?? [];
    expect(wts.map((w) => w.path)).toEqual([
      "/repos/p1",
      "/repos/p1/wt-a",
      "/repos/p1/wt-b",
    ]);
    expect(wts.map((w) => w.name)).toEqual(["main", "wt-a", "wt-b"]);
    expect(wts[1]).toMatchObject({ ahead: 1, behind: 0, dirty: 2 });
    expect(wts[2]).toMatchObject({ ahead: 0, behind: 3, dirty: 0 });
  });

  it("preserves projectWorktrees snapshot order so activating a child does not reshuffle rows", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [
      session({ id: "s1", projectId: "p1", cwd: "/repos/p1/wt-z" }),
    ];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/repos/p1/wt-z",
          head: "def",
          branch: "feature/z",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/repos/p1/wt-a",
          head: "ghi",
          branch: "feature/a",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
      ],
    };

    const inactive = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
    });
    const active = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees: [
        { path: "/repos/p1", panes: [] },
        {
          path: "/repos/p1/wt-z",
          panes: [
            makeTerminalPane(terminalPaneId("s1"), "/repos/p1/wt-z", "s1"),
          ],
        },
        { path: "/repos/p1/wt-a", panes: [] },
      ],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
    });

    expect(inactive[0]?.worktrees.map((w) => w.path)).toEqual([
      "/repos/p1",
      "/repos/p1/wt-z",
      "/repos/p1/wt-a",
    ]);
    expect(inactive[0]?.worktrees.map((w) => w.path)).toEqual(
      active[0]?.worktrees.map((w) => w.path),
    );
  });

  it("propagates lineage metadata when the project is inactive", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const lineage = {
      instanceId: "wt-inst",
      creationSource: "ui" as const,
      createdAt: 100,
      parentWorktreePath: "/repos/p1",
      lineageCapture: {
        source: "create-worktree-request" as const,
        confidence: "explicit" as const,
      },
    };
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/repos/p1/wt-linked",
          head: "def",
          branch: "feature",
          lineage,
        },
      ],
    };

    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
    });

    expect(result[0]?.worktrees[1]?.lineage).toBe(lineage);
    expect(result[0]?.worktrees[1]?.provenance).toBeUndefined();
  });

  it("marks inactive discovered worktrees without lineage as imported", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
        },
        {
          path: "/repos/p1/wt-external",
          head: "def",
          branch: "feature",
        },
      ],
    };

    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
    });

    expect(result[0]?.worktrees[0]?.provenance).toBeUndefined();
    expect(result[0]?.worktrees[1]?.provenance).toBe("imported");
  });

  it("merges projectWorktrees with matching session-derived cwds and marks missing paths orphan", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [
      session({ id: "s1", projectId: "p1", cwd: "/repos/p1/wt-a" }),
      session({ id: "s2", projectId: "p1", cwd: "/repos/p1/wt-c" }),
    ];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/repos/p1/wt-a",
          head: "def",
          branch: "feature",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
        {
          path: "/repos/p1/wt-b",
          head: "ghi",
          branch: "fix",
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
        },
      ],
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "OTHER",
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
    });
    const wts = result[0]?.worktrees ?? [];
    expect(wts.map((w) => w.path)).toEqual([
      "/repos/p1",
      "/repos/p1/wt-a",
      "/repos/p1/wt-b",
      "/repos/p1/wt-c",
    ]);
    const wtA = wts.find((w) => w.path === "/repos/p1/wt-a");
    expect(wtA?.children).toHaveLength(1);
    const wtB = wts.find((w) => w.path === "/repos/p1/wt-b");
    expect(wtB?.children).toHaveLength(0);
    const wtC = wts.find((w) => w.path === "/repos/p1/wt-c");
    expect(wtC).toMatchObject({ orphan: true });
    expect(wtC?.children.map((c) => c.id)).toEqual([terminalPaneId("s2")]);
  });

  it("propagates pinned flag from session to child", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [
      session({ id: "s1", pinned: true }),
      session({ id: "s2", pinned: false }),
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: null,
      activeWorktrees: [],
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    const children = result[0]?.worktrees[0]?.children ?? [];
    expect(children[0]?.pinned).toBe(true);
    expect(children[1]?.pinned).toBe(false);
  });
});

describe("buildSidebarProjects -- active project (worktrees-derived)", () => {
  it("uses activeWorktrees pane data when project is active", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [session({ id: "s1", projectId: "p1" })];
    const activeWorktrees: WorktreePanes[] = [
      {
        path: "/repos/p1",
        panes: [
          {
            id: "pane-1",
            kind: "terminal",
            worktreePath: "/repos/p1",
            state: { kind: "terminal", sessionId: "s1" },
          },
        ],
      },
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions,
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    const child = result[0]?.worktrees[0]?.children[0];
    expect(child?.id).toBe("pane-1");
    expect(child?.kind).toBe("terminal");
  });

  it("propagates ahead/behind/dirtyCount from worktreesByProject", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const activeWorktrees: WorktreePanes[] = [
      { path: "/repos/p1", panes: [] },
      { path: "/repos/p1/wt-a", panes: [] },
    ];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1",
          head: "abc",
          branch: "main",
          ahead: 1,
          behind: 0,
          dirtyCount: 3,
        },
        {
          path: "/repos/p1/wt-a",
          head: "def",
          branch: "feature",
          ahead: 5,
          behind: 2,
          dirtyCount: 0,
        },
      ],
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
      gitStates: {
        p1: {
          "/repos/p1": gitState({
            dirty: true,
            dirtyCount: 3,
            addedLines: 8,
            deletedLines: 2,
            changes: [
              {
                path: "added.ts",
                area: "staged",
                status: "added",
                code: "A",
              },
              {
                path: "new.ts",
                area: "untracked",
                status: "untracked",
                code: "?",
              },
              {
                path: "deleted.ts",
                area: "unstaged",
                status: "deleted",
                code: "D",
              },
              {
                path: "modified.ts",
                area: "unstaged",
                status: "modified",
                code: "M",
              },
            ],
          }),
        },
      },
    });
    const [main, branch] = result[0]?.worktrees ?? [];
    expect(main).toMatchObject({
      dirty: 3,
      dirtyAdded: 8,
      dirtyDeleted: 2,
      ahead: 1,
      behind: 0,
    });
    expect(branch).toMatchObject({
      dirty: 0,
      dirtyAdded: 0,
      dirtyDeleted: 0,
      ahead: 5,
      behind: 2,
    });
  });

  it("propagates tracked line stats from gitStates without worktree enrichment", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const activeWorktrees: WorktreePanes[] = [
      { path: "/repos/p1", panes: [] },
      { path: "/repos/p1/wt-a", panes: [] },
    ];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      gitStates: {
        p1: {
          "/repos/p1": gitState({
            dirty: true,
            dirtyCount: 1,
            addedLines: 8,
            deletedLines: 2,
          }),
          "/repos/p1/wt-a": gitState({
            branch: "feature",
            dirty: true,
            dirtyCount: 1,
            addedLines: 0,
            deletedLines: 5,
          }),
        },
      },
    });
    const [main, branch] = result[0]?.worktrees ?? [];
    expect(main).toMatchObject({
      dirty: 1,
      dirtyAdded: 8,
      dirtyDeleted: 2,
    });
    expect(branch).toMatchObject({
      dirty: 1,
      dirtyAdded: 0,
      dirtyDeleted: 5,
    });
  });

  it("matches counters across macOS /private aliasing", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const activeWorktrees: WorktreePanes[] = [{ path: "/tmp/proj", panes: [] }];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          // git porcelain returns the realpath form on macOS.
          path: "/private/tmp/proj",
          head: "abc",
          branch: "main",
          ahead: 4,
          behind: 0,
          dirtyCount: 7,
        },
      ],
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
      gitStates: {
        p1: {
          "/tmp/proj": gitState({
            dirty: true,
            addedLines: 1,
            deletedLines: 0,
            changes: [
              {
                path: "new.ts",
                area: "untracked",
                status: "untracked",
                code: "?",
              },
            ],
          }),
        },
      },
    });
    expect(result[0]?.worktrees[0]).toMatchObject({
      dirty: 7,
      dirtyAdded: 1,
      dirtyDeleted: 0,
      ahead: 4,
      behind: 0,
    });
  });

  it("propagates lineage metadata from worktreesByProject", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const activeWorktrees: WorktreePanes[] = [
      { path: "/repos/p1.worktrees/feat", panes: [] },
    ];
    const lineage = {
      instanceId: "wt-inst",
      creationSource: "ui" as const,
      createdAt: 100,
      parentWorktreePath: "/repos/p1",
      lineageCapture: {
        source: "create-worktree-request" as const,
        confidence: "explicit" as const,
      },
    };
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1.worktrees/feat",
          head: "abc",
          branch: "feat",
          lineage,
        },
      ],
    };

    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
    });

    expect(result[0]?.worktrees[0]?.lineage).toBe(lineage);
    expect(result[0]?.worktrees[0]?.provenance).toBeUndefined();
  });

  it("marks active discovered worktrees without lineage as imported", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const activeWorktrees: WorktreePanes[] = [
      { path: "/repos/p1.worktrees/feat", panes: [] },
    ];
    const worktreesByProject: Record<string, Worktree[]> = {
      p1: [
        {
          path: "/repos/p1.worktrees/feat",
          head: "abc",
          branch: "feat",
        },
      ],
    };

    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      worktreesByProject,
    });

    expect(result[0]?.worktrees[0]?.provenance).toBe("imported");
  });

  it("falls back to zeroed counters when worktreesByProject omitted", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const activeWorktrees: WorktreePanes[] = [{ path: "/repos/p1", panes: [] }];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    expect(result[0]?.worktrees[0]).toMatchObject({
      dirty: 0,
      ahead: 0,
      behind: 0,
    });
  });

  it("renders agent lifecycle as child status", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [session({ id: "s1", projectId: "p1" })];
    const activeWorktrees: WorktreePanes[] = [
      {
        path: "/repos/p1",
        panes: [
          {
            id: "pane-1",
            kind: "terminal",
            worktreePath: "/repos/p1",
            state: { kind: "terminal", sessionId: "s1" },
          },
        ],
      },
    ];
    const agentStates: Record<string, AgentState> = {
      s1: {
        sessionId: "s1",
        lifecycle: "waiting",
        source: "hook",
        confidence: "high",
        detectedAt: 0,
      },
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions,
      agentStates,
      reviewPendingSessions: new Set(),
    });
    expect(result[0]?.worktrees[0]?.children[0]).toMatchObject({
      status: "attention",
      hint: "Agent hook reported waiting for user",
      statusContext: {
        sessionId: "s1",
        state: "waiting_for_user",
        reason: "Agent hook reported waiting for user",
        source: "hook",
        confidence: "high",
        lastSignalAt: 0,
        stale: false,
      },
    });
  });

  it("expires stale output-derived activity before rendering child status", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [session({ id: "s1", projectId: "p1" })];
    const activeWorktrees: WorktreePanes[] = [
      {
        path: "/repos/p1",
        panes: [
          {
            id: "pane-1",
            kind: "terminal",
            worktreePath: "/repos/p1",
            state: { kind: "terminal", sessionId: "s1" },
          },
        ],
      },
    ];
    const agentStates: Record<string, AgentState> = {
      s1: {
        sessionId: "s1",
        lifecycle: "running",
        source: "output",
        confidence: "low",
        detectedAt: 0,
      },
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions,
      agentStates,
      reviewPendingSessions: new Set(),
    });
    expect(result[0]?.worktrees[0]?.children[0]).toMatchObject({
      status: "idle",
      hint: "Output-derived agent status expired",
      statusContext: {
        sessionId: "s1",
        state: "idle",
        reason: "Output-derived agent status expired",
        source: "output",
        confidence: "low",
        lastSignalAt: 0,
        stale: true,
      },
    });
  });

  it("suppresses attention when the same waiting event was dismissed", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [session({ id: "s1", projectId: "p1" })];
    const activeWorktrees: WorktreePanes[] = [
      {
        path: "/repos/p1",
        panes: [
          {
            id: "pane-1",
            kind: "terminal",
            worktreePath: "/repos/p1",
            state: { kind: "terminal", sessionId: "s1" },
          },
        ],
      },
    ];
    const agentStates: Record<string, AgentState> = {
      s1: {
        sessionId: "s1",
        lifecycle: "waiting",
        source: "hook",
        confidence: "high",
        detectedAt: 1000,
      },
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions,
      agentStates,
      reviewPendingSessions: new Set(),
      attentionDismissed: { s1: 1000 },
    });
    expect(result[0]?.worktrees[0]?.children[0]?.status).toBe("idle");
    expect(result[0]?.worktrees[0]?.hasAlertChild).toBe(false);
  });

  it("re-surfaces attention when a newer waiting event arrives after dismissal", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const sessions: Session[] = [session({ id: "s1", projectId: "p1" })];
    const activeWorktrees: WorktreePanes[] = [
      {
        path: "/repos/p1",
        panes: [
          {
            id: "pane-1",
            kind: "terminal",
            worktreePath: "/repos/p1",
            state: { kind: "terminal", sessionId: "s1" },
          },
        ],
      },
    ];
    const agentStates: Record<string, AgentState> = {
      s1: {
        sessionId: "s1",
        lifecycle: "waiting",
        source: "hook",
        confidence: "high",
        detectedAt: 2000,
      },
    };
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees,
      sessions,
      agentStates,
      reviewPendingSessions: new Set(),
      attentionDismissed: { s1: 1000 },
    });
    expect(result[0]?.worktrees[0]?.children[0]?.status).toBe("attention");
  });
});

describe("buildSidebarProjects -- project root isRepo plumbing", () => {
  it("propagates isRepo=false from gitStates lookup at project.path", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: null,
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      gitStates: {
        p1: {
          "/repos/p1": {
            branch: "",
            dirty: false,
            isRepo: false,
            lastChecked: 0,
          },
        },
      },
    });
    expect(result[0]?.isRepo).toBe(false);
  });

  it("leaves isRepo undefined when gitStates says isRepo=true", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: null,
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      gitStates: {
        p1: {
          "/repos/p1": {
            branch: "main",
            dirty: false,
            lastChecked: 0,
          },
        },
      },
    });
    expect(result[0]?.isRepo).toBeUndefined();
  });

  it("leaves isRepo undefined when gitStates lookup misses (pre-hydration)", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: null,
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    expect(result[0]?.isRepo).toBeUndefined();
  });

  it("labels project-root worktree as `root` when isRepo=false (placeholder path)", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      gitStates: {
        p1: {
          "/repos/p1": {
            branch: "",
            dirty: false,
            isRepo: false,
            lastChecked: 0,
          },
        },
      },
    });
    expect(result[0]?.worktrees[0]?.name).toBe("root");
  });

  it("labels project-root worktree as `root` when isRepo=false (inactive sessions path)", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: null,
      activeWorktrees: [],
      sessions: [
        {
          id: "s1",
          projectId: "p1",
          cwd: "/repos/p1",
          shell: "/bin/bash",
          state: "running",
          pinned: false,
        } as Session,
      ],
      agentStates: {},
      reviewPendingSessions: new Set(),
      gitStates: {
        p1: {
          "/repos/p1": {
            branch: "",
            dirty: false,
            isRepo: false,
            lastChecked: 0,
          },
        },
      },
    });
    expect(result[0]?.worktrees[0]?.name).toBe("root");
  });

  it("keeps `main` label when isRepo is undefined (pre-hydration)", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees: [],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
    });
    expect(result[0]?.worktrees[0]?.name).toBe("main");
  });

  it("counts live workspace services per worktree and ignores disappeared services", () => {
    const projects = [project({ id: "p1", path: "/repos/p1" })];
    const result = buildSidebarProjects({
      projects,
      activeProjectId: "p1",
      activeWorktrees: [{ path: "/repos/p1", panes: [] }],
      sessions: [],
      agentStates: {},
      reviewPendingSessions: new Set(),
      servicesByProject: {
        p1: [
          {
            id: "svc-1",
            kind: "workspace",
            port: 5173,
            pid: 100,
            bindHost: "127.0.0.1",
            connectHost: "127.0.0.1",
            bindsAll: false,
            protocol: "http",
            attribution: {
              source: "session-process-tree",
              confidence: "high",
              projectId: "p1",
              worktreePath: "/repos/p1",
              sessionId: "s1",
            },
            reachable: true,
            lifecycle: "reachable",
            firstSeenAt: 1,
            lastSeenAt: 1,
            source: "scanner",
          },
          {
            id: "svc-2",
            kind: "workspace",
            port: 3000,
            pid: 101,
            bindHost: "127.0.0.1",
            connectHost: "127.0.0.1",
            bindsAll: false,
            protocol: "http",
            attribution: {
              source: "session-process-tree",
              confidence: "high",
              projectId: "p1",
              worktreePath: "/repos/p1",
              sessionId: "s2",
            },
            reachable: false,
            lifecycle: "disappeared",
            firstSeenAt: 1,
            lastSeenAt: 2,
            disappearedAt: 2,
            source: "scanner",
          },
        ],
      },
    });

    expect(result[0]?.worktrees[0]?.serviceCount).toBe(1);
  });
});

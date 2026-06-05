import type { Project, Session } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { collectPinnedTerminals } from "./monitor-model.js";

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
    pinned: true,
    ...overrides,
  };
}

describe("collectPinnedTerminals -- worktree label", () => {
  it("labels project-root pinned session as `main` by default (pre-hydration / repo)", () => {
    const out = collectPinnedTerminals(
      [project({ id: "p1", path: "/repos/p1" })],
      [session({ id: "s1", cwd: "/repos/p1" })],
    );
    expect(out[0]?.worktreeName).toBe("main");
    expect(out[0]?.label).toBe("p1 / main");
  });

  it("labels project-root pinned session as `root` when gitStates says isRepo=false", () => {
    const out = collectPinnedTerminals(
      [project({ id: "p1", path: "/repos/p1" })],
      [session({ id: "s1", cwd: "/repos/p1" })],
      {
        p1: {
          "/repos/p1": {
            branch: "",
            dirty: false,
            isRepo: false,
            lastChecked: 0,
          },
        },
      },
    );
    expect(out[0]?.worktreeName).toBe("root");
    expect(out[0]?.label).toBe("p1 / root");
  });

  it("keeps `main` when gitStates explicitly says isRepo=true", () => {
    const out = collectPinnedTerminals(
      [project({ id: "p1", path: "/repos/p1" })],
      [session({ id: "s1", cwd: "/repos/p1" })],
      {
        p1: {
          "/repos/p1": {
            branch: "main",
            dirty: false,
            lastChecked: 0,
          },
        },
      },
    );
    expect(out[0]?.worktreeName).toBe("main");
  });

  it("uses path basename for non-root worktree cwds regardless of repo state", () => {
    const out = collectPinnedTerminals(
      [project({ id: "p1", path: "/repos/p1" })],
      [session({ id: "s1", cwd: "/repos/p1/wt-feature" })],
      {
        p1: {
          "/repos/p1": {
            branch: "",
            dirty: false,
            isRepo: false,
            lastChecked: 0,
          },
        },
      },
    );
    expect(out[0]?.worktreeName).toBe("wt-feature");
  });

  it("filters out sessions with pinned !== true", () => {
    const out = collectPinnedTerminals(
      [project({ id: "p1", path: "/repos/p1" })],
      [
        session({ id: "s1", pinned: false }),
        session({ id: "s2", pinned: true, cwd: "/repos/p1" }),
      ],
    );
    expect(out.map((e) => e.session.id)).toEqual(["s2"]);
  });
});

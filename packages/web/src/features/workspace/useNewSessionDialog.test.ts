import type { GitState, Project } from "@parasor/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNewSessionDialog } from "./useNewSessionDialog.js";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? "p1",
    name: overrides.name ?? "demo",
    path: overrides.path ?? "/Users/me/demo",
    createdAt: overrides.createdAt ?? 0,
    lastAccessedAt: overrides.lastAccessedAt ?? 0,
    ...overrides,
  } as Project;
}

function makeGitState(overrides: Partial<GitState> = {}): GitState {
  return {
    branch: overrides.branch ?? "main",
    dirty: overrides.dirty ?? false,
    ...overrides,
  } as GitState;
}

const projects: Project[] = [
  makeProject({ id: "p1", name: "demo", path: "/r/demo" }),
];

describe("useNewSessionDialog", () => {
  it("starts with no target and null context", () => {
    const { result } = renderHook(() =>
      useNewSessionDialog({ projects, gitStates: {} }),
    );
    expect(result.current.target).toBe(null);
    expect(result.current.context).toBe(null);
  });

  it("open strips a 'wt:' prefix from the worktreeId to derive worktreePath", () => {
    const { result } = renderHook(() =>
      useNewSessionDialog({ projects, gitStates: {} }),
    );
    act(() => {
      result.current.open("p1", "wt:/r/demo/feature");
    });
    expect(result.current.target).toEqual({
      projectId: "p1",
      worktreeId: "wt:/r/demo/feature",
      worktreePath: "/r/demo/feature",
    });
  });

  it("open without a 'wt:' prefix uses the worktreeId verbatim as the path", () => {
    const { result } = renderHook(() =>
      useNewSessionDialog({ projects, gitStates: {} }),
    );
    act(() => {
      result.current.open("p1", "/r/demo");
    });
    expect(result.current.target?.worktreePath).toBe("/r/demo");
  });

  it("context resolves to the project + 'main' label when the worktree is the project root and the repo is a git repo", () => {
    const gitStates = {
      p1: { "/r/demo": makeGitState({ isRepo: true }) },
    };
    const { result } = renderHook(() =>
      useNewSessionDialog({ projects, gitStates }),
    );
    act(() => {
      result.current.open("p1", "/r/demo");
    });
    expect(result.current.context).toEqual({
      project: { id: "p1", name: "demo", path: "/r/demo" },
      worktree: { id: "/r/demo", name: "main", path: "/r/demo" },
    });
  });

  it("context labels the project root as 'root' when isRepo === false", () => {
    const gitStates = {
      p1: { "/r/demo": makeGitState({ isRepo: false }) },
    };
    const { result } = renderHook(() =>
      useNewSessionDialog({ projects, gitStates }),
    );
    act(() => {
      result.current.open("p1", "/r/demo");
    });
    expect(result.current.context?.worktree.name).toBe("root");
  });

  it("context treats missing gitStates as a repo (matches the inline `?.isRepo !== false` guard)", () => {
    const { result } = renderHook(() =>
      useNewSessionDialog({ projects, gitStates: {} }),
    );
    act(() => {
      result.current.open("p1", "/r/demo");
    });
    expect(result.current.context?.worktree.name).toBe("main");
  });

  it("context uses the worktree dir basename for non-root worktrees", () => {
    const { result } = renderHook(() =>
      useNewSessionDialog({ projects, gitStates: {} }),
    );
    act(() => {
      result.current.open("p1", "/r/demo/feature-branch");
    });
    expect(result.current.context?.worktree.name).toBe("feature-branch");
  });

  it("context is null when the project cannot be found", () => {
    const { result } = renderHook(() =>
      useNewSessionDialog({ projects, gitStates: {} }),
    );
    act(() => {
      result.current.open("missing", "/r/x");
    });
    expect(result.current.target).not.toBe(null);
    expect(result.current.context).toBe(null);
  });

  it("close clears both target and context", () => {
    const { result } = renderHook(() =>
      useNewSessionDialog({ projects, gitStates: {} }),
    );
    act(() => {
      result.current.open("p1", "/r/demo/feature");
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.target).toBe(null);
    expect(result.current.context).toBe(null);
  });

  it("re-derives context when projects change", () => {
    const { result, rerender } = renderHook(
      ({ projs }) => useNewSessionDialog({ projects: projs, gitStates: {} }),
      { initialProps: { projs: projects } },
    );
    act(() => {
      result.current.open("p1", "/r/demo/feature");
    });
    expect(result.current.context?.project.name).toBe("demo");

    const renamed: Project[] = [
      makeProject({ id: "p1", name: "renamed", path: "/r/demo" }),
    ];
    rerender({ projs: renamed });
    expect(result.current.context?.project.name).toBe("renamed");
  });
});

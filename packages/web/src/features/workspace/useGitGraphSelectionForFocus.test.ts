import type { GitCommit } from "@parasor/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GitGraphSelection } from "../panes/git-graph/GitGraphPane.js";
import { useGitGraphSelectionForFocus } from "./useGitGraphSelectionForFocus.js";

const WORKING_TREE: GitGraphSelection = { kind: "working-tree" };

function commitSelection(sha: string): GitGraphSelection {
  return {
    kind: "commit",
    commit: {
      sha,
      shortSha: sha.slice(0, 7),
      parents: [],
      subject: "msg",
      authorName: "a",
      authorEmail: "a@a",
      authoredAt: 0,
      refs: [],
      lane: 0,
    } as unknown as GitCommit,
  };
}

describe("useGitGraphSelectionForFocus", () => {
  it("starts with no selection", () => {
    const { result } = renderHook(() =>
      useGitGraphSelectionForFocus("/repo/main"),
    );
    expect(result.current[0]).toBe(null);
  });

  it("retains the selection while the focused worktree stays the same", () => {
    const { result, rerender } = renderHook(
      ({ path }) => useGitGraphSelectionForFocus(path),
      { initialProps: { path: "/repo/main" } },
    );
    act(() => {
      result.current[1](WORKING_TREE);
    });
    expect(result.current[0]).toEqual(WORKING_TREE);

    rerender({ path: "/repo/main" });
    expect(result.current[0]).toEqual(WORKING_TREE);
  });

  it("resets the selection when the focused worktree path changes", () => {
    const { result, rerender } = renderHook(
      ({ path }) => useGitGraphSelectionForFocus(path),
      { initialProps: { path: "/repo/main" as string | null } },
    );
    act(() => {
      result.current[1](commitSelection("abc1234"));
    });
    expect(result.current[0]).not.toBe(null);

    rerender({ path: "/repo/feature" });
    expect(result.current[0]).toBe(null);
  });

  it("resets when the focused worktree becomes null and again on rebind", () => {
    const { result, rerender } = renderHook(
      ({ path }) => useGitGraphSelectionForFocus(path),
      { initialProps: { path: "/repo/main" as string | null } },
    );
    act(() => {
      result.current[1](WORKING_TREE);
    });
    rerender({ path: null });
    expect(result.current[0]).toBe(null);

    act(() => {
      result.current[1](commitSelection("def5678"));
    });
    rerender({ path: "/repo/feature" });
    expect(result.current[0]).toBe(null);
  });
});

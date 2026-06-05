import { describe, expect, it } from "vitest";
import { resolveWorktreeDirName } from "./worktree-dir-name.js";

describe("resolveWorktreeDirName", () => {
  it("returns 'main' when path === projectPath and project is a repo", () => {
    expect(resolveWorktreeDirName("/repo", "/repo", true)).toBe("main");
  });

  it("returns 'root' when path === projectPath and project is NOT a repo", () => {
    expect(resolveWorktreeDirName("/repo", "/repo", false)).toBe("root");
  });

  it("returns the trailing basename for a child worktree", () => {
    expect(resolveWorktreeDirName("/repo/wt/feature", "/repo", true)).toBe(
      "feature",
    );
  });

  it("strips trailing slashes before taking the basename", () => {
    expect(resolveWorktreeDirName("/repo/wt/feature///", "/repo", true)).toBe(
      "feature",
    );
  });

  it("ignores projectIsRepo for child worktrees (basename only)", () => {
    expect(resolveWorktreeDirName("/repo/wt/a", "/repo", false)).toBe("a");
  });

  it("falls back to the raw path when basename extraction fails", () => {
    // Empty string has no segments after split; the helper returns the
    // input unchanged rather than throwing or returning undefined.
    expect(resolveWorktreeDirName("", "/repo", true)).toBe("");
  });

  it("does not coerce projectPath equality on prefix overlap", () => {
    // path startsWith projectPath but is not equal -> take basename.
    expect(resolveWorktreeDirName("/repo-2", "/repo", true)).toBe("repo-2");
  });
});

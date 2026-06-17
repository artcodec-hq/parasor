import { describe, expect, it } from "vitest";
import {
  attributeRuntimeService,
  includesPathBoundary,
} from "./service-attribution.js";

const worktrees = [
  { projectId: "p1", path: "/repo" },
  { projectId: "p1", path: "/repo.worktrees/feature" },
];

describe("attributeRuntimeService", () => {
  it("prefers session process-tree attribution and derives the deepest worktree", () => {
    expect(
      attributeRuntimeService({
        projectId: "p1",
        sessionId: "s1",
        sessionCwd: "/repo.worktrees/feature/app",
        processCwd: "/other",
        commandLine: "node /repo/server.js",
        worktrees,
      }),
    ).toEqual({
      source: "session-process-tree",
      confidence: "high",
      projectId: "p1",
      worktreePath: "/repo.worktrees/feature",
      sessionId: "s1",
    });
  });

  it("falls back to process cwd when no session owns the process tree", () => {
    expect(
      attributeRuntimeService({
        projectId: "p1",
        processCwd: "/repo/src",
        commandLine: "node /repo.worktrees/feature/server.js",
        worktrees,
      }),
    ).toMatchObject({
      source: "process-cwd",
      confidence: "high",
      worktreePath: "/repo",
    });
  });

  it("falls back to command-line path boundary matching", () => {
    expect(
      attributeRuntimeService({
        projectId: "p1",
        commandLine: 'node --root="/repo.worktrees/feature"',
        worktrees,
      }),
    ).toMatchObject({
      source: "command-line",
      confidence: "medium",
      worktreePath: "/repo.worktrees/feature",
    });
  });

  it("does not match command-line path substrings", () => {
    expect(includesPathBoundary("node /repo-other/server.js", "/repo")).toBe(
      false,
    );
  });

  it("uses project-level attribution when no worktree evidence exists", () => {
    expect(
      attributeRuntimeService({
        projectId: "p1",
        processCwd: "/tmp",
        commandLine: "node server.js",
        worktrees,
      }),
    ).toEqual({
      source: "project",
      confidence: "low",
      projectId: "p1",
    });
  });
});

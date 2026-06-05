import { describe, expect, it } from "vitest";
import {
  buildWorkspacePath,
  parseWorkspaceRoute,
  type WorkspaceRoute,
} from "./workspace-route.js";

function parse(path: string): WorkspaceRoute {
  const url = new URL(path, "http://example.test");
  return parseWorkspaceRoute(url);
}

describe("workspace-route", () => {
  it("parses root and monitor routes", () => {
    expect(parse("/")).toEqual({ kind: "root" });
    expect(parse("/monitor")).toEqual({ kind: "monitor" });
    expect(buildWorkspacePath({ kind: "root" })).toBe("/");
    expect(buildWorkspacePath({ kind: "monitor" })).toBe("/monitor");
  });

  it("round-trips session routes with escaped ids", () => {
    const route = { kind: "session", sessionId: "session:123" } as const;
    const path = buildWorkspacePath(route);

    expect(path).toBe("/sessions/session%3A123");
    expect(parse(path)).toEqual(route);
  });

  it("round-trips browser pane routes with project context", () => {
    const route = {
      kind: "pane",
      paneId: "browser:abc",
      projectId: "project-1",
    } as const;

    expect(parse(buildWorkspacePath(route))).toEqual(route);
  });

  it("round-trips worktree routes with encoded paths and tab", () => {
    const route = {
      kind: "worktree",
      projectId: "project-1",
      worktreePath: "/repo/feature a",
      tab: "git",
    } as const;

    expect(parse(buildWorkspacePath(route))).toEqual(route);
  });

  it("falls back invalid routes to root", () => {
    expect(parse("/nope")).toEqual({ kind: "root" });
    expect(parse("/debug")).toEqual({ kind: "root" });
    expect(parse("/worktree?project=p1")).toEqual({ kind: "root" });
  });
});

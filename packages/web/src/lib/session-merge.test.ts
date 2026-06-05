import type { Session } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { mergeOptimisticSessions } from "./session-merge.js";

function session(id: string): Session {
  return {
    id,
    projectId: "p1",
    title: "bash",
    command: { type: "shell" },
    cwd: "/home",
    shell: "bash",
    state: "running",
    pid: 1234,
    createdAt: 1000,
    generation: 0,
  };
}

describe("mergeOptimisticSessions", () => {
  it("returns the server list unchanged when there are no optimistic sessions", () => {
    const sessions = [session("a")];
    expect(mergeOptimisticSessions(sessions, [])).toBe(sessions);
  });

  it("returns the server list unchanged (same reference) when every optimistic session already exists", () => {
    const sessions = [session("a"), session("b")];
    const result = mergeOptimisticSessions(sessions, [
      session("a"),
      session("b"),
    ]);
    expect(result).toBe(sessions);
  });

  it("appends only the optimistic sessions missing from the server list, preserving order", () => {
    const sessions = [session("a"), session("b")];
    const result = mergeOptimisticSessions(sessions, [
      session("b"),
      session("c"),
    ]);
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("appends all optimistic sessions when none are present", () => {
    const sessions = [session("a")];
    const result = mergeOptimisticSessions(sessions, [
      session("x"),
      session("y"),
    ]);
    expect(result.map((s) => s.id)).toEqual(["a", "x", "y"]);
  });

  it("keeps the server session on id collision (does not duplicate)", () => {
    const server = session("a");
    server.title = "server";
    const optimistic = session("a");
    optimistic.title = "optimistic";
    const result = mergeOptimisticSessions([server], [optimistic]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("server");
  });

  it("returns a new array when appending (does not mutate the input)", () => {
    const sessions = [session("a")];
    const result = mergeOptimisticSessions(sessions, [session("b")]);
    expect(result).not.toBe(sessions);
    expect(sessions).toHaveLength(1);
  });
});

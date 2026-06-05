import { describe, expect, it } from "vitest";
import { WorktreeCache } from "./worktree-cache.js";

describe("WorktreeCache", () => {
  it("starts empty", () => {
    const cache = new WorktreeCache();
    expect(cache.get()).toEqual({});
  });

  it("setAll replaces the full snapshot", () => {
    const cache = new WorktreeCache();
    cache.setAll({
      p1: [{ path: "/tmp/p1", head: "abc", branch: "main" }],
    });
    expect(cache.get()).toEqual({
      p1: [{ path: "/tmp/p1", head: "abc", branch: "main" }],
    });
  });

  it("setProject upserts per project without disturbing others", () => {
    const cache = new WorktreeCache();
    cache.setAll({
      p1: [{ path: "/tmp/p1", head: "a", branch: "main" }],
      p2: [{ path: "/tmp/p2", head: "b", branch: "main" }],
    });
    cache.setProject("p1", [
      { path: "/tmp/p1", head: "a", branch: "main" },
      { path: "/tmp/p1.feat", head: "c", branch: "feat" },
    ]);
    expect(cache.get().p1).toHaveLength(2);
    expect(cache.get().p2).toEqual([
      { path: "/tmp/p2", head: "b", branch: "main" },
    ]);
  });

  it("removeProject drops the key", () => {
    const cache = new WorktreeCache();
    cache.setAll({
      p1: [{ path: "/tmp/p1", head: "a", branch: "main" }],
      p2: [{ path: "/tmp/p2", head: "b", branch: "main" }],
    });
    cache.removeProject("p1");
    expect(cache.get()).toEqual({
      p2: [{ path: "/tmp/p2", head: "b", branch: "main" }],
    });
  });

  it("removeProject is a no-op for unknown ids", () => {
    const cache = new WorktreeCache();
    cache.setAll({ p1: [] });
    const before = cache.get();
    cache.removeProject("missing");
    expect(cache.get()).toBe(before);
  });

  it("appendWorktree adds new entries", () => {
    const cache = new WorktreeCache();
    cache.appendWorktree("p1", { path: "/tmp/p1", head: "a", branch: "main" });
    cache.appendWorktree("p1", {
      path: "/tmp/p1.feat",
      head: "b",
      branch: "feat",
    });
    expect(cache.get().p1).toHaveLength(2);
  });

  it("appendWorktree upserts by path (merges later fields onto existing entry)", () => {
    const cache = new WorktreeCache();
    const wt = { path: "/tmp/p1", head: "a", branch: "main" };
    cache.appendWorktree("p1", wt);
    cache.appendWorktree("p1", { ...wt, head: "different", ahead: 2 });
    expect(cache.get().p1).toEqual([
      { path: "/tmp/p1", head: "different", branch: "main", ahead: 2 },
    ]);
  });

  it("appendWorktree does not duplicate the entry when paths match", () => {
    const cache = new WorktreeCache();
    const wt = { path: "/tmp/p1", head: "a", branch: "main" };
    cache.appendWorktree("p1", wt);
    cache.appendWorktree("p1", { ...wt, dirtyCount: 5 });
    expect(cache.get().p1).toHaveLength(1);
  });

  it("returns referentially distinct snapshots after mutation", () => {
    const cache = new WorktreeCache();
    const before = cache.get();
    cache.appendWorktree("p1", { path: "/tmp/p1", head: "a", branch: "main" });
    expect(cache.get()).not.toBe(before);
  });

  describe("removeWorktree", () => {
    it("drops the matching entry by path", () => {
      const cache = new WorktreeCache();
      cache.setAll({
        p1: [
          { path: "/tmp/p1", head: "a", branch: "main" },
          { path: "/tmp/p1.feat", head: "b", branch: "feat" },
        ],
      });
      cache.removeWorktree("p1", "/tmp/p1.feat");
      expect(cache.get().p1).toEqual([
        { path: "/tmp/p1", head: "a", branch: "main" },
      ]);
    });

    it("is a no-op when the project is unknown", () => {
      const cache = new WorktreeCache();
      cache.setAll({ p1: [{ path: "/tmp/p1", head: "a", branch: "main" }] });
      const before = cache.get();
      cache.removeWorktree("missing", "/tmp/whatever");
      expect(cache.get()).toBe(before);
    });

    it("is a no-op when the path is absent in the project", () => {
      const cache = new WorktreeCache();
      cache.setAll({ p1: [{ path: "/tmp/p1", head: "a", branch: "main" }] });
      const before = cache.get();
      cache.removeWorktree("p1", "/tmp/not-here");
      expect(cache.get()).toBe(before);
    });

    it("returns a referentially distinct snapshot when it removes", () => {
      const cache = new WorktreeCache();
      cache.setAll({ p1: [{ path: "/tmp/p1", head: "a", branch: "main" }] });
      const before = cache.get();
      cache.removeWorktree("p1", "/tmp/p1");
      expect(cache.get()).not.toBe(before);
      expect(cache.get().p1).toEqual([]);
    });
  });
});

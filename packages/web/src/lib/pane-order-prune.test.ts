import { describe, expect, it } from "vitest";
import { prunePaneOrderForReorder } from "./pane-order-prune.js";

describe("prunePaneOrderForReorder", () => {
  it("starts from an empty store when raw input is null/empty", () => {
    expect(prunePaneOrderForReorder(null, ["/a"], "/a", ["x", "y"])).toEqual({
      "/a": ["x", "y"],
    });
    expect(prunePaneOrderForReorder("", ["/a"], "/a", ["x"])).toEqual({
      "/a": ["x"],
    });
  });

  it("drops paths not present in validPaths", () => {
    const raw = JSON.stringify({
      "/keep": ["k1"],
      "/drop": ["d1"],
      "/also-drop": ["d2"],
    });
    const next = prunePaneOrderForReorder(raw, ["/keep"], "/keep", ["fresh"]);
    expect(next).toEqual({ "/keep": ["fresh"] });
  });

  it("retains the worktreePath being written even when validPaths omits it", () => {
    const raw = JSON.stringify({ "/old": ["o1"] });
    const next = prunePaneOrderForReorder(
      raw,
      [], // server hasn't broadcast the new worktree yet
      "/brand-new",
      ["new-1"],
    );
    expect(next).toEqual({ "/brand-new": ["new-1"] });
  });

  it("overwrites existing entries for the worktreePath being written", () => {
    const raw = JSON.stringify({
      "/here": ["old-1", "old-2"],
      "/other": ["o"],
    });
    const next = prunePaneOrderForReorder(raw, ["/here", "/other"], "/here", [
      "new-1",
    ]);
    expect(next).toEqual({ "/here": ["new-1"], "/other": ["o"] });
  });

  it("returns an empty-but-write store when parse fails", () => {
    // parsePaneOrderStore tolerates garbage and returns {}; the write
    // for the current worktreePath still lands.
    expect(prunePaneOrderForReorder("not-json", ["/a"], "/a", ["x"])).toEqual({
      "/a": ["x"],
    });
  });

  it("validPaths accepts any iterable (Array / Set)", () => {
    const raw = JSON.stringify({ "/a": ["a1"], "/b": ["b1"] });
    const fromSet = prunePaneOrderForReorder(raw, new Set(["/a", "/b"]), "/a", [
      "a2",
    ]);
    expect(fromSet).toEqual({ "/a": ["a2"], "/b": ["b1"] });
  });
});

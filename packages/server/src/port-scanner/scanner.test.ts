import { describe, expect, it } from "vitest";
import {
  buildProcessTree,
  findDescendantPids,
  parseLsofOutput,
} from "./scanner.js";

describe("parseLsofOutput", () => {
  it("parses lsof -Fpn output correctly", () => {
    const output = [
      "p1234",
      "n*:3000",
      "p5678",
      "n127.0.0.1:5173",
      "p9999",
      "n[::]:8080",
    ].join("\n");

    const entries = parseLsofOutput(output);
    expect(entries).toEqual([
      { pid: 1234, port: 3000, bindsAll: true },
      { pid: 5678, port: 5173, bindsAll: false },
      { pid: 9999, port: 8080, bindsAll: true },
    ]);
  });

  it("handles 0.0.0.0 as bindsAll", () => {
    const output = "p100\nn0.0.0.0:4000";
    const entries = parseLsofOutput(output);
    expect(entries).toEqual([{ pid: 100, port: 4000, bindsAll: true }]);
  });

  it("returns empty for empty input", () => {
    expect(parseLsofOutput("")).toEqual([]);
    expect(parseLsofOutput("\n")).toEqual([]);
  });
});

describe("buildProcessTree", () => {
  it("builds parent->children map from ps output", () => {
    const output = [
      "  PID  PPID",
      "    1     0",
      "  100     1",
      "  200   100",
      "  300   100",
      "  400   200",
    ].join("\n");

    const tree = buildProcessTree(output);
    expect(tree.get(100)).toEqual(new Set([200, 300]));
    expect(tree.get(200)).toEqual(new Set([400]));
    expect(tree.has(300)).toBe(false); // 300 has no children
  });
});

describe("findDescendantPids", () => {
  it("walks tree to collect descendant PIDs", () => {
    const tree = new Map<number, Set<number>>([
      [100, new Set([200, 300])],
      [200, new Set([400])],
      [400, new Set([500])],
    ]);

    const descendants = findDescendantPids(100, tree, 5);
    expect(descendants).toEqual(new Set([200, 300, 400, 500]));
  });

  it("respects depth limit", () => {
    const tree = new Map<number, Set<number>>([
      [1, new Set([2])],
      [2, new Set([3])],
      [3, new Set([4])],
      [4, new Set([5])],
      [5, new Set([6])],
      [6, new Set([7])],
    ]);

    const descendants = findDescendantPids(1, tree, 3);
    // depth 1=2, depth 2=3, depth 3=4
    expect(descendants).toEqual(new Set([2, 3, 4]));
  });

  it("returns empty set for leaf process", () => {
    const tree = new Map<number, Set<number>>();
    expect(findDescendantPids(999, tree, 5)).toEqual(new Set());
  });
});

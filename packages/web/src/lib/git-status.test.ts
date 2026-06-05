import { describe, expect, it } from "vitest";
import { getDirStatus, getStatusColor } from "./git-status.js";

describe("getStatusColor", () => {
  it("returns correct color for each status", () => {
    expect(getStatusColor("M")).toBe("text-yellow-400");
    expect(getStatusColor("A")).toBe("text-green-400");
    expect(getStatusColor("D")).toBe("text-red-400");
    expect(getStatusColor("R")).toBe("text-blue-400");
    expect(getStatusColor("?")).toBe("text-neutral-400");
  });

  it("returns fallback for unknown status", () => {
    expect(getStatusColor("X")).toBe("text-neutral-400");
  });
});

describe("getDirStatus", () => {
  it("returns null for directory with no changed files", () => {
    expect(getDirStatus("src", { "lib/a.ts": "M" })).toBeNull();
  });

  it("returns status when child file has status", () => {
    expect(getDirStatus("src", { "src/a.ts": "M" })).toBe("M");
  });

  it("returns highest priority status across children", () => {
    const statuses = {
      "src/a.ts": "M",
      "src/b.ts": "D",
      "src/c.ts": "A",
    };
    expect(getDirStatus("src", statuses)).toBe("D");
  });

  it("prioritizes D > M > A > R > ?", () => {
    expect(getDirStatus("x", { "x/a": "?", "x/b": "R" })).toBe("R");
    expect(getDirStatus("x", { "x/a": "R", "x/b": "A" })).toBe("A");
    expect(getDirStatus("x", { "x/a": "A", "x/b": "M" })).toBe("M");
    expect(getDirStatus("x", { "x/a": "M", "x/b": "D" })).toBe("D");
  });

  it("handles root directory with '.' path", () => {
    expect(getDirStatus(".", { "file.ts": "M" })).toBe("M");
  });

  it("matches nested children", () => {
    expect(getDirStatus("src", { "src/deep/nested/file.ts": "A" })).toBe("A");
  });
});

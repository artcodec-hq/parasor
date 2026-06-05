import { describe, expect, it } from "vitest";
import { basename, extname } from "./path.js";

describe("basename", () => {
  it("returns filename from forward-slash paths", () => {
    expect(basename("a/b/c.ts")).toBe("c.ts");
  });
  it("handles Windows-style separators", () => {
    expect(basename("a\\b\\c.ts")).toBe("c.ts");
  });
  it("handles trailing slashes", () => {
    expect(basename("a/b/")).toBe("b");
  });
  it("returns the whole string when no separator", () => {
    expect(basename("index.ts")).toBe("index.ts");
  });
});

describe("extname", () => {
  it("returns lowercase extension without the dot", () => {
    expect(extname("foo.TS")).toBe("ts");
  });
  it("returns empty string for dotfiles", () => {
    expect(extname(".gitignore")).toBe("");
  });
  it("returns empty string when no extension", () => {
    expect(extname("README")).toBe("");
  });
  it("handles nested paths", () => {
    expect(extname("a/b/c.json")).toBe("json");
  });
});

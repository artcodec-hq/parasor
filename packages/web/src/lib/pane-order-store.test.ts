import { describe, expect, it } from "vitest";
import { parsePaneOrderStore } from "./pane-order-store.js";

describe("parsePaneOrderStore", () => {
  it("returns empty for null/empty input", () => {
    expect(parsePaneOrderStore(null)).toEqual({});
    expect(parsePaneOrderStore("")).toEqual({});
  });

  it("returns empty for invalid JSON", () => {
    expect(parsePaneOrderStore("not-json")).toEqual({});
  });

  it("returns empty for null literal", () => {
    expect(parsePaneOrderStore("null")).toEqual({});
  });

  it("returns empty for array root", () => {
    expect(parsePaneOrderStore('["a","b"]')).toEqual({});
  });

  it("returns empty for primitive root", () => {
    expect(parsePaneOrderStore("42")).toEqual({});
    expect(parsePaneOrderStore('"oops"')).toEqual({});
    expect(parsePaneOrderStore("true")).toEqual({});
  });

  it("drops entries whose value is not a string array", () => {
    const raw = JSON.stringify({
      "/good": ["a", "b"],
      "/numberValue": 42,
      "/nullValue": null,
      "/stringValue": "oops",
      "/mixedArray": ["a", 42, null],
    });
    expect(parsePaneOrderStore(raw)).toEqual({ "/good": ["a", "b"] });
  });

  it("preserves valid entries", () => {
    const raw = JSON.stringify({
      "/p1": ["x", "y"],
      "/p2": [],
    });
    expect(parsePaneOrderStore(raw)).toEqual({
      "/p1": ["x", "y"],
      "/p2": [],
    });
  });

  it("rejects payload exceeding the raw length cap without parsing", () => {
    // 100 KiB of valid-looking but oversized JSON.
    const huge = `"${"x".repeat(100 * 1024)}"`;
    const raw = `{"/p":[${huge}]}`;
    expect(parsePaneOrderStore(raw)).toEqual({});
  });
});

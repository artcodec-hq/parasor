import { describe, expect, it } from "vitest";
import { shellEscape, shellEscapeJoin } from "./shell-escape.js";

describe("shellEscape", () => {
  it("wraps plain strings in single quotes", () => {
    expect(shellEscape("foo")).toBe("'foo'");
  });
  it("escapes embedded single quotes via '\\''", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });
  it("handles empty string as ''", () => {
    expect(shellEscape("")).toBe("''");
  });
  it("quotes paths with spaces", () => {
    expect(shellEscape("/a b/c.txt")).toBe("'/a b/c.txt'");
  });
  it("quotes shell metacharacters literally", () => {
    expect(shellEscape("$(rm -rf /)")).toBe("'$(rm -rf /)'");
    expect(shellEscape("`whoami`")).toBe("'`whoami`'");
    expect(shellEscape("a;b|c&d")).toBe("'a;b|c&d'");
  });
  it("preserves backslash and newline inside quotes", () => {
    expect(shellEscape("a\\b\nc")).toBe("'a\\b\nc'");
  });
  it("preserves tab and multibyte characters", () => {
    expect(shellEscape("a\tb")).toBe("'a\tb'");
    expect(shellEscape("日本語.txt")).toBe("'日本語.txt'");
  });
});

describe("shellEscapeJoin", () => {
  it("joins multiple escaped args with single space", () => {
    expect(shellEscapeJoin(["a", "b c", "it's"])).toBe("'a' 'b c' 'it'\\''s'");
  });
  it("returns empty string for empty array", () => {
    expect(shellEscapeJoin([])).toBe("");
  });
});

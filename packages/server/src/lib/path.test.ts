import { describe, expect, it } from "vitest";
import { expandUserHome } from "./path.js";

describe("expandUserHome", () => {
  const home = "/Users/test";

  it("expands ~/ to home + remainder", () => {
    expect(expandUserHome("~/projects/foo", home)).toBe(
      "/Users/test/projects/foo",
    );
  });

  it("expands bare ~ to home", () => {
    expect(expandUserHome("~", home)).toBe("/Users/test");
  });

  it("leaves absolute paths untouched", () => {
    expect(expandUserHome("/etc/hosts", home)).toBe("/etc/hosts");
  });

  it("leaves relative paths untouched", () => {
    expect(expandUserHome("foo/bar", home)).toBe("foo/bar");
  });

  it("does not expand ~user style", () => {
    expect(expandUserHome("~someone/x", home)).toBe("~someone/x");
  });
});

import { describe, expect, it } from "vitest";
import { nextDuplicateName, splitName } from "./duplicate-name.js";

describe("splitName", () => {
  it("splits regular file name into base + ext", () => {
    expect(splitName("foo.txt", "file")).toEqual({ base: "foo", ext: ".txt" });
  });

  it("treats leading-dot only file as no extension", () => {
    expect(splitName(".env", "file")).toEqual({ base: ".env", ext: "" });
    expect(splitName(".gitignore", "file")).toEqual({
      base: ".gitignore",
      ext: "",
    });
  });

  it("uses last dot for double-extension files", () => {
    expect(splitName("foo.tar.gz", "file")).toEqual({
      base: "foo.tar",
      ext: ".gz",
    });
  });

  it("treats files without dot as no extension", () => {
    expect(splitName("Makefile", "file")).toEqual({
      base: "Makefile",
      ext: "",
    });
  });

  it("treats directories as no extension regardless of name", () => {
    expect(splitName("src.lib", "directory")).toEqual({
      base: "src.lib",
      ext: "",
    });
  });
});

describe("nextDuplicateName", () => {
  it("returns '<base> copy.<ext>' on first duplicate", () => {
    expect(nextDuplicateName("foo.txt", "file", ["foo.txt"])).toBe(
      "foo copy.txt",
    );
  });

  it("returns '<base> copy 2.<ext>' when copy already exists", () => {
    expect(
      nextDuplicateName("foo.txt", "file", ["foo.txt", "foo copy.txt"]),
    ).toBe("foo copy 2.txt");
  });

  it("skips taken numbered slots", () => {
    expect(
      nextDuplicateName("foo.txt", "file", [
        "foo.txt",
        "foo copy.txt",
        "foo copy 2.txt",
        "foo copy 3.txt",
      ]),
    ).toBe("foo copy 4.txt");
  });

  it("works on extensionless files", () => {
    expect(nextDuplicateName("Makefile", "file", ["Makefile"])).toBe(
      "Makefile copy",
    );
  });

  it("works on dotfiles", () => {
    expect(nextDuplicateName(".env", "file", [".env"])).toBe(".env copy");
    expect(nextDuplicateName(".env", "file", [".env", ".env copy"])).toBe(
      ".env copy 2",
    );
  });

  it("works on directories", () => {
    expect(nextDuplicateName("src", "directory", ["src"])).toBe("src copy");
    expect(nextDuplicateName("src", "directory", ["src", "src copy"])).toBe(
      "src copy 2",
    );
  });

  it("treats directories with dots as no extension", () => {
    expect(nextDuplicateName("my.app", "directory", ["my.app"])).toBe(
      "my.app copy",
    );
  });
});

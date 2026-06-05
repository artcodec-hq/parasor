import { describe, expect, it } from "vitest";
import { validateEntryName } from "./FileTreePane.js";

const PATH_SEP_ERROR = "Name cannot contain '/' or '\\'.";
const CONTROL_CHAR_ERROR = "Name contains control characters.";

describe("validateEntryName", () => {
  it("accepts plain names", () => {
    expect(validateEntryName("README.md")).toBeNull();
    expect(validateEntryName("index.ts")).toBeNull();
  });

  it("accepts leading-dot project files", () => {
    expect(validateEntryName(".env")).toBeNull();
    expect(validateEntryName(".envrc")).toBeNull();
    expect(validateEntryName(".gitignore")).toBeNull();
    expect(validateEntryName(".github")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(validateEntryName("")).toBe("Name cannot be empty.");
  });

  it("rejects '.' and '..' self references", () => {
    expect(validateEntryName(".")).toBe("Name cannot be '.' or '..'.");
    expect(validateEntryName("..")).toBe("Name cannot be '.' or '..'.");
  });

  it("rejects path separators", () => {
    expect(validateEntryName("foo/bar")).toBe(PATH_SEP_ERROR);
    expect(validateEntryName("foo\\bar")).toBe(PATH_SEP_ERROR);
    expect(validateEntryName("../escape")).toBe(PATH_SEP_ERROR);
  });

  it("rejects control characters", () => {
    expect(validateEntryName("foo\x00bar")).toBe(CONTROL_CHAR_ERROR);
    expect(validateEntryName("foo\x09bar")).toBe(CONTROL_CHAR_ERROR);
    expect(validateEntryName("foo\x7fbar")).toBe(CONTROL_CHAR_ERROR);
  });

  it("rejects names hard-excluded by the server", () => {
    expect(validateEntryName(".git")).toBe(
      "'.git' is reserved and won't appear in the tree.",
    );
    expect(validateEntryName(".DS_Store")).toBe(
      "'.DS_Store' is reserved and won't appear in the tree.",
    );
    expect(validateEntryName("Thumbs.db")).toBe(
      "'Thumbs.db' is reserved and won't appear in the tree.",
    );
  });
});

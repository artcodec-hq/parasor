import { describe, expect, it } from "vitest";
import { parseDiff, statusColor } from "./diff-render.js";

describe("parseDiff", () => {
  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("parses a plain modified file", () => {
    const raw = [
      "diff --git a/foo.ts b/foo.ts",
      "index abc..def 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("Modified");
    expect(files[0].path).toBe("foo.ts");
    expect(files[0].added).toBe(1);
    expect(files[0].removed).toBe(1);
  });

  it("parses an added file (--- /dev/null)", () => {
    const raw = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "index 0000000..abc",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,1 @@",
      "+hello",
      "",
    ].join("\n");
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("Added");
    expect(files[0].path).toBe("new.ts");
  });

  it("parses a removed file (+++ /dev/null)", () => {
    const raw = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "index abc..0000000",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-bye",
      "",
    ].join("\n");
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("Removed");
    expect(files[0].path).toBe("gone.ts");
  });

  it("parses a renamed file", () => {
    const raw = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
      "",
    ].join("\n");
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("Renamed");
    expect(files[0].path).toBe("new.ts");
    expect(files[0].oldPath).toBe("old.ts");
  });

  it("recovers the path from quoted `+++ b/...` headers", () => {
    // git quotes paths containing spaces or non-ASCII bytes. The bare
    // `diff --git` capture would yield an empty path for these -- the
    // `+++ b/...` header is the authoritative source.
    const raw = [
      'diff --git "a/foo bar.ts" "b/foo bar.ts"',
      "index abc..def 100644",
      '--- "a/foo bar.ts"',
      '+++ "b/foo bar.ts"',
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
      "",
    ].join("\n");
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("foo bar.ts");
  });

  it("parses multiple files in one diff", () => {
    const raw = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-1",
      "+2",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,1 @@",
      "-3",
      "+4",
      "",
    ].join("\n");
    const files = parseDiff(raw);
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("statusColor", () => {
  it("uses the Git modified token for modified files", () => {
    expect(statusColor("Modified")).toBe("text-[var(--theme-git-modified)]");
  });
});

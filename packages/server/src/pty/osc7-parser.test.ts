import { beforeEach, describe, expect, it } from "vitest";
import { Osc7Parser, parseFileUri } from "./osc7-parser.js";

describe("Osc7Parser", () => {
  let parser: Osc7Parser;

  beforeEach(() => {
    parser = new Osc7Parser();
  });

  it("parses OSC 7 with BEL terminator", () => {
    const result = parser.feed(
      "\x1b]7;file://localhost/Users/akibe/projects\x07",
    );
    expect(result).toBe("/Users/akibe/projects");
  });

  it("parses OSC 7 with ST terminator", () => {
    const result = parser.feed(
      "\x1b]7;file://localhost/Users/akibe/projects\x1b\\",
    );
    expect(result).toBe("/Users/akibe/projects");
  });

  it("parses OSC 7 with empty hostname", () => {
    const result = parser.feed("\x1b]7;file:///home/user/src\x07");
    expect(result).toBe("/home/user/src");
  });

  it("decodes percent-encoded paths", () => {
    const result = parser.feed(
      "\x1b]7;file://localhost/Users/akibe/my%20project\x07",
    );
    expect(result).toBe("/Users/akibe/my project");
  });

  it("returns null for non-OSC data", () => {
    const result = parser.feed("hello world\r\n");
    expect(result).toBeNull();
  });

  it("returns last CWD when multiple OSC 7 in one chunk", () => {
    const data =
      "\x1b]7;file://localhost/Users/a\x07" +
      "some output\r\n" +
      "\x1b]7;file://localhost/Users/b\x07";
    const result = parser.feed(data);
    expect(result).toBe("/Users/b");
  });

  it("handles sequence split across two chunks", () => {
    const r1 = parser.feed("output\x1b]7;file://local");
    expect(r1).toBeNull();
    const r2 = parser.feed("host/Users/akibe\x07more output");
    expect(r2).toBe("/Users/akibe");
  });

  it("handles terminator split across chunks", () => {
    const r1 = parser.feed("\x1b]7;file://localhost/home/user\x1b");
    expect(r1).toBeNull();
    const r2 = parser.feed("\\rest of output");
    expect(r2).toBe("/home/user");
  });

  it("extracts OSC 7 embedded in terminal output", () => {
    const data =
      "user@host:~ $ cd /tmp\r\n\x1b]7;file://localhost/tmp\x07user@host:/tmp $ ";
    const result = parser.feed(data);
    expect(result).toBe("/tmp");
  });

  it("rejects non-local hostname", () => {
    const result = parser.feed("\x1b]7;file://evil-host/etc/passwd\x07");
    expect(result).toBeNull();
  });

  it("discards oversized partial buffer", () => {
    const longPath = "x".repeat(5000);
    parser.feed(`\x1b]7;file://localhost/${longPath}`);
    // Partial exceeded MAX_PARTIAL, should be discarded
    const result = parser.feed("\x07");
    expect(result).toBeNull();
  });

  it("reset clears partial buffer", () => {
    parser.feed("\x1b]7;file://localhost/partial");
    parser.reset();
    const result = parser.feed("host/Users/akibe\x07");
    expect(result).toBeNull();
  });

  it("ignores other OSC sequences", () => {
    const result = parser.feed("\x1b]0;window title\x07");
    expect(result).toBeNull();
  });
});

describe("parseFileUri", () => {
  it("parses standard file URI", () => {
    expect(parseFileUri("file://localhost/Users/akibe")).toBe("/Users/akibe");
  });

  it("parses file URI with empty host", () => {
    expect(parseFileUri("file:///home/user")).toBe("/home/user");
  });

  it("decodes percent-encoded characters", () => {
    expect(parseFileUri("file://localhost/path%20with%20spaces")).toBe(
      "/path with spaces",
    );
  });

  it("rejects non-local hostname", () => {
    expect(parseFileUri("file://evil-host/etc/passwd")).toBeNull();
  });

  it("returns null for invalid percent encoding", () => {
    expect(parseFileUri("file://localhost/bad%ZZpath")).toBeNull();
  });

  it("returns null for non-file URI", () => {
    expect(parseFileUri("http://example.com")).toBeNull();
  });

  it("returns null for URI without path", () => {
    expect(parseFileUri("file://hostname")).toBeNull();
  });

  it("normalizes .. segments in path", () => {
    expect(parseFileUri("file://localhost/home/user/../../../etc/passwd")).toBe(
      "/etc/passwd",
    );
  });
});

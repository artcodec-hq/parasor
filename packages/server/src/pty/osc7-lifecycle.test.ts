import { beforeEach, describe, expect, it } from "vitest";
import { Osc7Lifecycle } from "./osc7-lifecycle.js";

describe("Osc7Lifecycle", () => {
  let lifecycle: Osc7Lifecycle;

  beforeEach(() => {
    lifecycle = new Osc7Lifecycle();
  });

  it("lazy-creates parser on first feed", () => {
    expect(lifecycle.has("s1")).toBe(false);
    lifecycle.feed("s1", "hello");
    expect(lifecycle.has("s1")).toBe(true);
  });

  it("returns CWD when OSC 7 sequence is detected", () => {
    const cwd = lifecycle.feed("s1", "\x1b]7;file://localhost/home/user\x07");
    expect(cwd).toBe("/home/user");
  });

  it("returns null for data without OSC 7", () => {
    expect(lifecycle.feed("s1", "plain text output")).toBeNull();
  });

  it("handles partial sequences across feeds", () => {
    expect(lifecycle.feed("s1", "\x1b]7;file://localhost/ho")).toBeNull();
    const cwd = lifecycle.feed("s1", "me/user\x07");
    expect(cwd).toBe("/home/user");
  });

  it("tracks separate parsers per session", () => {
    lifecycle.feed("s1", "\x1b]7;file:///dir-a\x07");
    lifecycle.feed("s2", "\x1b]7;file:///dir-b\x07");
    expect(lifecycle.size).toBe(2);
    expect(lifecycle.has("s1")).toBe(true);
    expect(lifecycle.has("s2")).toBe(true);
  });

  it("removeSession deletes the parser", () => {
    lifecycle.feed("s1", "data");
    expect(lifecycle.has("s1")).toBe(true);
    lifecycle.removeSession("s1");
    expect(lifecycle.has("s1")).toBe(false);
    expect(lifecycle.size).toBe(0);
  });

  it("removeSession is safe for unknown session", () => {
    lifecycle.removeSession("unknown");
    expect(lifecycle.size).toBe(0);
  });

  it("re-creates parser after removal on new data", () => {
    lifecycle.feed("s1", "\x1b]7;file:///first\x07");
    lifecycle.removeSession("s1");
    const cwd = lifecycle.feed("s1", "\x1b]7;file:///second\x07");
    expect(cwd).toBe("/second");
    expect(lifecycle.has("s1")).toBe(true);
  });

  it("partial state is lost after removal", () => {
    lifecycle.feed("s1", "\x1b]7;file:///ho");
    lifecycle.removeSession("s1");
    // The partial "\x1b]7;file:///ho" is gone, so "me\x07" alone won't match
    expect(lifecycle.feed("s1", "me\x07")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { isAutoResumable } from "./session-resume.js";

describe("isAutoResumable", () => {
  it("returns true for shell + exit", () => {
    expect(isAutoResumable({ type: "shell" }, { type: "exit", code: 0 })).toBe(
      true,
    );
  });

  it("returns true for claude + server-graceful", () => {
    expect(
      isAutoResumable({ type: "claude" }, { type: "server-graceful" }),
    ).toBe(true);
  });

  it("returns false for server-crash regardless of command", () => {
    expect(isAutoResumable({ type: "shell" }, { type: "server-crash" })).toBe(
      false,
    );
    expect(isAutoResumable({ type: "claude" }, { type: "server-crash" })).toBe(
      false,
    );
  });

  it("returns true for shell + daemon-graceful (PTY host restart preserves session)", () => {
    expect(
      isAutoResumable({ type: "shell" }, { type: "daemon-graceful" }),
    ).toBe(true);
    expect(
      isAutoResumable({ type: "claude" }, { type: "daemon-graceful" }),
    ).toBe(true);
  });

  it("returns false for daemon-crash regardless of command (orphan risk)", () => {
    expect(isAutoResumable({ type: "shell" }, { type: "daemon-crash" })).toBe(
      false,
    );
    expect(isAutoResumable({ type: "claude" }, { type: "daemon-crash" })).toBe(
      false,
    );
  });

  it("returns false for custom commands (side-effect unknown)", () => {
    expect(
      isAutoResumable(
        { type: "custom", command: "python", args: ["x.py"] },
        { type: "exit", code: 0 },
      ),
    ).toBe(false);
  });

  it("returns false when endReason or command is missing", () => {
    expect(isAutoResumable(undefined, { type: "exit", code: 0 })).toBe(false);
    expect(isAutoResumable({ type: "shell" }, undefined)).toBe(false);
  });
});

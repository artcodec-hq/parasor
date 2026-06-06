import { describe, expect, it } from "vitest";
import { isOpenCodeTerminalSession } from "./terminal-session-agent.js";

describe("isOpenCodeTerminalSession", () => {
  it("detects custom opencode commands", () => {
    expect(
      isOpenCodeTerminalSession({
        sessionCommand: { type: "custom", command: "opencode", args: [] },
      }),
    ).toBe(true);
    expect(
      isOpenCodeTerminalSession({
        sessionCommand: {
          type: "custom",
          command: "/opt/homebrew/bin/opencode",
          args: [],
        },
      }),
    ).toBe(true);
    expect(
      isOpenCodeTerminalSession({
        sessionCommand: {
          type: "custom",
          command: "env",
          args: ["OPENCODE_CONFIG=/tmp/config.json", "opencode"],
        },
      }),
    ).toBe(true);
  });

  it("detects manual shell sessions by title", () => {
    expect(
      isOpenCodeTerminalSession({
        sessionCommand: { type: "shell" },
        sessionTitle: "opencode",
      }),
    ).toBe(true);
  });

  it("does not enable for codex, claude, or ordinary shell sessions", () => {
    expect(
      isOpenCodeTerminalSession({
        sessionCommand: { type: "custom", command: "codex", args: [] },
        sessionTitle: "codex",
      }),
    ).toBe(false);
    expect(
      isOpenCodeTerminalSession({
        sessionCommand: { type: "claude" },
        sessionTitle: "claude",
      }),
    ).toBe(false);
    expect(
      isOpenCodeTerminalSession({
        sessionCommand: { type: "shell" },
        sessionTitle: "zsh",
      }),
    ).toBe(false);
  });
});

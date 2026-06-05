import type { Session } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { shouldObserveAgentOutput } from "./output-eligibility.js";

function makeSession(
  overrides: Partial<Session> & Pick<Session, "command">,
): Session {
  return {
    id: "session-1",
    projectId: "project-1",
    pid: 123,
    state: "running",
    generation: 1,
    title: "terminal",
    cwd: "/tmp",
    shell: "/bin/zsh",
    createdAt: 1,
    ...overrides,
  };
}

describe("shouldObserveAgentOutput", () => {
  it("does not observe plain shell sessions", () => {
    expect(
      shouldObserveAgentOutput(
        makeSession({ command: { type: "shell" } }),
        "zsh",
      ),
    ).toBe(false);
  });

  it("observes dedicated claude sessions", () => {
    expect(
      shouldObserveAgentOutput(
        makeSession({ command: { type: "claude" } }),
        "claude",
      ),
    ).toBe(true);
  });

  it("does not observe shell-launched agents until the manual tracker engages", () => {
    expect(
      shouldObserveAgentOutput(
        makeSession({ command: { type: "shell" } }),
        "codex",
      ),
    ).toBe(false);
    expect(
      shouldObserveAgentOutput(
        makeSession({ command: { type: "shell" } }),
        "gemini-cli",
      ),
    ).toBe(false);
  });

  it("observes custom sessions when a known agent process is foreground", () => {
    expect(
      shouldObserveAgentOutput(
        makeSession({
          command: {
            type: "custom",
            command: "/bin/sh",
            args: ["-lc", "codex"],
          },
        }),
        "codex",
      ),
    ).toBe(true);
  });

  it("observes custom commands that directly launch an agent binary", () => {
    expect(
      shouldObserveAgentOutput(
        makeSession({
          command: {
            type: "custom",
            command: "/usr/local/bin/opencode",
            args: [],
          },
        }),
        "opencode",
      ),
    ).toBe(true);
  });
});

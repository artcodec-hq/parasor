import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the shared HTTP client so we don't need a real server. vi.mock
// is hoisted above import statements, so the factory has to use vi.hoisted
// rather than referencing module-level consts.
const { postHookNotifyMock } = vi.hoisted(() => ({
  postHookNotifyMock: vi.fn<
    (args: {
      sessionId: string;
      agent: string;
      event: string;
    }) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
}));
vi.mock("./hook-client.js", () => ({
  postHookNotify: postHookNotifyMock,
}));

import { cliHook, parseClaudeEvent } from "./hook.js";

interface ProcessExitError extends Error {
  exitCode: number;
}

function patchExit(): () => void {
  const original = process.exit;
  process.exit = ((code?: number) => {
    const err: ProcessExitError = Object.assign(
      new Error(`process.exit(${code ?? 0})`),
      { exitCode: code ?? 0 },
    );
    throw err;
  }) as never;
  return () => {
    process.exit = original;
  };
}

async function runHook(args: string[], stdinPayload?: string): Promise<number> {
  const restoreExit = patchExit();

  // Replace process.stdin with a synthetic ReadableStream-ish object the
  // CLI's readStdin() can consume. We just emit one chunk + end.
  const originalStdin = process.stdin;
  if (stdinPayload !== undefined) {
    const handlers = new Map<string, Array<(arg?: unknown) => void>>();
    const fakeStdin = {
      isTTY: false,
      setEncoding: () => {},
      on: (event: string, handler: (arg?: unknown) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    };
    Object.defineProperty(process, "stdin", {
      value: fakeStdin,
      configurable: true,
    });

    queueMicrotask(() => {
      handlers.get("data")?.forEach((h) => {
        h(stdinPayload);
      });
      handlers.get("end")?.forEach((h) => {
        h();
      });
    });
  }

  let exitCode = 0;
  try {
    await cliHook(args);
  } catch (err) {
    if ((err as ProcessExitError).exitCode !== undefined) {
      exitCode = (err as ProcessExitError).exitCode;
    } else {
      throw err;
    }
  } finally {
    restoreExit();
    if (stdinPayload !== undefined) {
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        configurable: true,
      });
    }
  }
  return exitCode;
}

describe("cliHook", () => {
  let originalSession: string | undefined;

  beforeEach(() => {
    postHookNotifyMock.mockClear();
    postHookNotifyMock.mockResolvedValue({ ok: true });
    originalSession = process.env.PARASOR_SESSION_ID;
    process.env.PARASOR_SESSION_ID = "test-session";
  });

  afterEach(() => {
    if (originalSession === undefined) {
      delete process.env.PARASOR_SESSION_ID;
    } else {
      process.env.PARASOR_SESSION_ID = originalSession;
    }
  });

  it("rejects unknown agents with exit 1", async () => {
    const code = await runHook(["cursor"], '{"hook_event_name":"Stop"}');
    expect(code).toBe(1);
    expect(postHookNotifyMock).not.toHaveBeenCalled();
  });

  it("rejects when help/usage is requested with no agent", async () => {
    const code = await runHook([], "");
    expect(code).toBe(1);
  });

  it("forwards Claude UserPromptSubmit from stdin JSON", async () => {
    const code = await runHook(
      ["claude"],
      '{"hook_event_name":"UserPromptSubmit","extra":"ignored"}',
    );
    expect(code).toBe(0);
    expect(postHookNotifyMock).toHaveBeenCalledWith({
      sessionId: "test-session",
      agent: "claude",
      event: "UserPromptSubmit",
    });
  });

  it("forwards Codex agent_turn_complete from argv (not stdin)", async () => {
    const payload = JSON.stringify({ type: "agent_turn_complete" });
    const code = await runHook(["codex", payload]);
    expect(code).toBe(0);
    expect(postHookNotifyMock).toHaveBeenCalledWith({
      sessionId: "test-session",
      agent: "codex",
      event: "agent_turn_complete",
    });
  });

  it("falls back to legacy `event` field for codex", async () => {
    const code = await runHook([
      "codex",
      JSON.stringify({ event: "task_started" }),
    ]);
    expect(code).toBe(0);
    expect(postHookNotifyMock).toHaveBeenCalledWith({
      sessionId: "test-session",
      agent: "codex",
      event: "task_started",
    });
  });

  it("prefers hook_event_name for codex native hook payloads", async () => {
    const code = await runHook([
      "codex",
      JSON.stringify({ hook_event_name: "Stop", type: "task_started" }),
    ]);
    expect(code).toBe(0);
    expect(postHookNotifyMock).toHaveBeenCalledWith({
      sessionId: "test-session",
      agent: "codex",
      event: "Stop",
    });
  });

  it("exits 0 silently when PARASOR_SESSION_ID is missing", async () => {
    delete process.env.PARASOR_SESSION_ID;
    const code = await runHook(["claude"], '{"hook_event_name":"Stop"}');
    expect(code).toBe(0);
    expect(postHookNotifyMock).not.toHaveBeenCalled();
  });

  it("exits 0 silently when stdin/argv have no payload", async () => {
    const code = await runHook(["claude"], "");
    expect(code).toBe(0);
    expect(postHookNotifyMock).not.toHaveBeenCalled();
  });

  it("exits 0 silently when JSON parsing fails (does not break the agent)", async () => {
    const code = await runHook(["claude"], "not-json{");
    expect(code).toBe(0);
    expect(postHookNotifyMock).not.toHaveBeenCalled();
  });

  it("exits 0 silently when the Claude payload has no event name", async () => {
    const code = await runHook(["claude"], '{"unrelated":"value"}');
    expect(code).toBe(0);
    expect(postHookNotifyMock).not.toHaveBeenCalled();
  });

  it("exits 0 silently when the HTTP post fails (does not break the agent)", async () => {
    postHookNotifyMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    const code = await runHook(["claude"], '{"hook_event_name":"Stop"}');
    expect(code).toBe(0);
    expect(postHookNotifyMock).toHaveBeenCalled();
  });

  it("logs to stderr when PARASOR_HOOK_DEBUG=1 and post fails", async () => {
    postHookNotifyMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalDebug = process.env.PARASOR_HOOK_DEBUG;
    process.env.PARASOR_HOOK_DEBUG = "1";
    try {
      const code = await runHook(["claude"], '{"hook_event_name":"Stop"}');
      expect(code).toBe(0);
      // Two debug lines fire when DEBUG=1 + post fails: one for the parsed
      // event, and one for the post failure. Find the boom line by content.
      const allLogs = errSpy.mock.calls.map((c) => String(c[0] ?? ""));
      expect(allLogs.some((l) => l.includes("parasor hook claude"))).toBe(true);
      expect(allLogs.some((l) => l.includes("boom"))).toBe(true);
    } finally {
      if (originalDebug === undefined) delete process.env.PARASOR_HOOK_DEBUG;
      else process.env.PARASOR_HOOK_DEBUG = originalDebug;
      errSpy.mockRestore();
    }
  });
});

describe("parseClaudeEvent", () => {
  it("returns the bare hook_event_name for events without a discriminator", () => {
    expect(parseClaudeEvent('{"hook_event_name":"Stop"}')).toBe("Stop");
    expect(parseClaudeEvent('{"hook_event_name":"UserPromptSubmit"}')).toBe(
      "UserPromptSubmit",
    );
    expect(parseClaudeEvent('{"hook_event_name":"SessionStart"}')).toBe(
      "SessionStart",
    );
  });

  it("emits PreToolUse:<tool_name> when tool_name is present", () => {
    expect(
      parseClaudeEvent(
        '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion"}',
      ),
    ).toBe("PreToolUse:AskUserQuestion");
    expect(
      parseClaudeEvent(
        '{"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode"}',
      ),
    ).toBe("PreToolUse:ExitPlanMode");
    expect(
      parseClaudeEvent('{"hook_event_name":"PreToolUse","tool_name":"Bash"}'),
    ).toBe("PreToolUse:Bash");
  });

  it("falls back to bare PreToolUse when tool_name is missing", () => {
    expect(parseClaudeEvent('{"hook_event_name":"PreToolUse"}')).toBe(
      "PreToolUse",
    );
  });

  it("emits Notification:<notification_type> when set", () => {
    expect(
      parseClaudeEvent(
        '{"hook_event_name":"Notification","notification_type":"auth_success"}',
      ),
    ).toBe("Notification:auth_success");
    expect(
      parseClaudeEvent(
        '{"hook_event_name":"Notification","notification_type":"idle_prompt"}',
      ),
    ).toBe("Notification:idle_prompt");
  });

  it("falls back to bare Notification when notification_type is missing", () => {
    expect(parseClaudeEvent('{"hook_event_name":"Notification"}')).toBe(
      "Notification",
    );
  });

  it("returns null when hook_event_name is missing or not a string", () => {
    expect(parseClaudeEvent("{}")).toBeNull();
    expect(parseClaudeEvent('{"hook_event_name":""}')).toBeNull();
    expect(parseClaudeEvent('{"hook_event_name":42}')).toBeNull();
  });
});

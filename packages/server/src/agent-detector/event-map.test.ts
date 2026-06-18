import { describe, expect, it } from "vitest";
import { isKnownAgent, mapEventType } from "./event-map.js";

function hookState(lifecycle: string) {
  return {
    kind: "state" as const,
    state: {
      lifecycle,
      source: "hook" as const,
      confidence: "high" as const,
    },
  };
}

function notifyState(lifecycle: string) {
  return {
    kind: "state" as const,
    state: {
      lifecycle,
      source: "notify" as const,
      confidence: "high" as const,
    },
  };
}

describe("isKnownAgent", () => {
  it("recognizes claude, codex, opencode, and manual", () => {
    expect(isKnownAgent("claude")).toBe(true);
    expect(isKnownAgent("codex")).toBe(true);
    expect(isKnownAgent("opencode")).toBe(true);
    expect(isKnownAgent("manual")).toBe(true);
  });
  it("rejects unknown agents", () => {
    expect(isKnownAgent("cursor")).toBe(false);
    expect(isKnownAgent("")).toBe(false);
    expect(isKnownAgent("CLAUDE")).toBe(false);
  });
});

describe("mapEventType -- manual", () => {
  it("passes through running / waiting / completed / idle directly", () => {
    expect(mapEventType("manual", "running")).toEqual(notifyState("running"));
    expect(mapEventType("manual", "waiting")).toEqual(notifyState("waiting"));
    expect(mapEventType("manual", "completed")).toEqual(
      notifyState("completed"),
    );
    expect(mapEventType("manual", "idle")).toEqual(notifyState("idle"));
  });

  it("rejects unknown manual states", () => {
    expect(mapEventType("manual", "review")).toEqual({ kind: "unknown" });
  });
});

describe("mapEventType -- claude", () => {
  it("maps UserPromptSubmit to running", () => {
    expect(mapEventType("claude", "UserPromptSubmit")).toEqual(
      hookState("running"),
    );
  });

  it("maps bare PreToolUse to running (ordinary tool loops stay autonomous)", () => {
    expect(mapEventType("claude", "PreToolUse")).toEqual(hookState("running"));
  });

  it("maps PostToolUse to running (tool finished, agent thinking again)", () => {
    expect(mapEventType("claude", "PostToolUse")).toEqual(hookState("running"));
  });

  it("maps PermissionRequest to waiting", () => {
    expect(mapEventType("claude", "PermissionRequest")).toEqual(
      hookState("waiting"),
    );
  });

  it("maps PermissionDenied to running", () => {
    expect(mapEventType("claude", "PermissionDenied")).toEqual(
      hookState("running"),
    );
  });

  it("maps Stop to completed", () => {
    expect(mapEventType("claude", "Stop")).toEqual(hookState("completed"));
  });

  it("maps bare Notification to noop", () => {
    expect(mapEventType("claude", "Notification")).toEqual({
      kind: "noop",
    });
  });

  it("maps SessionEnd to idle (Ctrl+C cleanup path)", () => {
    expect(mapEventType("claude", "SessionEnd")).toEqual(hookState("idle"));
  });

  it("maps Elicitation to waiting and ElicitationResult back to running", () => {
    expect(mapEventType("claude", "Elicitation")).toEqual(hookState("waiting"));
    expect(mapEventType("claude", "ElicitationResult")).toEqual(
      hookState("running"),
    );
  });

  it("maps SessionStart to noop (PID registration only)", () => {
    expect(mapEventType("claude", "SessionStart")).toEqual({ kind: "noop" });
  });

  it("is case-insensitive", () => {
    expect(mapEventType("claude", "stop")).toEqual(hookState("completed"));
    expect(mapEventType("claude", "STOP")).toEqual(hookState("completed"));
  });

  it("returns unknown for unrecognized events", () => {
    expect(mapEventType("claude", "ToolError")).toEqual({ kind: "unknown" });
    expect(mapEventType("claude", "")).toEqual({ kind: "unknown" });
  });

  it("maps only explicit human-handoff tools to waiting", () => {
    expect(mapEventType("claude", "PreToolUse:AskUserQuestion")).toEqual(
      hookState("waiting"),
    );
    expect(mapEventType("claude", "PreToolUse:ExitPlanMode")).toEqual(
      hookState("waiting"),
    );
  });

  it("falls back ordinary PreToolUse tools to running", () => {
    expect(mapEventType("claude", "PreToolUse:Bash")).toEqual(
      hookState("running"),
    );
    expect(mapEventType("claude", "PreToolUse:Edit")).toEqual(
      hookState("running"),
    );
  });

  it("maps Notification:auth_success to noop (not waiting)", () => {
    expect(mapEventType("claude", "Notification:auth_success")).toEqual({
      kind: "noop",
    });
  });

  it("maps only documented human-input notifications to waiting", () => {
    expect(mapEventType("claude", "Notification:permission_prompt")).toEqual(
      hookState("waiting"),
    );
    expect(mapEventType("claude", "Notification:idle_prompt")).toEqual(
      hookState("waiting"),
    );
    expect(mapEventType("claude", "Notification:elicitation_dialog")).toEqual(
      hookState("waiting"),
    );
  });

  it("falls back unknown Notification subtypes to noop", () => {
    expect(mapEventType("claude", "Notification:future_subtype")).toEqual({
      kind: "noop",
    });
  });
});

describe("mapEventType -- codex", () => {
  it("maps SessionStart to noop and UserPromptSubmit to running", () => {
    expect(mapEventType("codex", "SessionStart")).toEqual({ kind: "noop" });
    expect(mapEventType("codex", "UserPromptSubmit")).toEqual(
      hookState("running"),
    );
  });

  it("maps native Codex tool and permission hooks", () => {
    expect(mapEventType("codex", "PostToolUse")).toEqual(hookState("running"));
    expect(mapEventType("codex", "PermissionRequest")).toEqual(
      hookState("waiting"),
    );
  });

  it("maps task_started to running", () => {
    expect(mapEventType("codex", "task_started")).toEqual(hookState("running"));
  });

  it("maps exec_command_begin and turn_started to running", () => {
    expect(mapEventType("codex", "exec_command_begin")).toEqual(
      hookState("running"),
    );
    expect(mapEventType("codex", "turn_started")).toEqual(hookState("running"));
  });

  it("maps agent-turn-started (dash form) to running", () => {
    expect(mapEventType("codex", "agent-turn-started")).toEqual(
      hookState("running"),
    );
  });

  it("maps agent_turn_complete (underscore) to completed", () => {
    expect(mapEventType("codex", "agent_turn_complete")).toEqual(
      hookState("completed"),
    );
  });

  it("maps agent-turn-complete (dash) to completed", () => {
    expect(mapEventType("codex", "agent-turn-complete")).toEqual(
      hookState("completed"),
    );
  });

  it("maps task_complete to completed", () => {
    expect(mapEventType("codex", "task_complete")).toEqual(
      hookState("completed"),
    );
  });

  it("maps Stop and turn_complete to completed", () => {
    expect(mapEventType("codex", "Stop")).toEqual(hookState("completed"));
    expect(mapEventType("codex", "turn_complete")).toEqual(
      hookState("completed"),
    );
  });

  it("maps exec_approval_request to waiting", () => {
    expect(mapEventType("codex", "exec_approval_request")).toEqual(
      hookState("waiting"),
    );
  });

  it("maps apply_patch_approval_request to waiting", () => {
    expect(mapEventType("codex", "apply_patch_approval_request")).toEqual(
      hookState("waiting"),
    );
  });

  it("maps request_user_input to waiting", () => {
    expect(mapEventType("codex", "request_user_input")).toEqual(
      hookState("waiting"),
    );
  });

  it("is case-insensitive", () => {
    expect(mapEventType("codex", "TASK_STARTED")).toEqual(hookState("running"));
  });

  it("returns unknown for unrecognized events", () => {
    expect(mapEventType("codex", "panic")).toEqual({ kind: "unknown" });
  });
});

describe("mapEventType -- opencode", () => {
  it("maps active/busy session status and tool execution to running", () => {
    expect(mapEventType("opencode", "session.status:active")).toEqual(
      hookState("running"),
    );
    expect(mapEventType("opencode", "session.status:busy")).toEqual(
      hookState("running"),
    );
    expect(mapEventType("opencode", "tool.execute.before")).toEqual(
      hookState("running"),
    );
  });

  it("maps idle and error session events to completed", () => {
    expect(mapEventType("opencode", "session.idle")).toEqual(
      hookState("completed"),
    );
    expect(mapEventType("opencode", "session.status:idle")).toEqual(
      hookState("completed"),
    );
    expect(mapEventType("opencode", "session.status:error")).toEqual(
      hookState("completed"),
    );
  });

  it("maps permission and question events to human handoff states", () => {
    expect(mapEventType("opencode", "permission.asked")).toEqual(
      hookState("waiting"),
    );
    expect(mapEventType("opencode", "permission.replied")).toEqual(
      hookState("running"),
    );
    expect(mapEventType("opencode", "question.asked")).toEqual(
      hookState("waiting"),
    );
    expect(mapEventType("opencode", "question.replied")).toEqual(
      hookState("running"),
    );
  });

  it("treats lifecycle-neutral session events as noop", () => {
    expect(mapEventType("opencode", "session.created")).toEqual({
      kind: "noop",
    });
    expect(mapEventType("opencode", "session.updated")).toEqual({
      kind: "noop",
    });
    expect(mapEventType("opencode", "session.diff")).toEqual({
      kind: "noop",
    });
  });

  it("treats message updates as noop so post-idle rendering does not reopen working", () => {
    expect(mapEventType("opencode", "session.status:idle")).toEqual(
      hookState("completed"),
    );
    expect(mapEventType("opencode", "message.updated")).toEqual({
      kind: "noop",
    });
    expect(mapEventType("opencode", "message.part.updated")).toEqual({
      kind: "noop",
    });
    expect(mapEventType("opencode", "message.part.delta")).toEqual({
      kind: "noop",
    });
  });

  it("requires the session.status discriminator", () => {
    expect(mapEventType("opencode", "session.status")).toEqual({
      kind: "unknown",
    });
  });

  it("returns unknown for unrecognized events", () => {
    expect(mapEventType("opencode", "panic")).toEqual({ kind: "unknown" });
  });
});

describe("mapEventType -- input normalization", () => {
  it("trims surrounding whitespace before lookup", () => {
    expect(mapEventType("claude", "  Stop  ")).toEqual(hookState("completed"));
    expect(mapEventType("manual", " running ")).toEqual(notifyState("running"));
  });
});

import { describe, expect, it } from "vitest";
import {
  NATIVE_STATUS_INTEGRATIONS,
  nativeIntegrationHasInstallKind,
  nativeStatusIntegrationForHookAgent,
} from "./native-status-integrations.js";

describe("native status integrations", () => {
  it("derives native agent metadata from shared agent integrations", () => {
    expect(
      NATIVE_STATUS_INTEGRATIONS.map((integration) => integration.runtimeId),
    ).toEqual(["claude", "codex", "opencode", "manual-notify"]);
  });

  it("exposes installation strategy capabilities per runtime", () => {
    expect(nativeIntegrationHasInstallKind("claude", "hook-config")).toBe(true);
    expect(nativeIntegrationHasInstallKind("codex", "notify-command")).toBe(
      true,
    );
    expect(nativeIntegrationHasInstallKind("codex", "hook-config")).toBe(true);
    expect(nativeIntegrationHasInstallKind("opencode", "plugin-overlay")).toBe(
      true,
    );
    expect(
      nativeIntegrationHasInstallKind("manual-notify", "notify-command"),
    ).toBe(true);
    expect(nativeIntegrationHasInstallKind("unknown", "shim-wrapper")).toBe(
      false,
    );
  });

  it("splits hook and notify event summaries by observation source", () => {
    expect(
      nativeStatusIntegrationForHookAgent("claude")?.hookEvents,
    ).toMatchObject({
      userpromptsubmit: "running",
      permissionrequest: "waiting",
      stop: "completed",
    });
    expect(nativeStatusIntegrationForHookAgent("manual")?.notifyEvents).toEqual(
      {
        running: "running",
        waiting: "waiting",
        completed: "completed",
        idle: "idle",
      },
    );
    expect(
      nativeStatusIntegrationForHookAgent("manual")?.hookEvents,
    ).toBeUndefined();
    expect(
      nativeStatusIntegrationForHookAgent("codex")?.notifyEvents,
    ).toMatchObject({
      task_started: "running",
      exec_approval_request: "waiting",
      agent_turn_complete: "completed",
    });
    expect(
      nativeStatusIntegrationForHookAgent("codex")?.hookEvents,
    ).toMatchObject({
      userpromptsubmit: "running",
      permissionrequest: "waiting",
      stop: "completed",
    });
  });
});

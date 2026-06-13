import type { NativeStatusIntegration } from "@parasor/shared";

export const NATIVE_STATUS_INTEGRATIONS = [
  {
    runtimeId: "claude",
    hookAgent: "claude",
    installStrategies: [
      {
        kind: "shim-wrapper",
        activation: "preset-launch",
        writesUserConfig: false,
        reversible: true,
      },
      {
        kind: "hook-config",
        activation: "preset-launch",
        writesUserConfig: false,
        reversible: true,
      },
    ],
    hookEvents: {
      UserPromptSubmit: "running",
      PreToolUse: "running",
      PermissionRequest: "waiting",
      Stop: "completed",
    },
  },
  {
    runtimeId: "codex",
    hookAgent: "codex",
    installStrategies: [
      {
        kind: "shim-wrapper",
        activation: "preset-launch",
        writesUserConfig: false,
        reversible: true,
      },
      {
        kind: "notify-command",
        activation: "preset-launch",
        writesUserConfig: false,
        reversible: true,
      },
      {
        kind: "session-log-watcher",
        activation: "preset-launch",
        writesUserConfig: false,
        reversible: true,
      },
    ],
    notifyEvents: {
      "agent-turn-complete": "completed",
    },
    hookEvents: {
      task_started: "running",
      task_complete: "completed",
      exec_approval_request: "waiting",
      apply_patch_approval_request: "waiting",
      request_user_input: "waiting",
    },
  },
  {
    runtimeId: "opencode",
    hookAgent: "opencode",
    installStrategies: [
      {
        kind: "shim-wrapper",
        activation: "preset-launch",
        writesUserConfig: false,
        reversible: true,
      },
      {
        kind: "plugin-overlay",
        activation: "preset-launch",
        writesUserConfig: false,
        reversible: true,
      },
    ],
    hookEvents: {
      "session.status:active": "running",
      "session.status:busy": "running",
      "session.status:idle": "completed",
      "permission.asked": "waiting",
      "question.asked": "waiting",
    },
  },
  {
    runtimeId: "manual",
    hookAgent: "manual",
    installStrategies: [
      {
        kind: "notify-command",
        activation: "user-enabled",
        writesUserConfig: false,
        reversible: true,
      },
    ],
    notifyEvents: {
      running: "running",
      waiting: "waiting",
      completed: "completed",
      idle: "idle",
    },
  },
] as const satisfies readonly NativeStatusIntegration[];

export function nativeStatusIntegrationForHookAgent(
  hookAgent: string,
): NativeStatusIntegration | undefined {
  return NATIVE_STATUS_INTEGRATIONS.find(
    (integration) => integration.hookAgent === hookAgent,
  );
}

export function nativeIntegrationHasInstallKind(
  runtimeId: string,
  kind: NativeStatusIntegration["installStrategies"][number]["kind"],
): boolean {
  return (
    NATIVE_STATUS_INTEGRATIONS.find(
      (integration) => integration.runtimeId === runtimeId,
    )?.installStrategies.some((strategy) => strategy.kind === kind) ?? false
  );
}

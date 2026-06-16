import {
  AGENT_INTEGRATION_MANIFESTS,
  type AgentIntegrationManifest,
  type NativeStatusIntegration,
} from "@parasor/shared";

const NATIVE_AGENT_STATUS_INTEGRATIONS = AGENT_INTEGRATION_MANIFESTS.flatMap(
  (manifest) => {
    if (!manifest.hookAgent || !manifest.installStrategies) {
      return [];
    }
    const integration: NativeStatusIntegration = {
      runtimeId: manifest.runtimeId,
      hookAgent: manifest.hookAgent,
      installStrategies: manifest.installStrategies,
      ...eventSummary(manifest.events),
    };
    return [integration];
  },
);

const MANUAL_NOTIFY_INTEGRATION: NativeStatusIntegration = {
  runtimeId: "manual-notify",
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
};

export const NATIVE_STATUS_INTEGRATIONS = [
  ...NATIVE_AGENT_STATUS_INTEGRATIONS,
  MANUAL_NOTIFY_INTEGRATION,
];

function eventSummary(
  events: AgentIntegrationManifest["events"],
): Pick<NativeStatusIntegration, "hookEvents" | "notifyEvents"> {
  if (!events) {
    return {};
  }
  const hookEvents: Record<string, string> = {};
  const notifyEvents: Record<string, string> = {};
  for (const [event, spec] of Object.entries(events)) {
    if (spec === "noop") {
      continue;
    }
    const target = spec.source === "notify" ? notifyEvents : hookEvents;
    target[event] = spec.lifecycle;
  }
  return {
    ...(Object.keys(hookEvents).length > 0 ? { hookEvents } : {}),
    ...(Object.keys(notifyEvents).length > 0 ? { notifyEvents } : {}),
  };
}

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

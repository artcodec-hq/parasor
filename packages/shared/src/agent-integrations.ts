import { CLAUDE_AGENT_INTEGRATION } from "./agent-integrations/claude.js";
import { CODEX_AGENT_INTEGRATION } from "./agent-integrations/codex.js";
import { OPENCODE_AGENT_INTEGRATION } from "./agent-integrations/opencode.js";
import type {
  AgentLifecycle,
  AgentSignalConfidence,
  AgentSignalSource,
} from "./runtime.js";
import type {
  NativeIntegrationInstallStrategy,
  RuntimeTier,
  ShellPreset,
} from "./shell-presets.js";

export type AgentEventSpec =
  | {
      lifecycle: AgentLifecycle;
      source?: AgentSignalSource;
      confidence?: AgentSignalConfidence;
    }
  | "noop";

export interface AgentIntegrationManifest {
  runtimeId: string;
  hookAgent?: string;
  label: string;
  iconKey?: string;
  commandLine?: string;
  appendEnter?: boolean;
  tier: RuntimeTier;
  expectedProcesses: readonly string[];
  detectCommands?: readonly string[];
  installStrategies?: readonly NativeIntegrationInstallStrategy[];
  events?: Record<string, AgentEventSpec>;
}

const AGENT_INTEGRATION_MANIFEST_LIST = [
  CLAUDE_AGENT_INTEGRATION,
  CODEX_AGENT_INTEGRATION,
  OPENCODE_AGENT_INTEGRATION,
] as const satisfies readonly AgentIntegrationManifest[];

export type AgentIntegrationRuntimeId =
  (typeof AGENT_INTEGRATION_MANIFEST_LIST)[number]["runtimeId"];

export const AGENT_INTEGRATION_MANIFESTS: readonly AgentIntegrationManifest[] =
  AGENT_INTEGRATION_MANIFEST_LIST;

export function agentIntegrationByRuntimeId(
  runtimeId: string,
): AgentIntegrationManifest | undefined {
  return AGENT_INTEGRATION_MANIFEST_LIST.find(
    (manifest) => manifest.runtimeId === runtimeId,
  );
}

export function agentIntegrationByHookAgent(
  hookAgent: string,
): AgentIntegrationManifest | undefined {
  return AGENT_INTEGRATION_MANIFESTS.find(
    (manifest) => manifest.hookAgent === hookAgent,
  );
}

export function launchableAgentIntegrations(): AgentIntegrationManifest[] {
  return AGENT_INTEGRATION_MANIFESTS.filter(
    (manifest) => manifest.commandLine !== undefined,
  );
}

export function shellPresetForAgentIntegration(
  manifest: AgentIntegrationManifest,
): ShellPreset | undefined {
  if (manifest.commandLine === undefined) {
    return undefined;
  }
  return {
    id: `builtin:${manifest.runtimeId}`,
    source: "builtin",
    label: manifest.label,
    ...(manifest.iconKey ? { iconKey: manifest.iconKey } : {}),
    group: "agent",
    commandLine: manifest.commandLine,
    appendEnter: manifest.appendEnter ?? true,
    runtimeHint: {
      runtimeId: manifest.runtimeId,
      tier: manifest.tier,
      expectedProcesses: manifest.expectedProcesses,
      ...(manifest.detectCommands
        ? { detectCommands: manifest.detectCommands }
        : {}),
    },
  };
}

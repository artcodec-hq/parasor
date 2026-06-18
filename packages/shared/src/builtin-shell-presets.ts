import {
  launchableAgentIntegrations,
  shellPresetForAgentIntegration,
} from "./agent-integrations.js";
import type { SessionLaunchPreset, ShellPreset } from "./shell-presets.js";

const TERMINAL_SHELL_PRESET = {
  id: "builtin:terminal",
  source: "builtin",
  label: "Terminal",
  iconKey: "terminal",
  group: "terminal",
  commandLine: "",
  appendEnter: false,
  runtimeHint: {
    runtimeId: "terminal",
    tier: "generic-terminal",
    expectedProcesses: ["sh", "bash", "zsh", "fish"],
  },
} as const satisfies ShellPreset;

export const BUILTIN_SHELL_PRESETS = [
  TERMINAL_SHELL_PRESET,
  ...launchableAgentIntegrations()
    .map(shellPresetForAgentIntegration)
    .filter((preset): preset is ShellPreset => preset !== undefined),
] as const satisfies readonly ShellPreset[];

export function shellPresetToLaunchPreset(
  preset: ShellPreset,
): SessionLaunchPreset {
  return {
    presetId: preset.id,
    source: preset.source,
    label: preset.label,
    commandLine: preset.commandLine,
    ...(preset.runtimeHint && { runtimeHint: preset.runtimeHint }),
  };
}

export function builtinShellPresetById(id: string): ShellPreset | undefined {
  return BUILTIN_SHELL_PRESETS.find((preset) => preset.id === id);
}

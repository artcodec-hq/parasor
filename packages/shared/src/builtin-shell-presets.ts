import type { SessionLaunchPreset, ShellPreset } from "./shell-presets.js";

export const BUILTIN_SHELL_PRESETS = [
  {
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
  },
  {
    id: "builtin:claude",
    source: "builtin",
    label: "Claude",
    iconKey: "agent",
    group: "agent",
    commandLine: "claude",
    appendEnter: true,
    runtimeHint: {
      runtimeId: "claude",
      tier: "native-managed",
      expectedProcesses: ["claude"],
      detectCommands: ["claude"],
    },
  },
  {
    id: "builtin:codex",
    source: "builtin",
    label: "Codex",
    iconKey: "agent",
    group: "agent",
    commandLine: "codex",
    appendEnter: true,
    runtimeHint: {
      runtimeId: "codex",
      tier: "native-managed",
      expectedProcesses: ["codex"],
      detectCommands: ["codex"],
    },
  },
  {
    id: "builtin:opencode",
    source: "builtin",
    label: "OpenCode",
    iconKey: "agent",
    group: "agent",
    commandLine: "opencode",
    appendEnter: true,
    runtimeHint: {
      runtimeId: "opencode",
      tier: "native-managed",
      expectedProcesses: ["opencode"],
      detectCommands: ["opencode"],
    },
  },
  {
    id: "builtin:gemini",
    source: "builtin",
    label: "Gemini",
    iconKey: "agent",
    group: "agent",
    commandLine: "gemini",
    appendEnter: true,
    runtimeHint: {
      runtimeId: "gemini",
      tier: "process-aware",
      expectedProcesses: ["gemini", "gemini-cli"],
      detectCommands: ["gemini", "gemini-cli"],
    },
  },
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

export type ShellPresetSource = "builtin" | "user";

export type RuntimeTier =
  | "native-managed"
  | "process-aware"
  | "generic-terminal";

export interface ShellPresetRuntimeHint {
  runtimeId: string;
  tier: RuntimeTier;
  expectedProcesses: readonly string[];
  detectCommands?: readonly string[];
}

export interface ShellPreset {
  id: string;
  source: ShellPresetSource;
  label: string;
  iconKey?: string;
  group: "terminal" | "agent" | "custom";
  commandLine: string;
  appendEnter: boolean;
  runtimeHint?: ShellPresetRuntimeHint;
}

export interface SessionLaunchPreset {
  presetId: string;
  source: ShellPresetSource;
  label: string;
  commandLine: string;
  runtimeHint?: ShellPresetRuntimeHint;
}

export type NativeIntegrationInstallKind =
  | "shim-wrapper"
  | "managed-config"
  | "notify-command"
  | "hook-config"
  | "plugin-overlay"
  | "session-log-watcher"
  | "none";

export type NativeIntegrationActivation =
  | "preset-launch"
  | "foreground-process"
  | "user-enabled";

export interface NativeIntegrationInstallStrategy {
  kind: NativeIntegrationInstallKind;
  activation: NativeIntegrationActivation;
  writesUserConfig: boolean;
  reversible: boolean;
}

export interface NativeStatusIntegration {
  runtimeId: string;
  hookAgent: string;
  installStrategies: readonly NativeIntegrationInstallStrategy[];
  hookEvents?: Record<string, string>;
  notifyEvents?: Record<string, string>;
  environment?: Record<string, string>;
}

const MAX_PRESET_ID_LENGTH = 128;
const MAX_PRESET_LABEL_LENGTH = 200;
const MAX_PRESET_COMMAND_LENGTH = 4000;
const MAX_RUNTIME_ID_LENGTH = 128;
const MAX_PROCESS_NAME_LENGTH = 128;
const MAX_PROCESSES = 32;

export function normalizeSessionLaunchPreset(
  value: unknown,
): SessionLaunchPreset | undefined {
  if (!isPlainObject(value)) return undefined;
  const presetId = stringWithin(value.presetId, MAX_PRESET_ID_LENGTH);
  const label = stringWithin(value.label, MAX_PRESET_LABEL_LENGTH);
  const commandLine = commandLineWithin(
    value.commandLine,
    MAX_PRESET_COMMAND_LENGTH,
  );
  const source = value.source;
  if (!presetId || !label || commandLine === null) return undefined;
  if (source !== "builtin" && source !== "user") return undefined;
  const runtimeHint = normalizeRuntimeHint(value.runtimeHint);
  return {
    presetId,
    source,
    label,
    commandLine,
    ...(runtimeHint && { runtimeHint }),
  };
}

function normalizeRuntimeHint(
  value: unknown,
): ShellPresetRuntimeHint | undefined {
  if (!isPlainObject(value)) return undefined;
  const runtimeId = stringWithin(value.runtimeId, MAX_RUNTIME_ID_LENGTH);
  if (!runtimeId) return undefined;
  const tier = value.tier;
  if (
    tier !== "native-managed" &&
    tier !== "process-aware" &&
    tier !== "generic-terminal"
  ) {
    return undefined;
  }
  const expectedProcesses = normalizeStringArray(value.expectedProcesses);
  if (expectedProcesses.length === 0) return undefined;
  const detectCommands = normalizeStringArray(value.detectCommands);
  return {
    runtimeId,
    tier,
    expectedProcesses,
    ...(detectCommands.length > 0 && { detectCommands }),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = stringWithin(item, MAX_PROCESS_NAME_LENGTH);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_PROCESSES) break;
  }
  return out;
}

function stringWithin(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function commandLineWithin(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.length <= max ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

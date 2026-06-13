import { basename } from "node:path";
import {
  BUILTIN_SHELL_PRESETS,
  builtinShellPresetById,
  type Session,
  type ShellPresetRuntimeHint,
} from "@parasor/shared";

const BUILTIN_RUNTIME_HINTS: ShellPresetRuntimeHint[] =
  BUILTIN_SHELL_PRESETS.flatMap((preset) =>
    preset.runtimeHint ? [preset.runtimeHint] : [],
  );

const BUILTIN_AGENT_RUNTIME_HINTS = BUILTIN_RUNTIME_HINTS.filter(
  (hint) => hint.runtimeId !== "terminal",
);

const PROCESS_NAMES = new Set(
  BUILTIN_AGENT_RUNTIME_HINTS.flatMap((hint) => hint.expectedProcesses),
);

const DETECT_COMMANDS = new Set(
  BUILTIN_AGENT_RUNTIME_HINTS.flatMap(
    (hint) => hint.detectCommands ?? hint.expectedProcesses,
  ),
);

export function normalizeProcessName(value: string): string {
  return basename(value).trim().toLowerCase();
}

export function isKnownAgentProcess(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeProcessName(value);
  if (PROCESS_NAMES.has(normalized)) return true;
  for (const name of PROCESS_NAMES) {
    if (normalized.startsWith(`${name}-`)) return true;
  }
  return false;
}

export function detectAgentCommandLine(value: string): string | null {
  const firstToken = value.trim().split(/\s+/)[0] ?? "";
  if (!firstToken) return null;
  const normalized = normalizeProcessName(firstToken);
  return DETECT_COMMANDS.has(normalized) ? normalized : null;
}

export function trustedLaunchRuntimeHint(
  session: Session,
): ShellPresetRuntimeHint | undefined {
  const preset = session.launchPreset;
  if (preset?.source !== "builtin") return undefined;
  const builtin = builtinShellPresetById(preset.presetId);
  const runtimeId = builtin?.runtimeHint?.runtimeId;
  if (!runtimeId) return undefined;
  if (runtimeId !== preset.runtimeHint?.runtimeId) return undefined;
  return BUILTIN_AGENT_RUNTIME_HINTS.find(
    (hint) => hint.runtimeId === runtimeId,
  );
}

export function matchesTrustedLaunchRuntime(
  session: Session,
  processName: string | null | undefined,
): boolean {
  if (!processName) return false;
  const hint = trustedLaunchRuntimeHint(session);
  if (!hint) return false;
  const normalized = normalizeProcessName(processName);
  return hint.expectedProcesses.some(
    (name) => normalized === name || normalized.startsWith(`${name}-`),
  );
}

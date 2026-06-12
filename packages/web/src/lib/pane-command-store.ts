import {
  BUILTIN_SHELL_PRESETS,
  normalizePaneCommands,
  type PaneCommandConfig,
  type SessionLaunchPreset,
  shellPresetToLaunchPreset,
} from "@parasor/shared";

export type CustomPaneCommand = PaneCommandConfig;

export interface PaneCommand extends CustomPaneCommand {
  builtin: boolean;
  launchPreset: SessionLaunchPreset;
}

export const PANE_COMMANDS_STORAGE_KEY = "parasor:pane-commands";
const MAX_RAW_LENGTH = 64 * 1024;

export const BUILTIN_TERMINAL_COMMAND: PaneCommand = paneCommandFromBuiltin(
  BUILTIN_SHELL_PRESETS[0],
);

export function paneCommandsWithBuiltins(
  customCommands: CustomPaneCommand[],
): PaneCommand[] {
  return [
    ...BUILTIN_SHELL_PRESETS.map(paneCommandFromBuiltin),
    ...customCommands.map(paneCommandFromCustom),
  ];
}

export function paneCommandFromCustom(command: CustomPaneCommand): PaneCommand {
  return {
    ...command,
    builtin: false,
    launchPreset: {
      presetId: command.id,
      source: "user",
      label: command.label,
      commandLine: command.initialInput,
    },
  };
}

function paneCommandFromBuiltin(
  preset: (typeof BUILTIN_SHELL_PRESETS)[number],
): PaneCommand {
  return {
    id: preset.id,
    label: preset.label,
    initialInput: preset.commandLine,
    builtin: true,
    launchPreset: shellPresetToLaunchPreset(preset),
  };
}

export function parsePaneCommandStore(raw: string | null): CustomPaneCommand[] {
  if (!raw) return [];
  if (raw.length > MAX_RAW_LENGTH) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return normalizePaneCommands(parsed);
}

export function loadPaneCommands(storage: Storage): CustomPaneCommand[] {
  return parsePaneCommandStore(storage.getItem(PANE_COMMANDS_STORAGE_KEY));
}

export function savePaneCommands(
  storage: Storage,
  commands: CustomPaneCommand[],
): void {
  storage.setItem(PANE_COMMANDS_STORAGE_KEY, JSON.stringify(commands));
}

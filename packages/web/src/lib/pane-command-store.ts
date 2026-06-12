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
  storedCommands: CustomPaneCommand[],
): PaneCommand[] {
  const overrides = new Map(
    storedCommands
      .filter((command) => command.id.startsWith("builtin:"))
      .map((command) => [command.id, command]),
  );
  return [
    ...BUILTIN_SHELL_PRESETS.flatMap((preset) => {
      const override = overrides.get(preset.id);
      if (preset.group === "agent" && override?.enabled === false) return [];
      return [paneCommandFromBuiltin(preset, override)];
    }),
    ...storedCommands
      .filter((command) => !command.id.startsWith("builtin:"))
      .map(paneCommandFromCustom),
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
  override?: CustomPaneCommand,
): PaneCommand {
  const commandLine = override?.initialInput ?? preset.commandLine;
  return {
    id: preset.id,
    label: preset.label,
    initialInput: commandLine,
    builtin: true,
    launchPreset: {
      ...shellPresetToLaunchPreset(preset),
      commandLine,
    },
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

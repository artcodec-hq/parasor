import { normalizePaneCommands, type PaneCommandConfig } from "@parasor/shared";

export type CustomPaneCommand = PaneCommandConfig;

export interface PaneCommand extends CustomPaneCommand {
  builtin: boolean;
}

export const PANE_COMMANDS_STORAGE_KEY = "parasor:pane-commands";
const MAX_RAW_LENGTH = 64 * 1024;

export const BUILTIN_TERMINAL_COMMAND: PaneCommand = {
  id: "builtin:terminal",
  label: "Terminal",
  initialInput: "",
  builtin: true,
};

export function paneCommandsWithBuiltins(
  customCommands: CustomPaneCommand[],
): PaneCommand[] {
  return [
    BUILTIN_TERMINAL_COMMAND,
    ...customCommands.map((command) => ({ ...command, builtin: false })),
  ];
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

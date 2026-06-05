export interface IdeCommandConfig {
  id: string;
  label: string;
  command: string;
  args: string[];
}

const MAX_COMMANDS = 50;
const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 200;
const MAX_COMMAND_LENGTH = 1000;
const MAX_ARGS = 50;
const MAX_ARG_LENGTH = 1000;
const RESERVED_IDS = new Set(["cursor", "vscode"]);

export function normalizeIdeCommands(value: unknown): IdeCommandConfig[] {
  if (!Array.isArray(value)) return [];

  const out: IdeCommandConfig[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const id = item.id;
    const label = item.label;
    const command = item.command;
    const args = item.args;
    if (
      typeof id !== "string" ||
      typeof label !== "string" ||
      typeof command !== "string" ||
      !Array.isArray(args) ||
      id.length > MAX_ID_LENGTH
    ) {
      continue;
    }
    const normalizedId = id.trim();
    const normalizedLabel = label.trim();
    const normalizedCommand = command.trim();
    const normalizedArgs = args
      .filter((arg): arg is string => typeof arg === "string")
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0 && arg.length <= MAX_ARG_LENGTH)
      .slice(0, MAX_ARGS);
    if (
      !normalizedId ||
      RESERVED_IDS.has(normalizedId) ||
      seen.has(normalizedId) ||
      !normalizedLabel ||
      normalizedLabel.length > MAX_LABEL_LENGTH ||
      !normalizedCommand ||
      normalizedCommand.length > MAX_COMMAND_LENGTH
    ) {
      continue;
    }
    seen.add(normalizedId);
    out.push({
      id: normalizedId,
      label: normalizedLabel,
      command: normalizedCommand,
      args: normalizedArgs,
    });
    if (out.length >= MAX_COMMANDS) break;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

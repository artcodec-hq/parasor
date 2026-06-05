export interface PaneCommandConfig {
  id: string;
  label: string;
  initialInput: string;
}

const MAX_COMMANDS = 100;
const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 200;
const MAX_INITIAL_INPUT_LENGTH = 4000;

export function normalizePaneCommands(value: unknown): PaneCommandConfig[] {
  if (!Array.isArray(value)) return [];

  const out: PaneCommandConfig[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const id = item.id;
    const label = item.label;
    const initialInput = item.initialInput;
    if (
      typeof id !== "string" ||
      typeof label !== "string" ||
      typeof initialInput !== "string" ||
      id.length > MAX_ID_LENGTH ||
      initialInput.length > MAX_INITIAL_INPUT_LENGTH
    ) {
      continue;
    }
    const normalizedLabel = label.trim();
    const normalizedInput = initialInput.trim();
    if (
      !id ||
      id.startsWith("builtin:") ||
      seen.has(id) ||
      !normalizedLabel ||
      normalizedLabel.length > MAX_LABEL_LENGTH ||
      !normalizedInput
    ) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      label: normalizedLabel,
      initialInput: normalizedInput,
    });
    if (out.length >= MAX_COMMANDS) break;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

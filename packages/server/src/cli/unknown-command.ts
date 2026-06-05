const SERVICE_VERBS = new Set(["install", "uninstall", "status", "logs"]);

export type UnknownCommandResult =
  | { kind: "pass" }
  | { kind: "error"; message: string };

export function classifyTopLevelCommand(
  command: string | undefined,
): UnknownCommandResult {
  if (!command || command.startsWith("-")) {
    return { kind: "pass" };
  }
  const hint = SERVICE_VERBS.has(command)
    ? ` Did you mean \`parasor service ${command}\`?`
    : "";
  return {
    kind: "error",
    message: `parasor: unknown command '${command}'.${hint} Run \`parasor --help\` for usage.`,
  };
}

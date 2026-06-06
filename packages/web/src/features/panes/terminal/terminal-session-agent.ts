import type { SessionCommand } from "@parasor/shared";

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}

function isOpenCodeExecutable(value: string): boolean {
  return basename(value).toLowerCase() === "opencode";
}

const WRAPPER_COMMANDS = new Set([
  "env",
  "bun",
  "node",
  "npx",
  "pnpm",
  "npm",
  "yarn",
]);

function isWrapperExecutable(value: string): boolean {
  return WRAPPER_COMMANDS.has(basename(value).toLowerCase());
}

export function isOpenCodeTerminalSession(input: {
  sessionCommand?: SessionCommand;
  sessionTitle?: string;
}): boolean {
  const { sessionCommand, sessionTitle } = input;
  if (sessionCommand?.type === "custom") {
    if (isOpenCodeExecutable(sessionCommand.command)) return true;
    if (isOpenCodeExecutable(sessionCommand.args[0] ?? "")) return true;
    if (
      isWrapperExecutable(sessionCommand.command) &&
      sessionCommand.args.some(isOpenCodeExecutable)
    ) {
      return true;
    }
  }
  return sessionTitle?.trim().toLowerCase() === "opencode";
}

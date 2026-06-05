import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IdeCommandConfig } from "@parasor/shared";

const execFileAsync = promisify(execFile);

export const supportedIdeEditors = ["cursor", "vscode"] as const;

export type BuiltInIdeEditor = (typeof supportedIdeEditors)[number];
export type IdeEditor = string;

const EDITOR_LABELS: Record<BuiltInIdeEditor, string> = {
  cursor: "Cursor",
  vscode: "VS Code",
};

const DARWIN_APP_NAMES: Record<BuiltInIdeEditor, string> = {
  cursor: "Cursor",
  vscode: "Visual Studio Code",
};

const CLI_COMMANDS: Record<BuiltInIdeEditor, string> = {
  cursor: "cursor",
  vscode: "code",
};

const WIN_COMMANDS: Record<BuiltInIdeEditor, string> = {
  cursor: "cursor.cmd",
  vscode: "code.cmd",
};

export class OpenInIdeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenInIdeError";
  }
}

export interface OpenInIdeOptions {
  customCommands?: IdeCommandConfig[];
  platform?: NodeJS.Platform;
  run?: (cmd: string, args: string[]) => Promise<unknown>;
}

export function isSupportedIdeEditor(
  value: unknown,
): value is BuiltInIdeEditor {
  return (
    typeof value === "string" &&
    supportedIdeEditors.includes(value as BuiltInIdeEditor)
  );
}

export function ideEditorLabel(
  editor: string,
  customCommands: IdeCommandConfig[] = [],
): string {
  if (isSupportedIdeEditor(editor)) return EDITOR_LABELS[editor];
  return (
    customCommands.find((command) => command.id === editor)?.label ?? editor
  );
}

/**
 * Open `target` in a configured IDE on the parasor server host.
 *
 * The caller must fence `target` to a registered project/worktree path first.
 * Custom commands are executed with fixed argv via execFile, never a shell.
 */
export async function openInIde(
  target: string,
  editor: IdeEditor,
  opts: OpenInIdeOptions = {},
): Promise<void> {
  const platform = opts.platform ?? process.platform;
  const customCommand = opts.customCommands?.find(
    (command) => command.id === editor,
  );
  const run =
    opts.run ??
    (async (cmd: string, args: string[]) => {
      await execFileAsync(cmd, args, { timeout: 5_000 });
    });

  if (customCommand) {
    await run(customCommand.command, buildCustomIdeArgs(customCommand, target));
    return;
  }

  if (!isSupportedIdeEditor(editor)) {
    throw new OpenInIdeError(`Unsupported editor: ${editor}`);
  }

  if (platform === "darwin") {
    await run("open", ["-a", DARWIN_APP_NAMES[editor], target]);
    return;
  }

  if (platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Start-Process -FilePath $args[0] -ArgumentList @($args[1])",
      WIN_COMMANDS[editor],
      target,
    ]);
    return;
  }

  if (platform === "linux") {
    await run(CLI_COMMANDS[editor], [target]);
    return;
  }

  throw new OpenInIdeError(`Unsupported platform: ${platform}`);
}

function buildCustomIdeArgs(
  command: IdeCommandConfig,
  target: string,
): string[] {
  let usedPath = false;
  const args = command.args.map((arg) => {
    if (arg.includes("{path}")) {
      usedPath = true;
      return arg.replaceAll("{path}", target);
    }
    return arg;
  });
  if (!usedPath) args.push(target);
  return args;
}

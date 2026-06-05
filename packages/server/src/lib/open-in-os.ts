import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class OpenInOsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenInOsError";
  }
}

export interface OpenInOsOptions {
  platform?: NodeJS.Platform;
  run?: (cmd: string, args: string[]) => Promise<unknown>;
}

/**
 * Reveal `target` (a directory or file) in the host's native file manager.
 *
 *   darwin -> `open <path>`              (Finder)
 *   win32  -> `explorer <path>`          (exit code 1 is benign -- Explorer
 *                                        emits it even on success)
 *   linux  -> `xdg-open <path>`          (Files / Nautilus / Dolphin)
 *
 * The caller is expected to have already validated that `target` belongs to
 * a registered worktree; this helper does no path-fence work itself.
 */
export async function openInOs(
  target: string,
  opts: OpenInOsOptions = {},
): Promise<void> {
  const platform = opts.platform ?? process.platform;
  const run =
    opts.run ??
    (async (cmd: string, args: string[]) => {
      await execFileAsync(cmd, args, { timeout: 5_000 });
    });

  if (platform === "darwin") {
    await run("open", [target]);
    return;
  }
  if (platform === "win32") {
    try {
      await run("explorer", [target]);
    } catch (err) {
      // explorer.exe returns exit code 1 even on success -- treat any
      // ExecFileException whose code is exactly 1 as ok.
      const code = (err as { code?: unknown } | undefined)?.code;
      if (code === 1) return;
      throw new OpenInOsError(
        err instanceof Error ? err.message : "explorer failed",
      );
    }
    return;
  }
  if (platform === "linux") {
    await run("xdg-open", [target]);
    return;
  }
  throw new OpenInOsError(`Unsupported platform: ${platform}`);
}

import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { Worktree } from "@parasor/shared";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

export interface GitExecResult {
  stdout: string;
  stderr: string;
}

export interface GitExecOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export class GitExecError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "GitExecError";
  }
}

export class WorktreeNotRegisteredError extends Error {
  constructor(worktreePath: string) {
    super(`Worktree not registered: ${worktreePath}`);
    this.name = "WorktreeNotRegisteredError";
  }
}

/**
 * Run `git -C <worktreePath> <args>`. Throws `GitExecError` carrying the git
 * stderr so route handlers can surface meaningful messages. Caller is
 * responsible for fencing `worktreePath` via `resolveWorktreePath` before
 * invoking -- this wrapper does not validate the path.
 */
export async function runGit(
  worktreePath: string,
  args: string[],
  options: GitExecOptions = {},
): Promise<GitExecResult> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  // Force C locale: route handlers parse stderr (e.g. "does not have any
  // commits yet") to detect specific git failure modes. Without this, a
  // non-English LANG/LC_ALL on the host turns those messages into translated
  // strings and breaks the detection.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    LC_ALL: "C",
    LANG: "C",
  };
  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["-C", worktreePath, ...args],
      {
        timeout,
        maxBuffer,
        env,
      },
    );
    return { stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
    };
    const stdout =
      typeof e.stdout === "string"
        ? e.stdout
        : (e.stdout?.toString("utf8") ?? "");
    const stderr =
      typeof e.stderr === "string"
        ? e.stderr
        : (e.stderr?.toString("utf8") ?? "");
    const exitCode = typeof e.code === "number" ? e.code : null;
    throw new GitExecError(e.message, stdout, stderr, exitCode);
  }
}

/**
 * Verify `worktreePath` belongs to the project and return the canonical
 * (realpath-resolved) absolute path safe to pass to git. Resolution catches
 * symlink and `..` traversal; the registered-worktrees check catches
 * arbitrary paths a client may try to inject. The project root itself
 * (the main worktree) is always allowed.
 *
 * Comparison is realpath-based so case-insensitive filesystems
 * (`/private/tmp` vs `/tmp` on macOS) match correctly.
 */
export async function resolveWorktreePath(
  projectPath: string,
  worktreePath: string,
  registeredWorktrees: Worktree[],
): Promise<string> {
  let resolvedTarget: string;
  try {
    resolvedTarget = await realpath(worktreePath);
  } catch {
    throw new WorktreeNotRegisteredError(worktreePath);
  }

  const candidates = [projectPath, ...registeredWorktrees.map((w) => w.path)];
  for (const candidate of candidates) {
    let resolvedCandidate: string;
    try {
      resolvedCandidate = await realpath(candidate);
    } catch {
      continue;
    }
    if (resolvedCandidate === resolvedTarget) return resolvedTarget;
  }

  throw new WorktreeNotRegisteredError(worktreePath);
}

import { execFile } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expandUserHome } from "../../lib/path.js";
import {
  FileAccessError,
  FileExistsError,
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  UnsupportedPlatformError,
} from "./errors.js";

const execFileAsync = promisify(execFile);

export interface LocalDirectoryEntry {
  name: string;
  path: string;
  type: "directory";
}

export class InvalidDirectoryNameError extends Error {
  constructor(message = "Invalid directory name") {
    super(message);
    this.name = "InvalidDirectoryNameError";
  }
}

interface LocalFilesystemDeps {
  browseHomeDirectories?: (targetPath: string) => LocalDirectoryEntry[];
  createDirectory?: (targetPath: string) => void;
  getHomeDir?: () => string;
  getPlatform?: () => NodeJS.Platform;
  normalizePath?: (path: string) => string;
  pickFolder?: (os: NodeJS.Platform) => Promise<string | null>;
  statPath?: (targetPath: string) => { isDirectory: boolean } | null;
  checkWritable?: (targetPath: string) => boolean;
}

async function defaultPickFolder(os: NodeJS.Platform): Promise<string | null> {
  if (os === "darwin") {
    const { stdout } = await execFileAsync(
      "osascript",
      [
        "-e",
        'set theFolder to choose folder with prompt "Select project folder"',
        "-e",
        "POSIX path of theFolder",
      ],
      { timeout: 60_000 },
    );
    return stdout.trim().replace(/\/$/, "") || null;
  }

  if (os === "linux") {
    const { stdout } = await execFileAsync(
      "zenity",
      ["--file-selection", "--directory", "--title=Select project folder"],
      { timeout: 60_000 },
    );
    return stdout.trim() || null;
  }

  throw new UnsupportedPlatformError();
}

function defaultNormalizePath(path: string): string {
  return realpathSync(resolve(path));
}

function defaultBrowseHomeDirectories(
  targetPath: string,
): LocalDirectoryEntry[] {
  return readdirSync(targetPath)
    .filter((name) => !name.startsWith("."))
    .filter((name) => {
      try {
        return statSync(join(targetPath, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .map((name) => ({
      name,
      path: join(targetPath, name),
      type: "directory" as const,
    }));
}

function defaultCreateDirectory(targetPath: string): void {
  mkdirSync(targetPath);
}

function defaultStatPath(targetPath: string): { isDirectory: boolean } | null {
  try {
    const s = statSync(targetPath);
    return { isDirectory: s.isDirectory() };
  } catch {
    return null;
  }
}

function defaultCheckWritable(targetPath: string): boolean {
  try {
    accessSync(targetPath, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const ILLEGAL_NAME_CHARS = /[/\\]/;

function validateDirectoryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new InvalidDirectoryNameError("Name is required");
  if (trimmed === "." || trimmed === "..") {
    throw new InvalidDirectoryNameError("Name cannot be '.' or '..'");
  }
  if (ILLEGAL_NAME_CHARS.test(trimmed)) {
    throw new InvalidDirectoryNameError("Name cannot contain '/' or '\\'");
  }
  return trimmed;
}

export function createLocalFilesystem({
  browseHomeDirectories = defaultBrowseHomeDirectories,
  createDirectory = defaultCreateDirectory,
  getHomeDir = homedir,
  getPlatform = platform,
  normalizePath = defaultNormalizePath,
  pickFolder = defaultPickFolder,
  statPath = defaultStatPath,
  checkWritable = defaultCheckWritable,
}: LocalFilesystemDeps = {}) {
  function resolveUnderHome(rawPath: string): string {
    const home = getHomeDir();
    const requestedPath = expandUserHome(rawPath, home);
    let targetPath: string;
    try {
      targetPath = normalizePath(requestedPath);
    } catch {
      throw new FileNotFoundError("Directory not found");
    }
    const realHome = normalizePath(home);
    if (targetPath !== realHome && !targetPath.startsWith(`${realHome}/`)) {
      throw new FileAccessError();
    }
    return targetPath;
  }

  return {
    browseDirectories(rawPath?: string) {
      const home = getHomeDir();
      let targetPath: string;
      const requestedPath = expandUserHome(rawPath ?? home, home);

      try {
        targetPath = normalizePath(requestedPath);
      } catch {
        throw new FileReadError("Cannot read directory");
      }

      const realHome = normalizePath(home);
      if (targetPath !== realHome && !targetPath.startsWith(`${realHome}/`)) {
        throw new FileAccessError();
      }

      try {
        const entries = browseHomeDirectories(targetPath);
        const parent =
          targetPath === realHome ? null : resolve(targetPath, "..");
        return { path: targetPath, parent, entries };
      } catch {
        throw new FileReadError("Cannot read directory");
      }
    },

    async pickProjectFolder() {
      try {
        return await pickFolder(getPlatform());
      } catch (error) {
        if (error instanceof UnsupportedPlatformError) {
          throw error;
        }
        return null;
      }
    },

    createProjectDirectory({
      parent,
      name,
    }: {
      parent: string;
      name: string;
    }): { path: string } {
      const cleanName = validateDirectoryName(name);
      const parentPath = resolveUnderHome(parent);
      const parentStat = statPath(parentPath);
      if (!parentStat?.isDirectory) {
        throw new FileNotFoundError("Parent directory not found");
      }
      if (!checkWritable(parentPath)) {
        throw new FileAccessError("Parent directory is not writable");
      }
      const targetPath = join(parentPath, cleanName);
      const existing = statPath(targetPath);
      if (existing) {
        throw new FileExistsError("Directory already exists");
      }
      try {
        createDirectory(targetPath);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? (error as { code?: string }).code
            : undefined;
        if (code === "EEXIST") throw new FileExistsError();
        if (code === "EACCES" || code === "EPERM") {
          throw new FileAccessError("Cannot write to parent directory");
        }
        throw new FileWriteError(
          error instanceof Error ? error.message : "Cannot create directory",
        );
      }
      return { path: targetPath };
    },
  };
}

import { Buffer } from "node:buffer";
import type { ReadStream, Stats } from "node:fs";
import {
  existsSync,
  constants as fsConstants,
  readFileSync,
  realpathSync,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  cp as fsCp,
  mkdir as fsMkdir,
  open as fsOpen,
  readFile as fsReadFile,
  realpath as fsRealpath,
  writeFile as fsWriteFile,
  readdir,
  stat,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import ignore, { type Ignore } from "ignore";

const HARD_EXCLUDES = new Set([".git", ".DS_Store", "Thumbs.db"]);

const BUILTIN_IGNORES = [
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  "target",
  ".turbo",
];

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  isGitignored?: boolean;
  isHidden?: boolean;
}

export class PathTraversalError extends Error {
  constructor() {
    super("Path traversal denied");
    this.name = "PathTraversalError";
  }
}

export class CopySourceNotFoundError extends Error {
  constructor() {
    super("Copy source not found");
    this.name = "CopySourceNotFoundError";
  }
}

export class CopyDestinationExistsError extends Error {
  constructor() {
    super("Copy destination already exists");
    this.name = "CopyDestinationExistsError";
  }
}

export class FilesystemService {
  private readonly projectRoot: string;
  private ignoreInstance: Ignore;

  constructor(projectRoot: string) {
    const resolved = resolve(projectRoot);
    try {
      this.projectRoot = realpathSync(resolved);
    } catch {
      this.projectRoot = resolved;
    }
    this.ignoreInstance = this.loadIgnore();
  }

  async listDir(relPath: string): Promise<FileEntry[]> {
    const absPath = this.resolve(relPath);
    const ig = this.ignoreInstance;
    const entries: FileEntry[] = [];
    const dirEntries = await readdir(absPath, { withFileTypes: true });

    for (const dirent of dirEntries) {
      if (HARD_EXCLUDES.has(dirent.name)) continue;

      const entryRelPath = relative(
        this.projectRoot,
        join(absPath, dirent.name),
      );
      const isDir = dirent.isDirectory();
      const isGitignored = this.isIgnoredWith(ig, entryRelPath, isDir);
      const isHidden = dirent.name.startsWith(".");

      entries.push({
        name: dirent.name,
        path: entryRelPath,
        type: isDir ? "directory" : "file",
        ...(isGitignored && { isGitignored: true }),
        ...(isHidden && { isHidden: true }),
      });
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  async readFile(relPath: string, maxBytes?: number): Promise<string | null> {
    const absPath = this.resolve(relPath);
    const limit = maxBytes ?? MAX_FILE_SIZE;

    try {
      const stats = await stat(absPath);
      if (stats.size > limit) {
        throw new Error("File too large");
      }
      const content = await fsReadFile(absPath, "utf-8");
      return content;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "File too large") throw err;
      if (isNodeError(err) && err.code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Stat a single file, returning `null` when missing. Wraps node `stat()`
   * to surface `PathTraversalError` consistently and never leak ENOENT
   * details to the route layer.
   */
  async statFile(relPath: string): Promise<Stats | null> {
    const absPath = this.resolve(relPath);
    try {
      return await stat(absPath);
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Open a regular file inside the project root for inline media serving.
   * The leaf is opened with `O_NOFOLLOW` so a symlink swapped in between
   * the parent-directory resolve and this open cannot redirect to a target
   * outside the project tree. The returned `FileHandle` is the single
   * authoritative reference: callers do `fstat`, magic-number sniff via
   * `read`, and stream creation through the same handle so size limits and
   * content-type detection apply to the exact bytes about to be served.
   * The caller MUST `close()` the handle (or pass it to `createReadStream`
   * with `autoClose: true`).
   *
   * `O_NONBLOCK` keeps `open()` from blocking when the path happens to be a
   * FIFO/socket/character device (a `*.mp4` FIFO in a cloned repo would
   * otherwise pin a libuv worker until a writer connects); the post-open
   * `isFile()` check then rejects everything that isn't a regular file.
   *
   * `O_NOFOLLOW` only protects the leaf -- an attacker with FS write access
   * can still swap a parent directory to a symlink between `resolve()`'s
   * realpath check and this `open()`. We close that gap by re-resolving the
   * path *after* open and comparing the canonical result's inode to the
   * fd's inode. A mid-open swap leaves the fd bound to a file outside the
   * project tree while the second realpath resolves to the legitimate
   * (or missing) in-tree entry, so the inodes diverge and we reject.
   *
   * Returns `null` for ENOENT so missing files surface as 404 rather than
   * leaking the absolute path. ELOOP (the leaf was a symlink) raises a
   * `PathTraversalError` because following symlinks at the leaf is exactly
   * what we are refusing.
   */
  async openInlineFile(
    relPath: string,
  ): Promise<{ handle: FileHandle; stats: Stats } | null> {
    const absPath = this.resolve(relPath);
    const NONBLOCK = fsConstants.O_NONBLOCK ?? 0;
    let handle: FileHandle;
    try {
      handle = await fsOpen(
        absPath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | NONBLOCK,
      );
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return null;
      if (isNodeError(err) && err.code === "ELOOP") {
        throw new PathTraversalError();
      }
      throw err;
    }
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        await handle.close();
        return null;
      }
      let real: string;
      try {
        real = await fsRealpath(absPath);
      } catch (err) {
        if (isNodeError(err) && err.code === "ENOENT") {
          await handle.close();
          return null;
        }
        throw err;
      }
      if (
        real !== this.projectRoot &&
        !real.startsWith(this.projectRoot + sep)
      ) {
        await handle.close();
        throw new PathTraversalError();
      }
      const pathStats = await stat(real);
      if (pathStats.ino !== stats.ino || pathStats.dev !== stats.dev) {
        await handle.close();
        throw new PathTraversalError();
      }
      return { handle, stats };
    } catch (err) {
      await handle.close().catch(() => {});
      throw err;
    }
  }

  /**
   * Build a read stream from an already-open `FileHandle`, optionally clamped
   * to a byte range. Uses `FileHandle.createReadStream` with `autoClose: true`
   * so stream ownership of the handle is explicit -- closing the stream
   * releases the underlying fd through the FileHandle, avoiding the
   * double-close hazard of passing the raw `handle.fd` to `createReadStream`
   * (where the FileHandle's own GC finalizer could close an fd the stream
   * already returned to the OS). Pairs with `openInlineFile` -- callers must
   * not reuse the handle after this call returns.
   */
  createStreamFromHandle(
    handle: FileHandle,
    size: number,
    range?: { start: number; end: number },
  ): { stream: ReadStream; start: number; end: number } {
    let start = 0;
    let end = size === 0 ? 0 : size - 1;
    if (range) {
      start = range.start;
      end = range.end;
    }
    const stream =
      size === 0
        ? handle.createReadStream({ autoClose: true })
        : handle.createReadStream({ autoClose: true, start, end });
    return { stream, start, end };
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const byteLength = Buffer.byteLength(content, "utf-8");
    if (byteLength > MAX_FILE_SIZE) {
      throw new Error("File too large");
    }
    const absPath = this.resolve(relPath);
    await fsWriteFile(absPath, content, "utf-8");
  }

  async mkdir(relPath: string): Promise<void> {
    const absPath = this.resolve(relPath);
    await fsMkdir(absPath, { recursive: true });
  }

  /**
   * Recursive copy of a file or directory inside the project root. Both
   * sides are routed through `resolve()` so symlink-escape and `..` traversal
   * remain blocked. Refuses to overwrite an existing destination -- callers
   * pick a unique name (Finder-style "<n> copy", "<n> copy 2") before invoking.
   */
  async cp(srcRelPath: string, destRelPath: string): Promise<void> {
    const srcAbs = this.resolve(srcRelPath);
    const destAbs = this.resolve(destRelPath);
    try {
      await stat(srcAbs);
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        throw new CopySourceNotFoundError();
      }
      throw err;
    }
    if (existsSync(destAbs)) {
      throw new CopyDestinationExistsError();
    }
    await fsCp(srcAbs, destAbs, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }

  reloadIgnore(): void {
    this.ignoreInstance = this.loadIgnore();
  }

  isIgnored(relPath: string, isDir: boolean): boolean {
    if (!relPath || relPath === "." || relPath === "") return false;
    return this.isIgnoredWith(this.ignoreInstance, relPath, isDir);
  }

  private resolve(relPath: string): string {
    // Normalize resolved path against canonical projectRoot
    const resolved = resolve(this.projectRoot, relPath);
    if (
      resolved !== this.projectRoot &&
      !resolved.startsWith(this.projectRoot + sep)
    ) {
      throw new PathTraversalError();
    }
    // Symlink check: resolve real path if it exists
    try {
      const real = realpathSync(resolved);
      if (
        real !== this.projectRoot &&
        !real.startsWith(this.projectRoot + sep)
      ) {
        throw new PathTraversalError();
      }
    } catch (err) {
      if (err instanceof PathTraversalError) throw err;
      // ENOENT or other -- path doesn't exist yet, allow (ENOENT handled in callers)
    }
    return resolved;
  }

  private loadIgnore(): Ignore {
    const ig = ignore();
    ig.add(BUILTIN_IGNORES);
    const gitignorePath = join(this.projectRoot, ".gitignore");
    if (existsSync(gitignorePath)) {
      try {
        const content = readFileSync(gitignorePath, "utf-8");
        ig.add(content);
      } catch {
        // ignore read failures
      }
    }
    return ig;
  }

  private isIgnoredWith(ig: Ignore, relPath: string, isDir: boolean): boolean {
    const testPath = isDir ? `${relPath}/` : relPath;
    return ig.ignores(testPath);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

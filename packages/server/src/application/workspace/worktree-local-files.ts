import { execFile } from "node:child_process";
import { constants, copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  normalizeWorktreeLocalFilePath,
  type WorktreeLocalFileCandidate,
  type WorktreeLocalFileCopyResult,
} from "@parasor/shared";

const execFileAsync = promisify(execFile);

const MAX_CANDIDATES = 200;
const MAX_SCAN_ENTRIES = 5000;
const MAX_FILE_SIZE_BYTES = 256 * 1024;
const MAX_TOTAL_COPY_BYTES = 2 * 1024 * 1024;
const EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "tmp",
]);
const CANDIDATE_BASENAMES = new Set([
  ".env",
  ".envrc",
  ".npmrc",
  ".nvmrc",
  ".pnpmrc",
  ".python-version",
  ".ruby-version",
  ".tool-versions",
  ".yarnrc",
  ".yarnrc.yml",
]);

export interface ListWorktreeLocalFileCandidatesDeps {
  isIgnored?: (projectPath: string, relativePath: string) => Promise<boolean>;
}

export interface CopyWorktreeLocalFilesDeps
  extends ListWorktreeLocalFileCandidatesDeps {
  copyFile?: typeof copyFile;
}

export async function listWorktreeLocalFileCandidates(
  projectPath: string,
  deps: ListWorktreeLocalFileCandidatesDeps = {},
): Promise<WorktreeLocalFileCandidate[]> {
  const candidates: WorktreeLocalFileCandidate[] = [];
  const isIgnored = deps.isIgnored ?? isGitIgnored;
  let scanned = 0;

  async function visit(dir: string, relDir: string): Promise<void> {
    if (candidates.length >= MAX_CANDIDATES || scanned >= MAX_SCAN_ENTRIES) {
      return;
    }

    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (candidates.length >= MAX_CANDIDATES || scanned >= MAX_SCAN_ENTRIES) {
        return;
      }
      scanned += 1;

      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          await visit(path.join(dir, entry.name), rel);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isLikelyLocalConfigFile(rel)) continue;

      const file = await describeLocalFile(projectPath, rel, isIgnored);
      if (file) candidates.push(file);
    }
  }

  await visit(projectPath, "");
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return candidates;
}

export async function copyWorktreeLocalFiles(
  projectPath: string,
  worktreePath: string,
  selectedPaths: unknown,
  deps: CopyWorktreeLocalFilesDeps = {},
): Promise<WorktreeLocalFileCopyResult[]> {
  const paths = normalizeSelectedPaths(selectedPaths);
  const isIgnored = deps.isIgnored ?? isGitIgnored;
  const copyFileImpl = deps.copyFile ?? copyFile;
  const results: WorktreeLocalFileCopyResult[] = [];
  let totalBytes = 0;

  for (const { input, normalized: relativePath } of paths) {
    if (!relativePath) {
      results.push({
        path: input,
        status: "skipped",
        reason: "invalid path",
      });
      continue;
    }
    const source = await describeLocalFile(
      projectPath,
      relativePath,
      isIgnored,
    );
    if (!source) {
      results.push({
        path: relativePath,
        status: "skipped",
        reason: "not an ignored regular file",
      });
      continue;
    }

    if (totalBytes + source.size > MAX_TOTAL_COPY_BYTES) {
      results.push({
        path: relativePath,
        status: "skipped",
        reason: "copy size limit exceeded",
        size: source.size,
      });
      continue;
    }

    const from = resolveUnder(projectPath, relativePath);
    const to = resolveUnder(worktreePath, relativePath);
    if (!from || !to) {
      results.push({
        path: relativePath,
        status: "skipped",
        reason: "invalid path",
        size: source.size,
      });
      continue;
    }

    try {
      await mkdir(path.dirname(to), { recursive: true });
      await copyFileImpl(from, to, constants.COPYFILE_EXCL);
      totalBytes += source.size;
      results.push({ ...source, status: "copied" });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        results.push({
          ...source,
          status: "skipped",
          reason: "destination exists",
        });
        continue;
      }
      results.push({
        ...source,
        status: "failed",
        reason: error instanceof Error ? error.message : "copy failed",
      });
    }
  }

  return results;
}

async function describeLocalFile(
  projectPath: string,
  relativePath: string,
  isIgnored: (projectPath: string, relativePath: string) => Promise<boolean>,
): Promise<WorktreeLocalFileCandidate | null> {
  const normalized = normalizeWorktreeLocalFilePath(relativePath);
  if (!normalized) return null;
  const absolutePath = resolveUnder(projectPath, normalized);
  if (!absolutePath) return null;

  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(absolutePath);
  } catch {
    return null;
  }
  if (!info.isFile() || info.isSymbolicLink()) return null;
  if (info.size > MAX_FILE_SIZE_BYTES) return null;
  if (!(await isIgnored(projectPath, normalized))) return null;

  return { path: normalized, size: info.size };
}

function normalizeSelectedPaths(
  value: unknown,
): Array<{ input: string; normalized: string | null }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ input: string; normalized: string | null }> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = normalizeWorktreeLocalFilePath(item);
    const input = item.slice(0, 500);
    if (!normalized) {
      out.push({ input, normalized: null });
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ input, normalized });
  }
  return out;
}

function isLikelyLocalConfigFile(relativePath: string): boolean {
  const base = path.posix.basename(relativePath);
  if (CANDIDATE_BASENAMES.has(base)) return true;
  if (base.startsWith(".env.")) return true;
  if (base.endsWith(".local")) return true;
  return false;
}

async function isGitIgnored(
  projectPath: string,
  relativePath: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["-C", projectPath, "check-ignore", "--quiet", "--", relativePath],
      { timeout: 3000, maxBuffer: 1024 * 1024 },
    );
    return true;
  } catch {
    return false;
  }
}

function resolveUnder(root: string, relativePath: string): string | null {
  const normalized = normalizeWorktreeLocalFilePath(relativePath);
  if (!normalized) return null;
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, ...normalized.split("/"));
  const rel = path.relative(rootPath, candidate);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return candidate;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, resolve, sep } from "node:path";
import type {
  FileUploadDisposition,
  FileUploadRejectReason,
  FileUploadResultEntry,
} from "@parasor/shared";
import writeFileAtomic from "write-file-atomic";

export type InvalidTargetReason = "path-traversal" | "not-a-dir" | "missing";

export class InvalidUploadFilenameError extends Error {
  readonly reason: FileUploadRejectReason;
  constructor(reason: FileUploadRejectReason, message?: string) {
    super(message ?? `invalid filename: ${reason}`);
    this.reason = reason;
    this.name = "InvalidUploadFilenameError";
  }
}

export class InvalidUploadTargetError extends Error {
  readonly reason: InvalidTargetReason;
  constructor(reason: InvalidTargetReason, message?: string) {
    super(message ?? `invalid target: ${reason}`);
    this.reason = reason;
    this.name = "InvalidUploadTargetError";
  }
}

export class UploadConflictError extends Error {
  readonly conflicts: string[];
  constructor(conflicts: string[]) {
    super(`conflict: ${conflicts.join(", ")}`);
    this.conflicts = [...conflicts];
    this.name = "UploadConflictError";
  }
}

/**
 * Same character/length policy as `fs/drops.ts#sanitizeFilename`. The
 * difference: drops always live under `{root}/.parasor/drops/`, whereas
 * uploads target an arbitrary subdir. Both protect against `..` segments
 * and control characters at the filename layer; the realpath fence below
 * protects the directory layer.
 */
export function sanitizeUploadFilename(input: string): string {
  const nfc = input.normalize("NFC");
  if (nfc === "" || nfc === "." || nfc === "..") {
    throw new InvalidUploadFilenameError("path-traversal");
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(nfc)) {
    throw new InvalidUploadFilenameError("path-traversal");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: upload filenames intentionally rewrite C0/DEL bytes.
  const replaced = nfc.replace(/[\\/\x00-\x1f\x7f 　]/g, "_");
  if (replaced === "." || replaced === "..") {
    throw new InvalidUploadFilenameError("path-traversal");
  }
  if (replaced.length <= 255) return replaced;
  const ext = extname(replaced);
  const base = replaced.slice(0, 255 - ext.length);
  return base + ext;
}

function splitBasenameExt(name: string): { base: string; ext: string } {
  const ext = extname(name);
  return { base: ext ? name.slice(0, -ext.length) : name, ext };
}

const MAX_SUFFIX_ATTEMPTS = 1000;

/**
 * Resolve `relative` against `projectRoot` and prove the result is an
 * existing directory inside the project. Returns the canonicalized
 * (realpath-ed) absolute path; the caller writes into it.
 *
 * `relative` is the value submitted by the client via the `path` query
 * parameter. An empty string (or `.`) means "the project root itself".
 */
export async function resolveTargetDir(
  projectRoot: string,
  relative: string,
): Promise<string> {
  if (isAbsolute(relative)) {
    throw new InvalidUploadTargetError("path-traversal");
  }
  const candidate = resolve(projectRoot, relative);
  // Lexical pre-check: a `..` segment can escape even before the directory
  // exists. Surface that as `path-traversal` instead of `missing`, so the
  // client can distinguish "you tried to write outside the project" from
  // "the requested folder was deleted under you".
  if (candidate !== projectRoot && !candidate.startsWith(projectRoot + sep)) {
    throw new InvalidUploadTargetError("path-traversal");
  }

  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = await realpath(projectRoot);
  } catch {
    throw new InvalidUploadTargetError("missing");
  }
  try {
    realCandidate = await realpath(candidate);
  } catch (err) {
    if (isNodeErrorWithCode(err, "ENOENT")) {
      throw new InvalidUploadTargetError("missing");
    }
    throw err;
  }

  // Defence in depth: even if both lexical paths land inside the project
  // root, a symlink under the project may point outside. Compare canonical
  // paths to catch `<project>/escape -> /tmp/elsewhere` redirects.
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) {
    throw new InvalidUploadTargetError("path-traversal");
  }

  let st: import("node:fs").Stats;
  try {
    st = await stat(realCandidate);
  } catch {
    throw new InvalidUploadTargetError("missing");
  }
  if (!st.isDirectory()) {
    throw new InvalidUploadTargetError("not-a-dir");
  }
  return realCandidate;
}

export interface UploadInput {
  filename: string;
  bytes: Uint8Array;
}

export interface SaveUploadsDeps {
  /** Test-only override for the `O_EXCL` filename-claim step. */
  openForTest?: typeof open;
}

/**
 * Persist `inputs` into `targetDir` (already validated by
 * `resolveTargetDir`) and return a result entry per input describing
 * what happened on disk.
 *
 * `disposition` decides conflict semantics:
 * - `replace`   -- overwrite existing files in place via atomic rename
 * - `keep-both` -- write next to the existing file with `-2`, `-3`, ...
 * - `skip`      -- preflight all collisions; if any exist, throw
 *                 `UploadConflictError` and write nothing
 *
 * `targetDir` must be the canonical (realpath-ed) directory; this
 * function asserts every claim path lives under it as a defence-in-depth
 * fence behind `resolveTargetDir`.
 */
export async function saveUploads(
  targetDir: string,
  inputs: readonly UploadInput[],
  disposition: FileUploadDisposition,
  deps: SaveUploadsDeps = {},
): Promise<FileUploadResultEntry[]> {
  if (inputs.length === 0) return [];
  const openFn = deps.openForTest ?? open;

  if (disposition === "skip") {
    const conflicts: string[] = [];
    for (const input of inputs) {
      const sanitized = sanitizeUploadFilename(input.filename);
      const candidate = resolve(targetDir, sanitized);
      if (!candidate.startsWith(targetDir + sep)) {
        throw new InvalidUploadFilenameError("path-traversal");
      }
      try {
        await stat(candidate);
        conflicts.push(sanitized);
      } catch (err) {
        if (!isNodeErrorWithCode(err, "ENOENT")) throw err;
      }
    }
    if (conflicts.length > 0) {
      throw new UploadConflictError(conflicts);
    }
  }

  const results: FileUploadResultEntry[] = [];
  for (const input of inputs) {
    const sanitized = sanitizeUploadFilename(input.filename);
    const { base, ext } = splitBasenameExt(sanitized);

    let finalName = sanitized;
    let target = resolve(targetDir, finalName);
    if (!target.startsWith(targetDir + sep)) {
      throw new InvalidUploadFilenameError(
        "path-traversal",
        `refusing to write outside ${targetDir}`,
      );
    }

    let status: "written" | "renamed";
    if (disposition === "replace") {
      // writeFileAtomic uses a temp + rename so we either overwrite
      // atomically or leave the original untouched. No O_EXCL claim
      // because we explicitly intend to replace.
      await writeFileAtomic(target, Buffer.from(input.bytes));
      status = "written";
    } else {
      // keep-both (default): claim with O_EXCL, retry with -2, -3, ...
      let attempt = 2;
      let claimed = false;
      let renamed = false;
      while (!claimed) {
        if (!target.startsWith(targetDir + sep)) {
          throw new InvalidUploadFilenameError(
            "path-traversal",
            `refusing to write outside ${targetDir}`,
          );
        }
        try {
          const fh = await openFn(target, "wx");
          await fh.close();
          claimed = true;
        } catch (err) {
          if (!isNodeErrorWithCode(err, "EEXIST")) throw err;
          if (attempt > MAX_SUFFIX_ATTEMPTS) {
            throw new Error(
              `saveUploads: exhausted ${MAX_SUFFIX_ATTEMPTS} collision slots for ${sanitized}`,
            );
          }
          finalName = `${base}-${attempt}${ext}`;
          target = resolve(targetDir, finalName);
          attempt += 1;
          renamed = true;
        }
      }
      await writeFileAtomic(target, Buffer.from(input.bytes));
      status = renamed ? "renamed" : "written";
    }

    results.push({
      originalName: input.filename,
      status,
      finalName,
      finalPath: target,
    });
  }
  return results;
}

function isNodeErrorWithCode(err: unknown, code: string): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === code
  );
}

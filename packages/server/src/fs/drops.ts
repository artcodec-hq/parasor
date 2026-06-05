import { open, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import writeFileAtomic from "write-file-atomic";

/**
 * Drops handler shared by chat-input image paste / DnD. Files are persisted
 * under a caller-supplied `targetDir`; in production that is an
 * `UploadStaging`-managed temp directory outside the project tree (issue
 * upload staging isolation). The function does not create the dir -- the caller is expected to
 * have produced it via `UploadStaging.acquire(sessionId)` so that the 3-
 * layer GC owns its lifetime.
 */

export type DropRejectReason =
  | "path-traversal"
  | "control-char"
  | "too-long"
  | "empty"
  | "reserved";

export class InvalidFilenameError extends Error {
  readonly reason: DropRejectReason;
  constructor(reason: DropRejectReason, message?: string) {
    super(message ?? `invalid filename: ${reason}`);
    this.reason = reason;
    this.name = "InvalidFilenameError";
  }
}

/**
 * Drop naming: `{YYYYMMDD-HHMMSS}_{sanitized}` in local time. Local time
 * is an explicit product decision (by design) -- the CLI user wants to
 * reference "the file I just dropped" by human-readable wall-clock,
 * not UTC.
 */
function formatTimestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Replace characters the OS filesystem or pty pipe cannot safely carry:
 * path separators, NUL, C0 controls, ASCII and NBSP whitespace. Reject
 * the request outright for the three strings that silently resolve to
 * a parent directory (`""`, `"."`, `".."`) or that include a `..`
 * segment. Caller further fences the result against the target dir
 * before writing (defence in depth).
 */
export function sanitizeFilename(input: string): string {
  const nfc = input.normalize("NFC");
  if (nfc === "" || nfc === "." || nfc === "..") {
    throw new InvalidFilenameError("path-traversal");
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(nfc)) {
    throw new InvalidFilenameError("path-traversal");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: upload filenames intentionally rewrite C0/DEL bytes.
  const replaced = nfc.replace(/[\\/\x00-\x1f\x7f 　]/g, "_");
  if (replaced === "." || replaced === "..") {
    throw new InvalidFilenameError("path-traversal");
  }
  if (replaced.length <= 255) return replaced;
  const ext = extname(replaced);
  const base = replaced.slice(0, 255 - ext.length);
  return base + ext;
}

/**
 * `extname("image.tar.gz") === ".gz"`, so suffix insertion happens before
 * the final extension only; conflict-count inserts ahead of `.gz` rather
 * than in front of `.tar`. Agreed tradeoff -- the alternative (strip every
 * tail ext) mis-handles dotted filenames like `component.test.tsx`.
 */
function splitBasenameExt(name: string): { base: string; ext: string } {
  const ext = extname(name);
  return { base: ext ? name.slice(0, -ext.length) : name, ext };
}

const MAX_SUFFIX_ATTEMPTS = 1000;

export interface SaveDropsDeps {
  /** Returns the current wall-clock. Injected for deterministic tests. */
  now?: () => Date;
  /**
   * Test-only override for the `O_EXCL` filename-claim step. Production
   * code always uses `node:fs/promises.open`; tests inject a stub that
   * fakes EEXIST to exercise the collision-retry loop without pre-
   * populating 1000+ real files on disk.
   */
  openForTest?: typeof open;
}

export interface DropInput {
  /** Original filename as provided by the client. Sanitized internally. */
  filename: string;
  /** Raw file bytes to persist. */
  bytes: Uint8Array;
}

/**
 * Persist drops under `targetDir` (already created by the caller --
 * typically `UploadStaging.acquire(sessionId)`) and return the absolute
 * written paths in the same order as the input. Collisions in the same
 * second get a `-2`, `-3`, ... suffix inserted before the final
 * extension. `writeFileAtomic` guarantees partial writes are
 * impossible: the temp file is renamed into place only after flush.
 */
export async function saveDrops(
  targetDir: string,
  inputs: readonly DropInput[],
  deps: SaveDropsDeps = {},
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const now = deps.now ?? (() => new Date());
  const openFn = deps.openForTest ?? open;

  /**
   * Realpath the supplied dir as defence in depth: even though the
   * caller is expected to have done this, a regression upstream (e.g.
   * passing a pre-canonical path that contains a symlink) would otherwise
   * let a planted symlink under `targetDir` redirect writes outside it.
   * We compare canonical paths when fencing each claim.
   */
  const canonicalTarget = await realpath(targetDir);

  const saved: string[] = [];
  for (const input of inputs) {
    const sanitized = sanitizeFilename(input.filename);
    const timestamp = formatTimestamp(now());
    const { base, ext } = splitBasenameExt(sanitized);
    const prefix = `${timestamp}_${base}`;

    let finalName = `${prefix}${ext}`;
    let attempt = 2;
    let target = resolve(canonicalTarget, finalName);
    /**
     * Claim the final filename with an exclusive create (`O_EXCL`). This
     * closes the check-then-write TOCTOU window that a `statSync + write`
     * probe would leave open: two parallel uploads of `notes.txt` in the
     * same second would otherwise both pass the exists-check and race
     * each other's `writeFileAtomic(rename)` to overwrite the winner.
     * `wx` fails with EEXIST if the file exists, so losers fall through
     * to the next suffix.
     */
    while (true) {
      // Fence against sanitizer misses: the claimed path must live under
      // the canonicalized target dir.
      if (!target.startsWith(canonicalTarget + sep)) {
        throw new InvalidFilenameError(
          "path-traversal",
          `refusing to write outside ${canonicalTarget}`,
        );
      }
      try {
        const fh = await openFn(target, "wx");
        await fh.close();
        break;
      } catch (err) {
        if (!isNodeErrorWithCode(err, "EEXIST")) throw err;
        if (attempt > MAX_SUFFIX_ATTEMPTS) {
          throw new Error(
            `saveDrops: exhausted ${MAX_SUFFIX_ATTEMPTS} collision slots for ${sanitized}`,
          );
        }
        finalName = `${prefix}-${attempt}${ext}`;
        target = resolve(canonicalTarget, finalName);
        attempt += 1;
      }
    }

    // write-file-atomic expects `string | Buffer`. Wrap without copying:
    // `Buffer.from(Uint8Array)` shares the backing ArrayBuffer.
    // The `O_EXCL` claim above has already reserved the final filename,
    // so the atomic rename inside writeFileAtomic now only overwrites
    // our own empty claim file -- never another uploader's content.
    await writeFileAtomic(target, Buffer.from(input.bytes));
    saved.push(target);
  }
  return saved;
}

function isNodeErrorWithCode(err: unknown, code: string): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === code
  );
}

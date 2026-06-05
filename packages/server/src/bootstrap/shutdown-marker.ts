import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

const SERVER_MARKER_FILENAME = "shutdown.marker";
const DAEMON_MARKER_FILENAME = "daemon-shutdown.marker";

/**
 * Write a marker file at the end of a graceful shutdown. On next startup
 * the absence of this file means the previous run crashed, which in turn
 * means child PTY processes may be orphaned and unsafe to respawn with
 * the same command (potential double-run).
 *
 * The default filename `shutdown.marker` belongs to the in-process
 * server. Daemon-mode passes `daemon-shutdown.marker` so the two writers
 * never collide on the same `state.json` directory -- a graceful
 * server-side shutdown does not imply the daemon (which owns the PTY
 * children in remote mode) also exited gracefully.
 *
 * The write is open->write->fsync(file)->close->fsync(dir) so a kernel
 * panic between the graceful-exit code path and the next boot does not
 * let the marker "exist" only in dirty page-cache while the post-panic
 * boot reads its absence as graceful. The directory fsync is essential
 * because the marker's *existence* (not its content) is what subsequent
 * boots check -- without it, the directory entry created by `openSync`
 * may live in dirty inode cache only (). Both fsyncs
 * are best-effort: if either fails we still close the fd; worst case the
 * marker is read as absent on the next boot, which is the conservative
 * "treat as crash" side.
 */
export function writeShutdownMarker(
  configDir: string,
  filename: string = SERVER_MARKER_FILENAME,
): void {
  const path = join(configDir, filename);
  const dir = dirname(path);
  try {
    mkdirSync(dir, { recursive: true });
    const fd = openSync(path, "w");
    try {
      writeSync(fd, String(Date.now()));
      try {
        fsyncSync(fd);
      } catch {
        // fsync may fail on filesystems that do not support it (tmpfs on
        // some Linux configurations). The data is still committed to the
        // page cache; on a clean shutdown that is sufficient. Falling
        // through to close keeps the marker in the conservative state.
      }
    } finally {
      closeSync(fd);
    }
    // fsync the parent directory so the new directory entry survives a
    // kernel panic. On Linux this guarantees the marker file is visible
    // post-reboot; on macOS HFS+/APFS it is also durable. F_FULLFSYNC
    // would be stronger but is not exposed by node's stdlib.
    try {
      const dirFd = openSync(dir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Some platforms (notably Windows) reject fsync on a directory
      // handle. Skip silently -- the file fsync above is the best we can
      // do, and the conservative "treat absent as crash" rule still
      // catches a missing marker on the next boot.
    }
  } catch {
    // best-effort: failing to write the marker degrades to "treat as crash"
    // which is the conservative side and not catastrophic.
  }
}

/**
 * Read the marker on startup. Returns true if the previous shutdown was
 * graceful. The marker is always cleared so that a subsequent crash is
 * correctly detected.
 */
export function readAndClearShutdownMarker(
  configDir: string,
  filename: string = SERVER_MARKER_FILENAME,
): boolean {
  const path = join(configDir, filename);
  const present = existsSync(path);
  if (present) {
    try {
      unlinkSync(path);
    } catch {
      // ignore -- stale marker is harmless; it will be overwritten next shutdown
    }
  }
  return present;
}

/** Convenience wrappers -- daemon-side callers should prefer these to keep
 *  the marker filename centralised here. */
export function writeDaemonShutdownMarker(stateDir: string): void {
  writeShutdownMarker(stateDir, DAEMON_MARKER_FILENAME);
}

export function readAndClearDaemonShutdownMarker(stateDir: string): boolean {
  return readAndClearShutdownMarker(stateDir, DAEMON_MARKER_FILENAME);
}

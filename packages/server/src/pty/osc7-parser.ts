import { resolve } from "node:path";

const ESC = "\x1b";
const BEL = "\x07";
const OSC7_PREFIX = `${ESC}]7;`;
const MAX_PARTIAL = 4096;

/**
 * Tracks OSC 7 escape sequences in PTY output to detect CWD changes.
 * Handles sequences split across multiple data chunks.
 *
 * OSC 7 format: \x1b]7;file://hostname/path\x07 (BEL terminator)
 *           or: \x1b]7;file://hostname/path\x1b\\ (ST terminator)
 */
export class Osc7Parser {
  private partial = "";

  /**
   * Feed PTY output data. Returns the new CWD if an OSC 7 sequence was found, or null.
   * May return multiple CWDs if multiple sequences are in one chunk -- returns the last one.
   */
  feed(data: string): string | null {
    let result: string | null = null;
    const input = this.partial + data;
    this.partial = "";

    let pos = 0;
    while (pos < input.length) {
      const oscStart = input.indexOf(OSC7_PREFIX, pos);
      if (oscStart < 0) break;

      const payloadStart = oscStart + OSC7_PREFIX.length;

      // Find terminator: BEL (\x07) or ST (\x1b\\)
      let endPos = -1;
      let terminatorLen = 0;
      for (let i = payloadStart; i < input.length; i++) {
        if (input[i] === BEL) {
          endPos = i;
          terminatorLen = 1;
          break;
        }
        if (input[i] === ESC && i + 1 < input.length && input[i + 1] === "\\") {
          endPos = i;
          terminatorLen = 2;
          break;
        }
      }

      if (endPos < 0) {
        // Incomplete sequence -- buffer for next chunk (with size limit)
        const remaining = input.slice(oscStart);
        this.partial = remaining.length <= MAX_PARTIAL ? remaining : "";
        return result;
      }

      const uri = input.slice(payloadStart, endPos);
      if (uri.length > MAX_PARTIAL) {
        pos = endPos + terminatorLen;
        continue;
      }
      const cwd = parseFileUri(uri);
      if (cwd) result = cwd;

      pos = endPos + terminatorLen;
    }

    return result;
  }

  reset(): void {
    this.partial = "";
  }
}

/**
 * Parse a file:// URI into a local path.
 * Handles: file://hostname/path, file:///path, file://localhost/path
 * Decodes percent-encoded characters.
 */
export function parseFileUri(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  const rest = uri.slice(7); // after "file://"
  // Skip hostname (up to the first /)
  const slashIdx = rest.indexOf("/");
  if (slashIdx < 0) return null;
  const hostname = rest.slice(0, slashIdx);
  if (hostname !== "" && hostname !== "localhost") return null;
  const encoded = rest.slice(slashIdx);
  try {
    const decoded = decodeURIComponent(encoded);
    return resolve(decoded); // normalize .. segments
  } catch {
    return null;
  }
}

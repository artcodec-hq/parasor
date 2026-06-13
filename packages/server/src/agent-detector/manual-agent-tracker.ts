import { sanitizeTerminalOutput } from "./detector.js";
import { detectAgentCommandLine } from "./runtime-registry.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: alternate-screen enter is detected from raw terminal ESC sequences.
const ALT_SCREEN_ENTER = /\x1b\[\?1049h|\x1b\[\?47h/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: alternate-screen exit is detected from raw terminal ESC sequences.
const ALT_SCREEN_EXIT = /\x1b\[\?1049l|\x1b\[\?47l/;
const TURN_COMPLETE_PATTERNS = [
  /(?:^|\n)\s*❯\s*$/u,
  /(?:^|\n)\s*>\s*$/u,
  /(?:^|\n)\s*\$\s*$/u,
];

interface ManualAgentTrackerOptions {
  onDebug?: (sessionId: string, message: string) => void;
}

type TrackedAgent = string;

function shouldActivateWithoutAltScreen(agent: TrackedAgent | null): boolean {
  return agent !== null && agent !== "claude";
}

export class ManualAgentTracker {
  private lineBuffers = new Map<string, string>();
  private hintedSessions = new Map<string, TrackedAgent>();
  private activeSessions = new Set<string>();
  private engagedSessions = new Set<string>();
  private onDebug?: (sessionId: string, message: string) => void;

  constructor(options?: ManualAgentTrackerOptions) {
    this.onDebug = options?.onDebug;
  }

  observeInput(sessionId: string, data: string): void {
    if (data.includes("\u0003")) {
      this.clear(sessionId, "ctrl-c");
      return;
    }

    let buffer = this.lineBuffers.get(sessionId) ?? "";
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        const line = buffer.trim();
        if (this.activeSessions.has(sessionId)) {
          if (line.length > 0) {
            this.engagedSessions.add(sessionId);
            this.debug(sessionId, `prompt submit ${line.slice(0, 32)}`);
          }
        } else {
          const hintedAgent = this.hintedSessions.get(sessionId) ?? null;
          if (line.length > 0 && shouldActivateWithoutAltScreen(hintedAgent)) {
            this.activeSessions.add(sessionId);
            this.engagedSessions.add(sessionId);
            this.debug(sessionId, `prompt submit ${line.slice(0, 32)}`);
          } else {
            const hinted = detectAgentCommandLine(line);
            if (hinted) {
              this.hintedSessions.set(sessionId, hinted);
              this.debug(sessionId, `hint ${line}`);
            }
          }
        }
        buffer = "";
        continue;
      }

      if (char === "\u007f" || char === "\b") {
        buffer = buffer.slice(0, -1);
        continue;
      }

      if (char >= " ") {
        buffer += char;
      }
    }

    this.lineBuffers.set(sessionId, buffer);
  }

  observeOutput(sessionId: string, data: string): void {
    if (ALT_SCREEN_ENTER.test(data) && this.hintedSessions.has(sessionId)) {
      this.activeSessions.add(sessionId);
      this.lineBuffers.set(sessionId, "");
      this.debug(sessionId, "alt-screen enter");
    }

    const sanitized = sanitizeTerminalOutput(data);
    if (
      this.engagedSessions.has(sessionId) &&
      TURN_COMPLETE_PATTERNS.some((pattern) => pattern.test(sanitized))
    ) {
      this.engagedSessions.delete(sessionId);
      this.debug(sessionId, "turn complete");
    }

    if (ALT_SCREEN_EXIT.test(data)) {
      this.clear(sessionId, "alt-screen exit");
    }
  }

  shouldObserve(sessionId: string): boolean {
    return this.engagedSessions.has(sessionId);
  }

  removeSession(sessionId: string): void {
    this.lineBuffers.delete(sessionId);
    this.hintedSessions.delete(sessionId);
    this.activeSessions.delete(sessionId);
    this.engagedSessions.delete(sessionId);
  }

  private clear(sessionId: string, reason: string): void {
    const hadHint = this.hintedSessions.delete(sessionId) !== undefined;
    const hadActive = this.activeSessions.delete(sessionId);
    const hadEngaged = this.engagedSessions.delete(sessionId);
    this.lineBuffers.delete(sessionId);
    if (hadHint || hadActive || hadEngaged) {
      this.debug(sessionId, `clear ${reason}`);
    }
  }

  private debug(sessionId: string, message: string): void {
    this.onDebug?.(sessionId, message);
    if (process.env.PARASOR_AGENT_DEBUG !== "1") return;
    // eslint-disable-next-line no-console
    console.error(
      `[agent-tracker] session=${sessionId.slice(0, 8)} ${message}`,
    );
  }
}

import type { Terminal as XTerm } from "@xterm/xterm";
import { scheduleTerminalInputDiagnosticCapture } from "../../../lib/terminal-trace.js";

const TERMINAL_INPUT_DIAGNOSTIC_DELAYS_MS = [80, 250] as const;

type ScheduleTerminalInputDiagnosticsArgs = {
  sessionId: string;
  term: XTerm;
  dataLength: number;
  status: string;
  timers: Set<number>;
};

export function scheduleTerminalInputDiagnostics({
  sessionId,
  term,
  dataLength,
  status,
  timers,
}: ScheduleTerminalInputDiagnosticsArgs): void {
  const buildEvent = (delayMs: number) => ({
    type: "terminal-input-diagnostic",
    sessionId,
    dataLength,
    status,
    cols: term.cols,
    rows: term.rows,
    cursorX: term.buffer.active.cursorX,
    cursorY: term.buffer.active.cursorY,
    viewportY: term.buffer.active.viewportY,
    baseY: term.buffer.active.baseY,
    delayMs,
  });

  scheduleTerminalInputDiagnosticCapture("terminal-input-sent", buildEvent(0));
  for (const delayMs of TERMINAL_INPUT_DIAGNOSTIC_DELAYS_MS) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      scheduleTerminalInputDiagnosticCapture(
        `terminal-input-after-${delayMs}ms`,
        buildEvent(delayMs),
      );
    }, delayMs);
    timers.add(timer);
  }
}

export function clearTerminalInputDiagnosticTimers(timers: Set<number>): void {
  for (const timer of timers) {
    window.clearTimeout(timer);
  }
  timers.clear();
}

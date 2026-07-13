import { describe, expect, it } from "vitest";
import {
  resolveTerminalSessionStatus,
  shouldShowTerminalSessionError,
} from "./terminal-session-status.js";

describe("terminal-session-status", () => {
  it("keeps auto-resumable ended sessions out of the error state", () => {
    expect(
      shouldShowTerminalSessionError({
        sessionState: "ended",
        sessionCommand: { type: "shell" },
        sessionEndReason: { type: "exit", code: 0 },
      }),
    ).toBe(false);
  });

  it("shows an error for ended sessions that cannot auto-resume", () => {
    expect(
      shouldShowTerminalSessionError({
        sessionState: "ended",
        sessionCommand: { type: "custom", command: "vim", args: [] },
        sessionEndReason: { type: "exit", code: 0 },
      }),
    ).toBe(true);
  });

  it("treats socket-ended terminals as ended even without a session error", () => {
    expect(
      resolveTerminalSessionStatus({
        showError: false,
        socketStatus: "ended",
      }),
    ).toEqual({
      socketEnded: true,
      isEnded: true,
    });
  });

  it("treats a session error as ended while the socket is still connecting", () => {
    expect(
      resolveTerminalSessionStatus({
        showError: true,
        socketStatus: "connecting",
      }),
    ).toEqual({
      socketEnded: false,
      isEnded: true,
    });
  });
});

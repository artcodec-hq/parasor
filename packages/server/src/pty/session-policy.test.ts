import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRestartSeparator,
  deriveEndReason,
  deriveLoadFallbackEndReason,
  deriveRecordExit,
  isAutoResumable,
  parseLastSeen,
  resolveSessionCommand,
  shouldDropStaleInput,
  shouldPauseOutputForClients,
  signalName,
} from "./session-policy.js";

describe("shouldDropStaleInput", () => {
  it("drops input tagged with a generation other than the current one", () => {
    expect(shouldDropStaleInput(1, 2)).toBe(true);
  });

  it("keeps input matching the current generation", () => {
    expect(shouldDropStaleInput(2, 2)).toBe(false);
  });

  it("treats undefined as the no-gating sentinel", () => {
    expect(shouldDropStaleInput(undefined, 5)).toBe(false);
  });

  it("treats 0 as the no-gating sentinel", () => {
    expect(shouldDropStaleInput(0, 5)).toBe(false);
  });
});

describe("shouldPauseOutputForClients", () => {
  it("pauses when the only client is flow-paused", () => {
    expect(shouldPauseOutputForClients([true])).toBe(true);
  });

  it("does not pause when the only client is active", () => {
    expect(shouldPauseOutputForClients([false])).toBe(false);
  });

  it("never pauses with no clients", () => {
    expect(shouldPauseOutputForClients([])).toBe(false);
  });

  it("never pauses with multiple clients even if all are paused", () => {
    expect(shouldPauseOutputForClients([true, true])).toBe(false);
  });
});

describe("isAutoResumable", () => {
  it.each([
    ["exit", { type: "exit", code: 0 } as const],
    ["signal", { type: "signal", signal: 15 } as const],
    ["server-graceful", { type: "server-graceful" } as const],
    ["daemon-graceful", { type: "daemon-graceful" } as const],
  ])("resumes a shell that ended via %s", (_label, reason) => {
    expect(isAutoResumable({ type: "shell" }, reason)).toBe(true);
  });

  it("resumes a claude session that exited naturally", () => {
    expect(isAutoResumable({ type: "claude" }, { type: "exit", code: 0 })).toBe(
      true,
    );
  });

  it.each([
    ["server-crash", { type: "server-crash" } as const],
    ["daemon-crash", { type: "daemon-crash" } as const],
  ])("refuses to resume after %s (orphan risk)", (_label, reason) => {
    expect(isAutoResumable({ type: "shell" }, reason)).toBe(false);
  });

  it("refuses to resume a custom command (side-effects)", () => {
    expect(
      isAutoResumable(
        { type: "custom", command: "pnpm", args: ["dev"] },
        { type: "exit", code: 0 },
      ),
    ).toBe(false);
  });

  it("refuses to resume when there is no end reason", () => {
    expect(isAutoResumable({ type: "shell" }, undefined)).toBe(false);
  });
});

describe("deriveEndReason", () => {
  it("reports a signal end when the child was killed by a non-zero signal", () => {
    expect(deriveEndReason(15, 0)).toEqual({ type: "signal", signal: 15 });
  });

  it("reports an exit end when there is no signal", () => {
    expect(deriveEndReason(undefined, 3)).toEqual({ type: "exit", code: 3 });
  });

  it("treats signal 0 as a normal exit", () => {
    expect(deriveEndReason(0, 0)).toEqual({ type: "exit", code: 0 });
  });
});

describe("deriveLoadFallbackEndReason", () => {
  it("labels a graceful daemon shutdown", () => {
    expect(deriveLoadFallbackEndReason(true, true)).toEqual({
      type: "daemon-graceful",
    });
  });

  it("labels a daemon crash", () => {
    expect(deriveLoadFallbackEndReason(true, false)).toEqual({
      type: "daemon-crash",
    });
  });

  it("labels a graceful in-process server shutdown", () => {
    expect(deriveLoadFallbackEndReason(false, true)).toEqual({
      type: "server-graceful",
    });
  });

  it("labels an in-process server crash", () => {
    expect(deriveLoadFallbackEndReason(false, false)).toEqual({
      type: "server-crash",
    });
  });
});

describe("deriveRecordExit", () => {
  it("records a finite exit code with no signal", () => {
    expect(deriveRecordExit(0, undefined)).toEqual({
      exitCode: 0,
      exitSignal: null,
    });
  });

  it("records a signal name with a null exit code when killed", () => {
    expect(deriveRecordExit(undefined, 9)).toEqual({
      exitCode: null,
      exitSignal: "SIGKILL",
    });
  });

  it("nulls a non-finite exit code", () => {
    expect(deriveRecordExit(Number.NaN, undefined)).toEqual({
      exitCode: null,
      exitSignal: null,
    });
  });
});

describe("signalName", () => {
  it("maps a known POSIX signal number to its name", () => {
    expect(signalName(15)).toBe("SIGTERM");
  });

  it("falls back to SIG<n> for unmapped signals", () => {
    expect(signalName(34)).toBe("SIG34");
  });
});

describe("parseLastSeen", () => {
  it("returns undefined for absent input", () => {
    expect(parseLastSeen(undefined)).toBeUndefined();
  });

  it("parses a decimal seq into a BigInt", () => {
    expect(parseLastSeen({ generation: 2, seq: "42" })).toEqual({
      generation: 2,
      seq: 42n,
    });
  });

  it("returns undefined for a non-decimal seq", () => {
    expect(parseLastSeen({ generation: 1, seq: "4x2" })).toBeUndefined();
  });

  it("returns undefined for a negative seq (non-decimal)", () => {
    expect(parseLastSeen({ generation: 1, seq: "-1" })).toBeUndefined();
  });
});

describe("resolveSessionCommand", () => {
  it("uses a zsh shell with nopromptsp for shell sessions", () => {
    expect(
      resolveSessionCommand(
        { type: "shell" },
        { defaultShell: "/bin/zsh", bashRcPath: "/tmp/parasor/.bashrc" },
      ),
    ).toEqual({
      spawnCmd: "/bin/zsh",
      spawnArgs: ["-o", "nopromptsp"],
    });
  });

  it("uses a bash rc overlay when available", () => {
    expect(
      resolveSessionCommand(
        { type: "shell" },
        { defaultShell: "/bin/bash", bashRcPath: "/tmp/parasor/.bashrc" },
      ),
    ).toEqual({
      spawnCmd: "/bin/bash",
      spawnArgs: ["--rcfile", "/tmp/parasor/.bashrc", "-i"],
    });
  });

  it("preserves custom commands unchanged", () => {
    expect(
      resolveSessionCommand(
        { type: "custom", command: "pnpm", args: ["dev"] },
        { defaultShell: "/bin/zsh", bashRcPath: "/tmp/parasor/.bashrc" },
      ),
    ).toEqual({
      spawnCmd: "pnpm",
      spawnArgs: ["dev"],
    });
  });

  it("spawns the bare claude binary for claude sessions", () => {
    expect(resolveSessionCommand({ type: "claude" })).toEqual({
      spawnCmd: "claude",
      spawnArgs: [],
    });
  });

  describe("shell fallback when no defaultShell is given", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("falls back to process.env.SHELL", () => {
      vi.stubEnv("SHELL", "/usr/bin/zsh");
      expect(resolveSessionCommand({ type: "shell" })).toEqual({
        spawnCmd: "/usr/bin/zsh",
        spawnArgs: ["-o", "nopromptsp"],
      });
    });

    it('falls back to "bash" when SHELL is unset', () => {
      vi.stubEnv("SHELL", undefined);
      expect(resolveSessionCommand({ type: "shell" })).toEqual({
        spawnCmd: "bash",
        spawnArgs: [],
      });
    });
  });
});

describe("buildRestartSeparator", () => {
  const fixedNow = new Date("2026-04-20T12:00:00");

  it("emits a DEC private mode reset that includes DECCKM (1) so the resumed shell receives plain arrow-key escapes", () => {
    const separator = buildRestartSeparator(fixedNow);
    expect(separator).toContain(
      "\x1b[?1;9;1000;1001;1002;1003;1004;1005;1006;1015;1016l",
    );
  });

  it("resets the application keypad (DECPNM) so numeric/keypad keys are not reported as SS3 sequences", () => {
    const separator = buildRestartSeparator(fixedNow);
    expect(separator).toContain("\x1b>");
  });

  it("disables modifyOtherKeys so the resumed shell does not see literal CSI 27 sequences when the user presses arrow keys", () => {
    const separator = buildRestartSeparator(fixedNow);
    expect(separator).toContain("\x1b[>4;0m");
  });

  it("ends with a visible CRLF-bounded restart marker that includes the timestamp", () => {
    const separator = buildRestartSeparator(fixedNow);
    expect(separator).toContain(
      "\r\n\x1b[2m─── session restarted 2026-04-20 12:00 ───\x1b[0m\r\n",
    );
  });
});

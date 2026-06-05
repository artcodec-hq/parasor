import type { SessionCommand, SessionEndReason } from "@parasor/shared";

/**
 * Pure session policy & spawn-spec for the PTY hosts (Pure Core, see
 * `docs/architecture.md` ). No I/O: every function here is a
 * deterministic decision or derivation over its arguments, so they are
 * unit-testable without spawning a real PTY. The imperative shells
 * (`in-process-host.ts`, `remote-host.ts`) own node-pty / fs / IPC and
 * call into these.
 */

// --- Input gating -----------------------------------------------------

/**
 * PTY generation gate generation gate. Returns true when WS input tagged with a stale
 * `generation` must be dropped -- happens when a previous PTY's TUI sent a
 * DECRQM-style query and the terminal's reply is in-flight while we
 * auto-resume a new shell. `0` and `undefined` are both "no gating"
 * sentinels (legacy non-WS taps, pre-init-ack queued web INPUT, and the
 * daemon-IPC path when the legacy WRITE codec lacked a generation field).
 */
export function shouldDropStaleInput(
  generation: number | undefined,
  currentGeneration: number,
): boolean {
  return (
    generation !== undefined &&
    generation !== 0 &&
    generation !== currentGeneration
  );
}

// --- Output flow ------------------------------------------------------

/**
 * Single-client flow-pause rule: pause the PTY only when exactly one
 * client is attached and it is flow-paused. With multiple clients we
 * never pause (one slow client must not starve the others); with none we
 * never pause. `flowPausedFlags` is the `flowPaused` bit of each attached
 * client.
 */
export function shouldPauseOutputForClients(
  flowPausedFlags: boolean[],
): boolean {
  return flowPausedFlags.length === 1 && flowPausedFlags[0] === true;
}

// --- Lifecycle --------------------------------------------------------

/**
 * Returns true when a session that has ended may be silently re-spawned
 * with the same command -- no risk of running alongside an orphaned child
 * from a crashed server, and the command has no user-visible side-effects
 * warranting confirmation. Safe: shell / claude with natural exit,
 * signal, or graceful shutdown (server or daemon). Unsafe: any crash
 * (orphan risk) or a custom command (side-effects).
 */
export function isAutoResumable(
  command: SessionCommand,
  endReason: SessionEndReason | undefined,
): boolean {
  if (command.type !== "shell" && command.type !== "claude") return false;
  if (!endReason) return false;
  return (
    endReason.type === "exit" ||
    endReason.type === "signal" ||
    endReason.type === "server-graceful" ||
    endReason.type === "daemon-graceful"
  );
}

/**
 * Derive the WS-facing `SessionEndReason` from a node-pty exit event.
 * A non-zero numeric `signal` means the child was killed by a signal;
 * otherwise it exited normally with `exitCode`.
 */
export function deriveEndReason(
  signal: number | undefined,
  exitCode: number,
): SessionEndReason {
  return signal !== undefined && signal !== 0
    ? { type: "signal", signal }
    : { type: "exit", code: exitCode };
}

/**
 * End-reason to assume for a session rehydrated from `state.json` that
 * carries no explicit `endReason` (crash, or pre-existing record). The
 * label distinguishes the writer generation (daemon vs in-process server)
 * and whether the prior shutdown was graceful.
 */
export function deriveLoadFallbackEndReason(
  isDaemon: boolean,
  wasGracefulShutdown: boolean,
): SessionEndReason {
  if (isDaemon) {
    return wasGracefulShutdown
      ? { type: "daemon-graceful" }
      : { type: "daemon-crash" };
  }
  return wasGracefulShutdown
    ? { type: "server-graceful" }
    : { type: "server-crash" };
}

/**
 * Coerce a node-pty exit event into the `SessionRecord` exit fields
 * (schema: `exitCode: number | null`, `exitSignal: string | null`).
 * `exitCode` is null when the child died from a signal (non-finite /
 * absent code); `exitSignal` is the POSIX signal *name* (the doctor CLI
 * renders it verbatim) or null when the child exited normally.
 */
export function deriveRecordExit(
  exitCode: number | undefined,
  signal: number | undefined,
): { exitCode: number | null; exitSignal: string | null } {
  return {
    exitCode:
      typeof exitCode === "number" && Number.isFinite(exitCode)
        ? exitCode
        : null,
    exitSignal:
      typeof signal === "number" && signal > 0 ? signalName(signal) : null,
  };
}

// --- Signal naming ----------------------------------------------------

const POSIX_SIGNAL_NAMES: Record<number, string> = {
  1: "SIGHUP",
  2: "SIGINT",
  3: "SIGQUIT",
  6: "SIGABRT",
  9: "SIGKILL",
  13: "SIGPIPE",
  14: "SIGALRM",
  15: "SIGTERM",
};

/** Map a numeric POSIX signal to its name, falling back to `SIG<n>`. */
export function signalName(n: number): string {
  return POSIX_SIGNAL_NAMES[n] ?? `SIG${n}`;
}

// --- Cursor parsing ---------------------------------------------------

/**
 * Parse the wire-side `lastSeen.seq` (decimal string, BigInt JSON
 * encoding per `TerminalLastSeen`) into the BigInt the chunk ring
 * compares against. Returns `undefined` for absent/malformed input so
 * `readSince` falls back to "no cursor" -- the WS handler validates
 * structure but a defensive parse here keeps ring lookups total.
 */
export function parseLastSeen(
  lastSeen: { generation: number; seq: string } | undefined,
): { generation: number; seq: bigint } | undefined {
  if (!lastSeen) return undefined;
  if (!/^\d+$/.test(lastSeen.seq)) return undefined;
  try {
    return { generation: lastSeen.generation, seq: BigInt(lastSeen.seq) };
  } catch {
    return undefined;
  }
}

// --- Spawn spec -------------------------------------------------------

export interface ResolveSessionCommandOptions {
  bashRcPath?: string;
  defaultShell?: string;
}

export function buildRestartSeparator(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  /*
   * Reset the terminal modes that a previous TUI (vim / htop / Claude
   * Code CLI / etc.) may have left enabled in the replayed scrollback.
   * Without this, auto-resume respawns a plain shell but the xterm
   * still has e.g. mouse tracking on from the prior TUI's DECSET --
   * the shell doesn't consume mouse reports, so every cursor move
   * becomes stray readline input (`35;9;11M35;29;15M...`) that the
   * user sees as garbage on the prompt line.
   *
   * Modes reset here (DEC private mode reset = CSI ? N l):
   *       1                       -- DECCKM application cursor (claude code etc.)
   *       9                       -- X10 mouse (legacy but still xterm.js-supported)
   *   1000 / 1001 / 1002 / 1003   -- X11 mouse / highlight / cell-motion / all-motion
   *   1004                        -- focus reporting (vim / neovim / tmux arm this)
   *   1005 / 1006 / 1015 / 1016   -- UTF-8 / SGR / urxvt / SGR-pixels mouse encodings
   *   2004                        -- bracketed paste
   *    47 / 1047 / 1049           -- alternate screen (plus 1049 saves cursor)
   *    25                         -- cursor visibility (ensure cursor re-shown)
   *
   * Plus two non-DEC mode resets that DEC private reset cannot reach:
   *   `\x1b>`        -- DECPNM: reset application keypad to numeric mode
   *   `\x1b[>4;0m`   -- modifyOtherKeys 0: disable xterm extended key encoding.
   *                    claude code etc. enable level 1/2 to receive Shift+Enter
   *                    and friends as `\x1b[27;...~`; if not reset, the new
   *                    shell sees those long literal sequences when the user
   *                    presses arrow keys.
   */
  const resetModes =
    "\x1b[?1;9;1000;1001;1002;1003;1004;1005;1006;1015;1016l" +
    "\x1b[?2004l" +
    "\x1b[?47l\x1b[?1047l\x1b[?1049l" +
    "\x1b[?25h" +
    "\x1b>" +
    "\x1b[>4;0m";
  // ANSI dim (\x1b[2m) -> reset (\x1b[0m). Leading CRLF ensures the marker
  // starts on its own line even if the prior output did not end with one.
  return `${resetModes}\r\n\x1b[2m─── session restarted ${ts} ───\x1b[0m\r\n`;
}

export function resolveSessionCommand(
  command: SessionCommand,
  options: ResolveSessionCommandOptions = {},
): {
  spawnCmd: string;
  spawnArgs: string[];
} {
  switch (command.type) {
    case "shell": {
      const shell = options.defaultShell ?? process.env.SHELL ?? "bash";
      const args = shell.endsWith("zsh")
        ? ["-o", "nopromptsp"]
        : shell.endsWith("bash") && options.bashRcPath
          ? ["--rcfile", options.bashRcPath, "-i"]
          : [];
      return { spawnCmd: shell, spawnArgs: args };
    }
    case "claude":
      return { spawnCmd: "claude", spawnArgs: [] };
    case "custom":
      return { spawnCmd: command.command, spawnArgs: command.args };
  }
}

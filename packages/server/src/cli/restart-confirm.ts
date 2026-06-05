/*
 * Restart confirmation -- gate restart commands behind a confirmation when the
 * running daemon's PROTOCOL_VERSION is incompatible with this binary's.
 *
 * The mismatch path inside `pty/host.ts` SIGKILLs the daemon and every
 * PTY child to recover. This module probes the daemon BEFORE we kick
 * the supervisor, and prompts the user to acknowledge session loss.
 *
 * Non-interactive callers (launchd auto-respawn, scripted upgrades,
 * CI) cannot answer prompts. They must opt in via `--yes`/`-y`,
 * otherwise the restart aborts with a hint instead of hanging.
 */

import { createInterface } from "node:readline";
import { resolveDaemonPaths } from "../pty/host-daemon/paths.js";
import {
  type ProbeOptions,
  type ProbeResult,
  probeDaemonProtocolVersion,
} from "./probe-daemon-version.js";

export interface ConfirmRestartDeps {
  isTty: boolean;
  log: (message: string) => void;
  /** Reads one line from stdin. Resolves to null on EOF. */
  readLine: () => Promise<string | null>;
  probe: (opts: ProbeOptions) => Promise<ProbeResult>;
  resolvePaths: () => { socketPath: string };
}

export interface ConfirmRestartOptions {
  autoYes: boolean;
  /** Override for tests. */
  deps?: Partial<ConfirmRestartDeps>;
}

export interface ConfirmRestartResult {
  proceed: boolean;
  /** Human-readable explanation, surfaced to the caller's log on abort. */
  reason: string;
}

const DEFAULT_DEPS: ConfirmRestartDeps = {
  isTty: Boolean(process.stdin.isTTY),
  log: (msg) => process.stderr.write(`${msg}\n`),
  readLine: () => readLineFromInput(process.stdin),
  probe: (opts) => probeDaemonProtocolVersion(opts),
  resolvePaths: () => {
    const paths = resolveDaemonPaths();
    return { socketPath: paths.socketPath };
  },
};

export async function confirmRestartIfMismatch(
  options: ConfirmRestartOptions,
): Promise<ConfirmRestartResult> {
  const deps: ConfirmRestartDeps = { ...DEFAULT_DEPS, ...(options.deps ?? {}) };
  const { socketPath } = deps.resolvePaths();
  const probeResult = await deps.probe({ socketPath });

  if (probeResult.status === "no-daemon") {
    return { proceed: true, reason: "no daemon detected" };
  }
  if (probeResult.status === "compatible") {
    return {
      proceed: true,
      reason: `daemon ${probeResult.daemonVersion} compatible with server ${probeResult.serverVersion}`,
    };
  }
  if (probeResult.status === "unknown") {
    /*
     * Probe couldn't decide. Don't block the restart -- we may be
     * running against a future daemon version with a different reply
     * shape, or a transient IO error. Surface the reason so an
     * operator can investigate, but defer to the existing in-server
     * recovery path.
     */
    deps.log(
      `parasor: daemon version probe inconclusive (${probeResult.reason}); proceeding without confirmation.`,
    );
    return { proceed: true, reason: `probe unknown: ${probeResult.reason}` };
  }

  // probeResult.status === "mismatch"
  const banner =
    `parasor: this binary speaks PTY host protocol ${probeResult.serverVersion}, ` +
    `but the running daemon speaks ${probeResult.daemonVersion}. ` +
    `Continuing will terminate the daemon and every active PTY session.`;

  if (options.autoYes) {
    deps.log(`${banner} (--yes supplied, proceeding)`);
    return {
      proceed: true,
      reason: `mismatch acknowledged via --yes (server=${probeResult.serverVersion} daemon=${probeResult.daemonVersion})`,
    };
  }

  if (!deps.isTty) {
    deps.log(banner);
    deps.log(
      "parasor: stdin is not a TTY; pass --yes to acknowledge session loss in non-interactive contexts.",
    );
    return {
      proceed: false,
      reason: "non-interactive without --yes",
    };
  }

  deps.log(banner);
  deps.log("parasor: continue and lose all active sessions? [y/N] ");
  const answer = (await deps.readLine())?.trim().toLowerCase() ?? "";
  if (answer === "y" || answer === "yes") {
    return {
      proceed: true,
      reason: `user confirmed mismatch (server=${probeResult.serverVersion} daemon=${probeResult.daemonVersion})`,
    };
  }
  return { proceed: false, reason: "user declined" };
}

/**
 * Pull `--yes` / `-y` from an args array and return both the flag and the
 * filtered remainder. Modeled on the existing `--all` filtering style in
 * `cliService` so the help text stays consistent.
 */
export function extractAutoYesFlag(args: string[]): {
  autoYes: boolean;
  rest: string[];
} {
  const autoYes = args.includes("--yes") || args.includes("-y");
  const rest = args.filter((a) => a !== "--yes" && a !== "-y");
  return { autoYes, rest };
}

export function readLineFromInput(
  input: NodeJS.ReadableStream,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rl = createInterface({ input });
    rl.once("line", (line) => {
      settle(line);
      rl.close();
    });
    rl.once("close", () => settle(null));
  });
}

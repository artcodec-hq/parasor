import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  confirmRestartIfMismatch,
  extractAutoYesFlag,
} from "./restart-confirm.js";

/*
 * `parasor service ...` entry point. Platform-agnostic router: parse
 * subcommand, validate platform, resolve the on-disk path of the
 * currently-running parasor binary + daemon entry, hand control to a
 * platform-specific adapter (LaunchAgent on darwin, systemd user unit
 * on linux).
 *
 * `service install` is the SINGLE canonical
 * install path. It always provisions BOTH the server unit and the PTY
 * host daemon unit, with `PARASOR_PTY_DAEMON=1` and
 * `PARASOR_PTY_AUTOSTART=0` injected into the server env so the OS
 * supervisor (launchd / systemd) owns the daemon and the server connects
 * to it via the Unix socket. The server-managed daemon-as-child fallback
 * (Recipe 4.5) remains available via `export PARASOR_PTY_DAEMON=1`
 * outside of any service install -- it is not part of the install path.
 */

export interface ServiceAdapter {
  install(): Promise<void>;
  uninstall(): Promise<void>;
  status(): Promise<void>;
  /**
   * Restart installed units. Default scope is the server unit only --
   * the PTY host daemon owns running sessions
   * and kicking it terminates every PTY, defeating the daemon-mode
   * promise. Pass `all: true` for binary-upgrade scenarios where the
   * daemon code itself changed.
   */
  restart(opts: { all: boolean }): Promise<void>;
  logs(opts: { follow: boolean }): Promise<void>;
}

export interface CliServiceOptions {
  platform: NodeJS.Platform | string;
  adapter: ServiceAdapter;
  /** restart confirmation -- version-mismatch probe + confirmation. Injected for tests. */
  confirmRestart?: (opts: {
    autoYes: boolean;
  }) => Promise<{ proceed: boolean; reason: string }>;
}

const HELP = `Usage: parasor service <subcommand>

Manage parasor as a long-running service (LaunchAgent on macOS,
systemd user unit on Linux). Install always
provisions both the server unit and the PTY host daemon unit so the OS
supervisor restarts each independently and PTY sessions survive server
crashes.

Subcommands:
  install     Register parasor + parasor-pty-host at login + on crash
  uninstall   Stop and unregister whichever units are present
  status      Show installed / running / pid for each unit
  restart [--all] [--yes|-y]
              Restart the server unit. By default the PTY host daemon
              is left running so live sessions survive -- pass --all to
              also kick the daemon (binary upgrade scenarios). When the
              new server binary speaks a PROTOCOL_VERSION incompatible
              with the running daemon, the boot-side recovery path will
              SIGKILL the daemon and every active PTY; this command
              prompts for acknowledgement first. Pass --yes / -y to
              skip the prompt (required in non-interactive contexts).
  logs [-f]   Print or follow the server log file
  --help      Show this message`;

export async function cliService(
  args: string[],
  opts?: CliServiceOptions,
): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return;
  }

  const flags = args.slice(1);

  const resolved = opts ?? (await resolveDefaults());

  if (resolved.platform !== "darwin" && resolved.platform !== "linux") {
    throw new Error(
      "parasor service: unsupported platform -- service management is " +
        "available on macOS and Linux only.",
    );
  }

  switch (sub) {
    case "install":
      await resolved.adapter.install();
      return;
    case "uninstall":
      await resolved.adapter.uninstall();
      return;
    case "status":
      await resolved.adapter.status();
      return;
    case "restart": {
      const { autoYes, rest } = extractAutoYesFlag(flags);
      const all = rest.includes("--all");
      const confirm = resolved.confirmRestart ?? confirmRestartIfMismatch;
      const confirmation = await confirm({ autoYes });
      if (!confirmation.proceed) {
        process.stderr.write(
          `parasor service: restart aborted -- ${confirmation.reason}.\n`,
        );
        return;
      }
      await resolved.adapter.restart({ all });
      return;
    }
    case "logs":
      await resolved.adapter.logs({ follow: flags.includes("-f") });
      return;
    default:
      throw new Error(
        `parasor service: unknown subcommand '${sub}'. Run 'parasor service --help' for usage.`,
      );
  }
}

/*
 * Resolve the absolute, symlink-free path to the parasor executable that
 * invoked us. LaunchAgent/systemd units must reference the stable on-disk
 * path rather than the Homebrew/npm-global symlink in PATH, because the
 * symlink may be overwritten during an npm update while the service is
 * registered.
 */
export function resolveBinPath(): string {
  const arg = process.argv[1];
  if (!arg) throw new Error("process.argv[1] is unset");
  return realpathSync(arg);
}

/*
 * Resolve the daemon entry script path. Mirrors pty-host.ts
 * defaultEntryPath: dist/server/cli/service.js -> ../pty/host-daemon/entry.js.
 * Falls back to the .ts source for dev trees without `pnpm build`.
 * Throws if neither exists -- that means the install would write a unit
 * pointing at a non-existent file, which fails silently at supervisor
 * boot and is hard to diagnose. Fail fast at install time instead.
 */
export function resolveDaemonEntryPath(): string {
  const here = fileURLToPath(import.meta.url);
  const compiled = join(here, "..", "..", "pty", "host-daemon", "entry.js");
  if (existsSync(compiled)) return compiled;
  const tsFallback = `${compiled.slice(0, -3)}.ts`;
  if (existsSync(tsFallback)) return tsFallback;
  throw new Error(
    `parasor service: could not locate the PTY host daemon entry script. ` +
      `Looked at: ${compiled} (compiled), ${tsFallback} (dev fallback). ` +
      `This is a build packaging bug -- run \`pnpm build\` or reinstall the package.`,
  );
}

async function resolveDefaults(): Promise<CliServiceOptions> {
  const platform = process.platform;
  const binPath = resolveBinPath();
  const daemonEntryPath = resolveDaemonEntryPath();
  if (platform === "darwin") {
    const { createDarwinAdapter } = await import("./service-darwin.js");
    return {
      platform,
      adapter: createDarwinAdapter({ binPath, daemonEntryPath }),
    };
  }
  if (platform === "linux") {
    const { createLinuxAdapter } = await import("./service-linux.js");
    return {
      platform,
      adapter: createLinuxAdapter({ binPath, daemonEntryPath }),
    };
  }
  return {
    platform,
    // unreachable: cliService will throw before touching the adapter
    adapter: noopAdapter,
  };
}

const noopAdapter: ServiceAdapter = {
  install: async () => {},
  uninstall: async () => {},
  status: async () => {},
  restart: async (_opts: { all: boolean }) => {},
  logs: async () => {},
};

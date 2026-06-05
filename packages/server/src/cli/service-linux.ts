import { spawnSync } from "node:child_process";
import {
  existsSync as realExistsSync,
  mkdirSync as realMkdirSync,
  readFileSync as realReadFileSync,
  rmSync as realRmSync,
  writeFileSync as realWriteFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveDaemonPaths } from "../pty/host-daemon/paths.js";
import { waitForDaemonSocket } from "../pty/host-daemon/socket-ready.js";
import type { ServiceAdapter } from "./service.js";

export const SERVER_UNIT = "parasor.service";
export const DAEMON_UNIT = "parasor-pty-host.service";

export interface UnitParams {
  description: string;
  node: string;
  bin: string;
  stdoutLog: string;
  stderrLog: string;
  env: Record<string, string>;
  /**
   * After= target. Server unit uses network.target (it binds a TCP
   * listener); daemon unit uses default.target (it only needs the user
   * session to exist -- no network dependency).
   */
  after?: string;
  /**
   * Server unit uses Type=notify (sd_notify ready signal). The daemon
   * does not implement sd_notify; readiness is observable via its unix
   * socket. Use Type=simple for the daemon and skip the watchdog.
   */
  notify?: boolean;
  /**
   * -- daemon escalation requires KillMode=mixed
   * so SIGKILL reaches the process group, not just the parent. Server
   * unit defaults to Restart=on-failure; daemon uses Restart=always
   * because crashes there should always trigger immediate respawn (the
   * release requirementaxis is "continuous availability", continuous availability).
   */
  restartOnAlways?: boolean;
  killModeMixed?: boolean;
  /**
   * Disable systemd's start-rate limiter for the daemon. With Restart=always
   * and a fast crash loop, the default 5-restarts-per-10s threshold causes
   * the unit to enter `failed` and stop respawning -- exactly the wedge state
   * that breaks "continuous availability". Server keeps default limits.
   */
  unlimitedStartRate?: boolean;
  /**
   * Exit codes that must NOT trigger systemd respawn even under Restart=always.
   * The daemon entry exits with code 2 on DaemonAlreadyRunningError (a guard
   * fired when another instance already holds the lockfile). With
   * Restart=always + StartLimitBurst=0 + this guard, systemd would otherwise
   * loop forever spawning a process that immediately self-aborts.
   */
  restartPreventExitStatus?: number[];
}

function escapeSystemdEnvValue(v: string): string {
  /*
   * systemd Environment= values are double-quoted strings. Backslash and
   * double-quote must be escaped; newlines are illegal inside quoted
   * values and must be rejected (not silently stripped -- the unit would
   * fail to load with a confusing "Failed to parse environment line"
   * error). PATH/HOME never contain these in practice, but harden the
   * code path so a stray characters in custom env do not produce a
   * malformed unit file.
   */
  if (v.includes("\n") || v.includes("\r")) {
    throw new Error(
      `service install: environment value contains a newline (rejected by systemd): ${JSON.stringify(v)}`,
    );
  }
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function renderUnit(p: UnitParams): string {
  const envLines = Object.entries(p.env)
    .map(([k, v]) => `Environment="${k}=${escapeSystemdEnvValue(v)}"`)
    .join("\n");
  const after = p.after ?? "network.target";
  const notifyBlock =
    p.notify === false ? "Type=simple" : "Type=notify\nWatchdogSec=30";
  const restart = p.restartOnAlways
    ? "Restart=always\nRestartSec=2"
    : "Restart=on-failure\nRestartSec=3";
  const killMode = p.killModeMixed ? "KillMode=mixed\nTimeoutStopSec=10\n" : "";
  const startLimitBlock = p.unlimitedStartRate
    ? "\nStartLimitIntervalSec=0\nStartLimitBurst=0"
    : "";
  const preventBlock =
    p.restartPreventExitStatus && p.restartPreventExitStatus.length > 0
      ? `RestartPreventExitStatus=${p.restartPreventExitStatus.join(" ")}\n`
      : "";
  return `[Unit]
Description=${p.description}
After=${after}${startLimitBlock}

[Service]
${notifyBlock}
ExecStart=${p.node} ${p.bin}
${restart}
${preventBlock}${killMode}StandardOutput=append:${p.stdoutLog}
StandardError=append:${p.stderrLog}
${envLines}

[Install]
WantedBy=default.target
`;
}

export interface LinuxAdapterDeps {
  binPath: string;
  daemonEntryPath: string;
  home?: string;
  configDir?: string;
  execPath?: string;
  fs?: {
    mkdirSync: (p: string, opts?: { recursive: boolean }) => void;
    writeFileSync: (p: string, content: string) => void;
    readFileSync: (p: string) => string;
    rmSync: (p: string, opts?: { force?: boolean }) => void;
    existsSync: (p: string) => boolean;
  };
  spawn?: (
    cmd: string,
    args: string[],
  ) => { status: number | null; stdout: string; stderr: string };
  log?: (msg: string) => void;
  /**
   *  R1/R2 -- test injection seam for the daemon
   * socket-ready poll. Production leaves this unset (uses the real
   * `waitForDaemonSocket`). Tests inject a mock to drive
   * timeout-error and immediate-ready branches without real sockets.
   */
  waitFn?: (socketPath: string) => Promise<void>;
}

export function createLinuxAdapter(deps: LinuxAdapterDeps): ServiceAdapter {
  const home = deps.home ?? homedir();
  const configDir = deps.configDir ?? join(home, ".config", "parasor");
  const execPath = deps.execPath ?? process.execPath;
  const fs = deps.fs ?? {
    mkdirSync: (p, o) => realMkdirSync(p, { recursive: true, ...o }),
    writeFileSync: realWriteFileSync,
    readFileSync: (p: string) => realReadFileSync(p, "utf8"),
    rmSync: (p, o) => realRmSync(p, { force: true, ...o }),
    existsSync: realExistsSync,
  };
  const spawn =
    deps.spawn ??
    ((cmd: string, args: string[]) => {
      const r = spawnSync(cmd, args, { encoding: "utf8" });
      return {
        status: r.status,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
      };
    });
  const log = deps.log ?? ((m: string) => console.log(m));
  const daemonPaths = resolveDaemonPaths();
  //  R1/R2 -- default to the real poll when no spawn mock is
  // injected (production path). Tests inject both `spawn` and `waitFn`; the
  // `deps.spawn` gate ensures existing tests that supply a mock spawn but omit
  // `waitFn` get a no-op instead of a live 5 s poll against a non-existent socket.
  const waitFn =
    deps.waitFn ??
    (deps.spawn
      ? (_socketPath: string) => Promise.resolve()
      : waitForDaemonSocket);

  const unitDir = join(home, ".config", "systemd", "user");
  const serverUnitPath = join(unitDir, SERVER_UNIT);
  const daemonUnitPath = join(unitDir, DAEMON_UNIT);
  const serverStdoutLog = join(configDir, "service.log");
  const serverStderrLog = join(configDir, "service.err.log");
  const daemonStdoutLog = join(configDir, "pty-host.out.log");
  const daemonStderrLog = join(configDir, "pty-host.err.log");

  function basePathEnv(): string {
    return ["/usr/local/bin", "/usr/bin", "/bin", process.env.PATH ?? ""]
      .filter(Boolean)
      .join(":");
  }

  function buildServerUnitBody(): string {
    /*
     * Service install is the canonical
     * supervisor path, so the server unit is wired for daemon mode by
     * default. PARASOR_PTY_DAEMON=1 makes the server connect to the
     * daemon socket instead of running PTYs in-process;
     * PARASOR_PTY_AUTOSTART=0 stops it from forking a competing daemon
     * because systemd already owns one (parasor-pty-host.service).
     */
    const env: Record<string, string> = {
      HOME: home,
      PATH: basePathEnv(),
      PARASOR_PTY_DAEMON: "1",
      PARASOR_PTY_AUTOSTART: "0",
    };
    return renderUnit({
      description: "parasor terminal multiplexer",
      node: execPath,
      bin: deps.binPath,
      stdoutLog: serverStdoutLog,
      stderrLog: serverStderrLog,
      env,
    });
  }

  function writeServerUnit(): void {
    fs.mkdirSync(unitDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(serverUnitPath, buildServerUnitBody());
  }

  function buildDaemonUnitBody(): string {
    const env: Record<string, string> = {
      HOME: home,
      PATH: basePathEnv(),
    };
    return renderUnit({
      description: "parasor PTY host daemon",
      node: execPath,
      bin: deps.daemonEntryPath,
      stdoutLog: daemonStdoutLog,
      stderrLog: daemonStderrLog,
      env,
      after: "default.target",
      notify: false,
      restartOnAlways: true,
      killModeMixed: true,
      unlimitedStartRate: true,
      restartPreventExitStatus: [2],
    });
  }

  function writeDaemonUnit(): void {
    fs.mkdirSync(unitDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(daemonUnitPath, buildDaemonUnitBody());
  }

  function daemonReload(): void {
    spawn("systemctl", ["--user", "daemon-reload"]);
  }

  function enableNow(unit: string): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    return spawn("systemctl", ["--user", "enable", "--now", unit]);
  }

  function disableNow(unit: string): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    return spawn("systemctl", ["--user", "disable", "--now", unit]);
  }

  function restartUnit(unit: string): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    return spawn("systemctl", ["--user", "restart", unit]);
  }

  function snapshotIfExists(path: string): string | null {
    if (!fs.existsSync(path)) return null;
    try {
      return fs.readFileSync(path);
    } catch {
      // If we cannot snapshot, treat the prior content as unrecoverable.
      // The install path will still proceed; rollback simply degrades to
      // "remove the unit we wrote" instead of "restore prior contents".
      return null;
    }
  }

  function restoreSnapshot(path: string, content: string | null): void {
    if (content === null) {
      fs.rmSync(path, { force: true });
      return;
    }
    fs.writeFileSync(path, content);
  }

  async function install(): Promise<void> {
    /*
     * Order matters: bring the daemon up first so its socket is available
     * when the server starts. If the server starts first, it will try to
     * connect to a non-existent daemon socket and (per host.ts) error out
     * because PARASOR_PTY_AUTOSTART=0 prevents fallback spawning.
     *
     * Idempotent re-install: write the unit file, daemon-reload to pick up
     * the new contents, enable --now (no-op if already enabled), then
     * restart explicitly. systemd does not auto-restart units when their
     * unit file changes -- without the explicit restart, the new env
     * variables would only take effect after a manual restart or reboot.
     *
     * Backup-and-restore: snapshot prior unit contents before overwrite so
     * that a failed reinstall can revert the file (and reload systemd) to
     * the user's last working state instead of leaving a corrupted unit
     * on disk and a dead daemon. Without this, a botched reinstall
     * (typo'd env value, broken binary path) destroys the user's working
     * supervisor with no automatic recovery.
     */
    /*
     * Idempotent re-install: when the rendered unit is byte-identical to
     * what is already on disk, skip daemon-reload + restart. systemd's
     * `restart` would kill the running daemon and re-launch it -- that
     * tears down every PTY child it owns. By skipping when nothing
     * changed, an `npm` style update that re-runs `parasor service
     * install` preserves the long-lived daemon and its sessions.
     * `enable --now` is still called so a previously disabled or dead
     * daemon does come up; it is a no-op when the unit is already
     * enabled and active.
     */
    const priorDaemonUnit = snapshotIfExists(daemonUnitPath);
    const daemonExisted = priorDaemonUnit !== null;
    const newDaemonUnit = buildDaemonUnitBody();
    const daemonUnchanged = daemonExisted && priorDaemonUnit === newDaemonUnit;
    if (!daemonUnchanged) {
      writeDaemonUnit();
      daemonReload();
    }
    const der = enableNow(DAEMON_UNIT);
    if (der.status !== 0) {
      // Roll back to prior contents (or remove if there were none) so the
      // user's previous working daemon is not destroyed by a failed
      // reinstall. daemonReload picks up the restored file.
      if (!daemonUnchanged) {
        restoreSnapshot(daemonUnitPath, priorDaemonUnit);
        daemonReload();
      }
      throw new Error(
        `systemctl enable (pty-host) failed (${der.status}): ${der.stderr || der.stdout}` +
          (daemonExisted ? " (rolled back to prior daemon unit)" : ""),
      );
    }
    if (daemonExisted && !daemonUnchanged) {
      const rr = restartUnit(DAEMON_UNIT);
      if (rr.status !== 0) {
        // Restore prior unit + reload + restart to return to the user's
        // last working state. Best-effort: if even the restart of the
        // restored unit fails, we surface both failures.
        restoreSnapshot(daemonUnitPath, priorDaemonUnit);
        daemonReload();
        const recover = restartUnit(DAEMON_UNIT);
        const recoverNote =
          recover.status === 0
            ? "rolled back to prior daemon unit"
            : `rollback restart also failed (${recover.status}): ${recover.stderr || recover.stdout}`;
        throw new Error(
          `systemctl restart (pty-host) failed (${rr.status}): ${rr.stderr || rr.stdout} (${recoverNote})`,
        );
      }
    }
    if (daemonUnchanged) {
      log(`unchanged: ${daemonUnitPath} (skipped reload)`);
    } else {
      log(`installed: ${daemonUnitPath}`);
    }
    log(`daemon logs: ${daemonStdoutLog}`);

    //  R1 -- wait for the daemon socket to become ready
    // before enabling the server unit. The server requires the daemon socket
    // immediately (PARASOR_PTY_AUTOSTART=0, so no fallback spawn).
    await waitFn(daemonPaths.socketPath);

    const priorServerUnit = snapshotIfExists(serverUnitPath);
    const serverExisted = priorServerUnit !== null;
    const newServerUnit = buildServerUnitBody();
    const serverUnchanged = serverExisted && priorServerUnit === newServerUnit;
    if (!serverUnchanged) {
      writeServerUnit();
      daemonReload();
    }
    const sr = enableNow(SERVER_UNIT);
    if (sr.status !== 0) {
      // Server bootstrap failed -- roll back the server unit to its prior
      // contents (or remove). The daemon stays as it was at function
      // entry: if it pre-existed and we successfully reinstalled, it
      // remains installed; if it was freshly installed in this call, we
      // also roll it back to "not installed" so the user is not left with
      // a half-installed pair they did not have before.
      restoreSnapshot(serverUnitPath, priorServerUnit);
      if (!daemonExisted) {
        disableNow(DAEMON_UNIT);
        fs.rmSync(daemonUnitPath, { force: true });
      } else {
        restoreSnapshot(daemonUnitPath, priorDaemonUnit);
      }
      daemonReload();
      throw new Error(
        `systemctl enable (server) failed (${sr.status}): ${sr.stderr || sr.stdout}. ` +
          (daemonExisted
            ? "Rolled back server unit; daemon left in prior state."
            : "Rolled back daemon unit; nothing remains installed."),
      );
    }
    if (serverExisted && !serverUnchanged) {
      const rr = restartUnit(SERVER_UNIT);
      if (rr.status !== 0) {
        restoreSnapshot(serverUnitPath, priorServerUnit);
        daemonReload();
        const recover = restartUnit(SERVER_UNIT);
        const recoverNote =
          recover.status === 0
            ? "rolled back to prior server unit"
            : `rollback restart also failed (${recover.status}): ${recover.stderr || recover.stdout}`;
        throw new Error(
          `systemctl restart (server) failed (${rr.status}): ${rr.stderr || rr.stdout} (${recoverNote})`,
        );
      }
    }
    if (serverUnchanged) {
      log(`unchanged: ${serverUnitPath} (skipped reload)`);
    } else {
      log(`installed: ${serverUnitPath}`);
    }
    log(`server logs: ${serverStdoutLog}`);
  }

  async function uninstall(): Promise<void> {
    let removed = false;
    const warnings: string[] = [];
    // Remove server first so it cannot reconnect to a daemon we are
    // about to kill (which would surface as a UI "PTY host disconnected"
    // banner during uninstall).
    if (fs.existsSync(serverUnitPath)) {
      const dr = disableNow(SERVER_UNIT);
      if (dr.status !== 0) {
        // Surface the failure but continue: the unit file removal below
        // is the user-visible "uninstall" action. A leftover enabled
        // symlink will be cleaned by daemon-reload + the missing unit.
        const detail = (dr.stderr || dr.stdout).trim();
        warnings.push(
          `systemctl disable (server) returned ${dr.status}${detail ? `: ${detail}` : ""}`,
        );
      }
      fs.rmSync(serverUnitPath, { force: true });
      log(`uninstalled: ${serverUnitPath}`);
      removed = true;
    }
    if (fs.existsSync(daemonUnitPath)) {
      const dr = disableNow(DAEMON_UNIT);
      if (dr.status !== 0) {
        const detail = (dr.stderr || dr.stdout).trim();
        warnings.push(
          `systemctl disable (pty-host) returned ${dr.status}${detail ? `: ${detail}` : ""}`,
        );
      }
      fs.rmSync(daemonUnitPath, { force: true });
      log(`uninstalled: ${daemonUnitPath}`);
      removed = true;
    }
    if (removed) daemonReload();
    else log("not installed; nothing to do");
    for (const w of warnings) log(`warning: ${w}`);
  }

  function reportUnit(label: string, unitPath: string, unit: string): void {
    const installed = fs.existsSync(unitPath);
    if (!installed) {
      log(`${label}: not installed`);
      return;
    }
    const active = spawn("systemctl", ["--user", "is-active", unit]);
    const enabled = spawn("systemctl", ["--user", "is-enabled", unit]);
    log(`${label}: installed`);
    log(`  active: ${active.stdout.trim()}`);
    log(`  enabled: ${enabled.stdout.trim()}`);
    log(`  unit: ${unitPath}`);
  }

  async function status(): Promise<void> {
    reportUnit("pty-host", daemonUnitPath, DAEMON_UNIT);
    log(`daemon logs: ${daemonStdoutLog}`);
    reportUnit("server", serverUnitPath, SERVER_UNIT);
    log(`server logs: ${serverStdoutLog}`);
  }

  async function restart(opts: { all: boolean }): Promise<void> {
    let kicked = false;
    // Daemon kick is opt-in .  says PTY lifetime
    // is decoupled from server lifetime so live sessions survive a
    // server restart. Restarting the daemon terminates every PTY, so
    // it is reserved for `--all` (binary upgrade scenarios where the
    // daemon code itself changed). Order: daemon first when both --
    // if the server kicks before the daemon is back up and
    // PARASOR_PTY_AUTOSTART=0 (it is), the server fails to connect
    // and crash-loops until systemd brings the daemon back.
    if (opts.all && fs.existsSync(daemonUnitPath)) {
      const r = restartUnit(DAEMON_UNIT);
      if (r.status !== 0) {
        throw new Error(
          `systemctl restart (pty-host) failed (${r.status}): ${r.stderr || r.stdout}`,
        );
      }
      log(`restarted: ${DAEMON_UNIT}`);
      kicked = true;
      //  R2 -- wait for the daemon socket to become ready
      // before restarting the server. Without this the server connects before
      // the daemon socket is bound and crash-loops with ECONNREFUSED.
      await waitFn(daemonPaths.socketPath);
    }
    if (fs.existsSync(serverUnitPath)) {
      const r = restartUnit(SERVER_UNIT);
      if (r.status !== 0) {
        throw new Error(
          `systemctl restart (server) failed (${r.status}): ${r.stderr || r.stdout}`,
        );
      }
      log(`restarted: ${SERVER_UNIT}`);
      kicked = true;
    }
    if (!kicked) log("nothing installed; nothing to restart");
  }

  async function logs(opts: { follow: boolean }): Promise<void> {
    const cmd: [string, ...string[]] = opts.follow
      ? ["tail", "-f", serverStdoutLog]
      : ["cat", serverStdoutLog];
    const [command, ...args] = cmd;
    const r = spawn(command, args);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }

  return { install, uninstall, status, restart, logs };
}

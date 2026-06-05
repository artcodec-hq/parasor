import { spawnSync } from "node:child_process";
import {
  existsSync as realExistsSync,
  mkdirSync as realMkdirSync,
  readFileSync as realReadFileSync,
  rmSync as realRmSync,
  writeFileSync as realWriteFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { resolveDaemonPaths } from "../pty/host-daemon/paths.js";
import { waitForDaemonSocket } from "../pty/host-daemon/socket-ready.js";
import type { ServiceAdapter } from "./service.js";

export const SERVER_LABEL = "com.parasor";
export const DAEMON_LABEL = "com.parasor.pty-host";

export interface PlistParams {
  label: string;
  node: string;
  bin: string;
  stdoutLog: string;
  stderrLog: string;
  env: Record<string, string>;
  /**
   * Background = launchd treats the process as user-independent, exempt
   * from the QoS throttling applied to Interactive jobs. The daemon
   * needs this so the OS scheduler does not down-prioritize it under
   * user-interactive load. Server unit stays Interactive (legacy).
   */
  background?: boolean;
}

export function renderPlist(p: PlistParams): string {
  const envXml = Object.entries(p.env)
    .map(
      ([k, v]) =>
        `        <key>${esc(k)}</key>\n        <string>${esc(v)}</string>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${esc(p.label)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${esc(p.node)}</string>
        <string>${esc(p.bin)}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>Crashed</key>
        <true/>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${esc(p.stdoutLog)}</string>
    <key>StandardErrorPath</key>
    <string>${esc(p.stderrLog)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${envXml}
    </dict>
    <key>ProcessType</key>
    <string>${p.background ? "Background" : "Interactive"}</string>
</dict>
</plist>
`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface DarwinAdapterDeps {
  binPath: string;
  daemonEntryPath: string;
  home?: string;
  configDir?: string;
  uid?: number;
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
  /** Override for tests; production probes the canonical daemon pidfile. */
  daemonPidFile?: string;
  /** Override for tests. Production uses process.kill(pid, 0). */
  killProcess?: (pid: number, signal: NodeJS.Signals | 0) => boolean;
  /**
   *  R1/R2 -- test injection seam for the daemon
   * socket-ready poll. Production leaves this unset (uses the real
   * `waitForDaemonSocket`). Tests inject a mock to drive
   * timeout-error and immediate-ready branches without real sockets.
   */
  waitFn?: (socketPath: string) => Promise<void>;
  /**
   * Test injection seam for the SIGTERM/SIGKILL poll loop in the
   * unmanaged-daemon heal path. Production uses real setTimeout;
   * tests inject an immediate resolver so the deadline loop does not
   * stall fake-timer suites.
   */
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Test injection seam for the wall-clock deadline used by the
   * unmanaged-daemon heal poll. Paired with `sleepFn` so tests can
   * advance a virtual clock instead of waiting real seconds.
   */
  nowFn?: () => number;
}

export function createDarwinAdapter(deps: DarwinAdapterDeps): ServiceAdapter {
  const home = deps.home ?? homedir();
  const configDir = deps.configDir ?? join(home, ".config", "parasor");
  const uid = deps.uid ?? userInfo().uid;
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
  const daemonPidFile = deps.daemonPidFile ?? daemonPaths.pidFile;
  const killProcess =
    deps.killProcess ??
    ((pid: number, signal: NodeJS.Signals | 0): boolean => {
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    });
  //  R1/R2 -- default to the real poll when no spawn mock is
  // injected (production path). Tests inject both `spawn` and `waitFn`; the
  // `deps.spawn` gate ensures existing tests that supply a mock spawn but omit
  // `waitFn` get a no-op instead of a live 5 s poll against a non-existent socket.
  const waitFn =
    deps.waitFn ??
    (deps.spawn
      ? (_socketPath: string) => Promise.resolve()
      : waitForDaemonSocket);
  const sleepFn =
    deps.sleepFn ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nowFn = deps.nowFn ?? (() => Date.now());

  const launchAgentDir = join(home, "Library", "LaunchAgents");
  const serverPlistPath = join(launchAgentDir, `${SERVER_LABEL}.plist`);
  const daemonPlistPath = join(launchAgentDir, `${DAEMON_LABEL}.plist`);
  const serverStdoutLog = join(configDir, "service.log");
  const serverStderrLog = join(configDir, "service.err.log");
  const daemonStdoutLog = join(configDir, "pty-host.out.log");
  const daemonStderrLog = join(configDir, "pty-host.err.log");
  const domain = `gui/${uid}`;
  const serverTarget = `${domain}/${SERVER_LABEL}`;
  const daemonTarget = `${domain}/${DAEMON_LABEL}`;

  function basePathEnv(): string {
    return [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
      process.env.PATH ?? "",
    ]
      .filter(Boolean)
      .join(":");
  }

  function buildServerPlistBody(): string {
    /*
     * Service install is the canonical
     * supervisor path, so the server unit is wired for daemon mode by
     * default. PARASOR_PTY_DAEMON=1 makes the server connect to the
     * daemon socket instead of running PTYs in-process;
     * PARASOR_PTY_AUTOSTART=0 stops it from forking a competing daemon
     * because launchd already owns one (com.parasor.pty-host).
     */
    const env: Record<string, string> = {
      PATH: basePathEnv(),
      HOME: home,
      PARASOR_PTY_DAEMON: "1",
      PARASOR_PTY_AUTOSTART: "0",
    };
    return renderPlist({
      label: SERVER_LABEL,
      node: execPath,
      bin: deps.binPath,
      stdoutLog: serverStdoutLog,
      stderrLog: serverStderrLog,
      env,
    });
  }

  function writeServerPlist(): void {
    fs.mkdirSync(launchAgentDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(serverPlistPath, buildServerPlistBody());
  }

  function buildDaemonPlistBody(): string {
    const env: Record<string, string> = {
      PATH: basePathEnv(),
      HOME: home,
    };
    return renderPlist({
      label: DAEMON_LABEL,
      node: execPath,
      bin: deps.daemonEntryPath,
      stdoutLog: daemonStdoutLog,
      stderrLog: daemonStderrLog,
      env,
      background: true,
    });
  }

  function writeDaemonPlist(): void {
    fs.mkdirSync(launchAgentDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(daemonPlistPath, buildDaemonPlistBody());
  }

  function bootout(plistPath: string): void {
    // Not an error if nothing was previously bootstrapped; swallow non-zero.
    spawn("launchctl", ["bootout", domain, plistPath]);
  }

  function bootstrap(plistPath: string): {
    status: number | null;
    stderr: string;
    stdout: string;
  } {
    return spawn("launchctl", ["bootstrap", domain, plistPath]);
  }

  /*
   * -- `launchctl print <target>` is the canonical way
   * to check whether a unit is currently loaded into the user's launchd
   * domain. Exit 0 = loaded. Non-zero (typically 113 / 3 / "Could not
   * find service") = unloaded. We use this to gate the "plist unchanged
   * -> skip bootstrap" path: if the user has manually `launchctl bootout`-ed
   * the unit (or it never loaded for any reason), skipping bootstrap
   * leaves them with no daemon. The byte-equality check alone is not
   * sufficient -- we need both "content matches" AND "unit loaded".
   *
   * Best-effort: an unexpected non-zero from `launchctl print` is treated
   * as "not loaded" so we bootstrap. The conservative side here is to
   * over-load (idempotent: bootout-then-bootstrap if it was loaded), not
   * under-load (leave the user without a daemon).
   */
  function isLoaded(target: string): boolean {
    const r = spawn("launchctl", ["print", target]);
    return r.status === 0;
  }

  function snapshotIfExists(path: string): string | null {
    if (!fs.existsSync(path)) return null;
    try {
      return fs.readFileSync(path);
    } catch {
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

  /**
   * Detects an "unmanaged daemon" -- a live process holding the canonical
   * daemon socket while launchd is not currently running the unit. This is
   * the inconsistency that triggers the server-only-restart guard and the
   * `restart --all` heal path. Independent of whether the plist exists on
   * disk: a user who ran `parasor` manually before installing the service
   * will hit this with no plist at all.
   */
  function findUnmanagedDaemonPid(): number | null {
    const pid = readLiveCanonicalDaemonPid();
    if (pid === null) return null;
    if (isPrintRunning(printUnit(daemonTarget))) return null;
    return pid;
  }

  /**
   * Stops an unmanaged daemon process so launchd can take over the socket.
   * SIGTERM first (5s grace for clean shutdown of PTY children); SIGKILL
   * as escalation. Throws if the process is still alive after SIGKILL --
   * the caller should abort the heal flow rather than racing launchd
   * against a zombie holding the socket.
   */
  async function stopUnmanagedDaemon(pid: number): Promise<void> {
    log(`stopping unmanaged daemon (pid ${pid}) so launchd can take over`);
    const SIGTERM_TIMEOUT_MS = 5000;
    const SIGKILL_TIMEOUT_MS = 2000;
    const POLL_MS = 100;
    killProcess(pid, "SIGTERM");
    const termStart = nowFn();
    while (nowFn() - termStart < SIGTERM_TIMEOUT_MS) {
      if (!killProcess(pid, 0)) return;
      await sleepFn(POLL_MS);
    }
    log(`SIGTERM timed out after ${SIGTERM_TIMEOUT_MS}ms; sending SIGKILL`);
    killProcess(pid, "SIGKILL");
    const killStart = nowFn();
    while (nowFn() - killStart < SIGKILL_TIMEOUT_MS) {
      if (!killProcess(pid, 0)) return;
      await sleepFn(POLL_MS);
    }
    throw new Error(
      `failed to stop unmanaged daemon (pid ${pid}); process still alive after SIGKILL`,
    );
  }

  async function install(): Promise<void> {
    /*
     * Stop any unmanaged daemon currently holding the canonical socket
     * BEFORE writing/bootstrapping the plist. `parasor` started manually
     * before service install spawns its own daemon child; if we skip
     * this step launchd's bootstrap would race the existing socket
     * owner and the launchd-managed daemon would crash-loop on
     * EADDRINUSE while `launchctl bootstrap` still returns status 0
     * (install looks successful but the service is broken).
     *
     * install is the explicit "set up canonical state" operation, so
     * stopping a manually-spawned daemon is in-scope -- sacrificing the
     * unmanaged PTY children is acceptable here in exchange for a
     * guaranteed-consistent state at exit. Users who need to preserve
     * a running session should connect first; install is opt-in.
     */
    const preInstallUnmanagedPid = findUnmanagedDaemonPid();
    if (preInstallUnmanagedPid !== null) {
      log(
        `stopping unmanaged daemon (pid ${preInstallUnmanagedPid}) so launchd can take over`,
      );
      await stopUnmanagedDaemon(preInstallUnmanagedPid);
    }

    /*
     * Order matters: bootstrap the daemon first so its socket is
     * available when the server starts. If we bootstrapped server
     * first, it would try to connect to a non-existent daemon socket
     * and (per host.ts) error out because PARASOR_PTY_AUTOSTART=0
     * prevents fallback spawning.
     *
     * Idempotent re-install: when the rendered plist is byte-identical
     * to what is already on disk, skip bootout/bootstrap entirely. This
     * preserves a long-lived daemon process (and the PTY children it
     * owns) across `parasor service install` invocations -- npm-update
     * style reinstalls do not lose sessions when the unit content has
     * not changed. When the plist *does* change (binary path, env), we
     * still need a bootout/bootstrap cycle because launchd does not
     * pick up plist changes in place.
     *
     * Backup-and-restore: snapshot prior plist contents before the
     * bootout/overwrite so a failed reinstall reverts to (and
     * re-bootstraps) the user's last working state instead of leaving
     * the user with no daemon at all. Without this, a botched reinstall
     * (typo'd env value, broken binary path) destroys the user's
     * working supervisor and forces manual recovery.
     */
    const priorDaemonPlist = snapshotIfExists(daemonPlistPath);
    const daemonExisted = priorDaemonPlist !== null;
    const newDaemonPlist = buildDaemonPlistBody();
    const daemonUnchanged =
      daemonExisted && priorDaemonPlist === newDaemonPlist;
    // byte-equal plist + actually loaded ⇒ safe skip.
    // Plist matches on disk but unit unloaded ⇒ user manually bootouted
    // (or never loaded); we must bootstrap or they end up with no daemon.
    //
    // Exception: when we just stopped an unmanaged daemon above, launchd's
    // unit is likely stuck in KeepAlive backoff (its child was crash-looping
    // on EADDRINUSE while the unmanaged process held the socket). The
    // "skipped reload" path would leave it stuck even though the socket is
    // now free -- kickstart -k forces an immediate restart attempt.
    if (
      daemonUnchanged &&
      isLoaded(daemonTarget) &&
      preInstallUnmanagedPid === null
    ) {
      log(`unchanged: ${daemonPlistPath} (skipped reload)`);
    } else if (daemonUnchanged && isLoaded(daemonTarget)) {
      log(`unchanged: ${daemonPlistPath} (kickstarting after unmanaged stop)`);
      const kr = spawn("launchctl", ["kickstart", "-k", daemonTarget]);
      if (kr.status !== 0) {
        throw new Error(
          `launchctl kickstart (pty-host) failed (${kr.status}): ${kr.stderr || kr.stdout}`,
        );
      }
    } else if (daemonUnchanged) {
      log(`unchanged: ${daemonPlistPath} (loading -- unit was not loaded)`);
      const dr = bootstrap(daemonPlistPath);
      if (dr.status !== 0) {
        throw new Error(
          `launchctl bootstrap (pty-host) failed (${dr.status}): ${dr.stderr || dr.stdout}`,
        );
      }
    } else {
      if (daemonExisted) bootout(daemonPlistPath);
      writeDaemonPlist();
      const dr = bootstrap(daemonPlistPath);
      if (dr.status !== 0) {
        // Restore the prior plist (or remove it if there was none) and
        // re-bootstrap so the user's previous working daemon is brought
        // back up. Best-effort: a failed recovery surfaces both errors.
        restoreSnapshot(daemonPlistPath, priorDaemonPlist);
        let recoverNote = "removed freshly-written plist";
        if (daemonExisted) {
          const recover = bootstrap(daemonPlistPath);
          recoverNote =
            recover.status === 0
              ? "rolled back to prior daemon plist"
              : `rollback bootstrap also failed (${recover.status}): ${recover.stderr || recover.stdout}`;
        }
        throw new Error(
          `launchctl bootstrap (pty-host) failed (${dr.status}): ${dr.stderr || dr.stdout} (${recoverNote})`,
        );
      }
      log(`installed: ${daemonPlistPath}`);
    }
    log(`daemon logs: ${daemonStdoutLog}`);

    //  R1 -- wait for the daemon socket to become ready
    // before starting the server. The server requires the daemon socket
    // immediately (PARASOR_PTY_AUTOSTART=0, so no fallback spawn).
    await waitFn(daemonPaths.socketPath);

    const priorServerPlist = snapshotIfExists(serverPlistPath);
    const serverExisted = priorServerPlist !== null;
    const newServerPlist = buildServerPlistBody();
    const serverUnchanged =
      serverExisted && priorServerPlist === newServerPlist;
    if (serverUnchanged && isLoaded(serverTarget)) {
      log(`unchanged: ${serverPlistPath} (skipped reload)`);
      log(`server logs: ${serverStdoutLog}`);
      return;
    }
    if (serverUnchanged) {
      log(`unchanged: ${serverPlistPath} (loading -- unit was not loaded)`);
      const r = bootstrap(serverPlistPath);
      if (r.status !== 0) {
        throw new Error(
          `launchctl bootstrap (server) failed (${r.status}): ${r.stderr || r.stdout}`,
        );
      }
      log(`server logs: ${serverStdoutLog}`);
      return;
    }
    if (serverExisted) bootout(serverPlistPath);
    writeServerPlist();
    const r = bootstrap(serverPlistPath);
    if (r.status !== 0) {
      // Server bootstrap failed -- restore the server plist (or remove
      // it). Daemon is restored to its prior installed state: if it
      // pre-existed we keep the freshly-bootstrapped one running (it
      // matches the new config and the user already had one), but if
      // it was freshly installed in this call we tear it down so the
      // user is not left with a half-installed pair they did not have
      // before.
      restoreSnapshot(serverPlistPath, priorServerPlist);
      let serverRecover = "removed freshly-written plist";
      if (serverExisted) {
        const recover = bootstrap(serverPlistPath);
        serverRecover =
          recover.status === 0
            ? "rolled back to prior server plist"
            : `rollback bootstrap also failed (${recover.status}): ${recover.stderr || recover.stdout}`;
      }
      let daemonNote = "daemon left in prior installed state";
      if (!daemonExisted) {
        bootout(daemonPlistPath);
        fs.rmSync(daemonPlistPath, { force: true });
        daemonNote = "rolled back daemon unit; nothing remains installed";
      }
      throw new Error(
        `launchctl bootstrap (server) failed (${r.status}): ${r.stderr || r.stdout}. ` +
          `${serverRecover}; ${daemonNote}.`,
      );
    }
    log(`installed: ${serverPlistPath}`);
    log(`server logs: ${serverStdoutLog}`);
  }

  async function uninstall(): Promise<void> {
    let removed = false;
    // Remove server first so it cannot reconnect to a daemon we are
    // about to kill (which would surface as a UI "PTY host disconnected"
    // banner during uninstall).
    if (fs.existsSync(serverPlistPath)) {
      bootout(serverPlistPath);
      fs.rmSync(serverPlistPath, { force: true });
      log(`uninstalled: ${serverPlistPath}`);
      removed = true;
    }
    if (fs.existsSync(daemonPlistPath)) {
      bootout(daemonPlistPath);
      fs.rmSync(daemonPlistPath, { force: true });
      log(`uninstalled: ${daemonPlistPath}`);
      removed = true;
    }
    if (!removed) log("not installed; nothing to do");
  }

  function reportUnit(label: string, plistPath: string, target: string): void {
    const installed = fs.existsSync(plistPath);
    if (!installed) {
      log(`${label}: not installed`);
      return;
    }
    const r = printUnit(target);
    const running = isPrintRunning(r);
    const pidMatch = /pid = (\d+)/.exec(r.stdout);
    log(`${label}: installed`);
    log(`  running: ${running ? "yes" : "no"}`);
    if (pidMatch) log(`  pid: ${pidMatch[1]}`);
    log(`  plist: ${plistPath}`);
  }

  async function status(): Promise<void> {
    reportUnit("pty-host", daemonPlistPath, daemonTarget);
    log(`daemon logs: ${daemonStdoutLog}`);
    reportUnit("server", serverPlistPath, serverTarget);
    log(`server logs: ${serverStdoutLog}`);
  }

  function printUnit(target: string): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    return spawn("launchctl", ["print", target]);
  }

  function isPrintRunning(r: {
    status: number | null;
    stdout: string;
  }): boolean {
    return r.status === 0 && /state = running/.test(r.stdout);
  }

  function readLiveCanonicalDaemonPid(): number | null {
    if (!fs.existsSync(daemonPidFile)) return null;
    let raw: string;
    try {
      raw = fs.readFileSync(daemonPidFile).trim();
    } catch {
      return null;
    }
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return killProcess(pid, 0) ? pid : null;
  }

  function assertDaemonUnitConsistentForServerOnlyRestart(): void {
    if (!fs.existsSync(daemonPlistPath)) return;
    if (isPrintRunning(printUnit(daemonTarget))) return;
    const pid = readLiveCanonicalDaemonPid();
    if (pid === null) return;
    throw new Error(
      `refusing server-only restart: ${DAEMON_LABEL} is installed but not running under launchd, ` +
        `while the canonical daemon socket is owned by pid ${pid}. ` +
        "This usually happens when `parasor` was started manually before installing the service, " +
        "leaving an unmanaged daemon that launchd cannot supervise. " +
        "Restarting only the server can leave launchd racing the existing daemon and may drop active PTYs. " +
        "Run `parasor service restart --all` when you are ready to restart PTY sessions " +
        "(this stops the unmanaged daemon and hands control to launchd), " +
        "or stop the unmanaged daemon manually and reinstall the service.",
    );
  }

  async function restart(opts: { all: boolean }): Promise<void> {
    let kicked = false;
    // Daemon kick is opt-in .  says PTY lifetime
    // is decoupled from server lifetime so live sessions survive a
    // server restart. Kicking the daemon terminates every PTY, so it
    // is reserved for `--all` (binary upgrade scenarios where the
    // daemon code itself changed). Order: daemon first when both --
    // if the server kicks before the daemon is back up and
    // PARASOR_PTY_AUTOSTART=0 (it is), the server fails to connect
    // and crash-loops until launchd brings the daemon back.
    if (!opts.all) {
      assertDaemonUnitConsistentForServerOnlyRestart();
    }
    if (opts.all && fs.existsSync(daemonPlistPath)) {
      /*
       * Heal an unmanaged-daemon inconsistency before kickstart.
       * `launchctl kickstart -k` only signals launchd-managed processes --
       * a daemon that was spawned manually (e.g. `parasor` run before
       * service install) survives kickstart and continues to hold the
       * canonical socket, leaving the launchd-managed replacement unable
       * to bind. The `--all` contract is "PTYs may be sacrificed to
       * restore a consistent state", so stop the unmanaged process here.
       */
      const unmanagedPid = findUnmanagedDaemonPid();
      if (unmanagedPid !== null) {
        await stopUnmanagedDaemon(unmanagedPid);
      }
      /*
       * If launchd has the unit loaded, kickstart works. If it does not
       * (manual `launchctl bootout`, never loaded, or load aborted after
       * a bind failure), kickstart fails -- `bootstrap` is the right verb.
       */
      if (isLoaded(daemonTarget)) {
        const r = spawn("launchctl", ["kickstart", "-k", daemonTarget]);
        if (r.status !== 0) {
          throw new Error(
            `launchctl kickstart (pty-host) failed (${r.status}): ${r.stderr || r.stdout}`,
          );
        }
        log(`restarted: ${daemonTarget}`);
      } else {
        const br = bootstrap(daemonPlistPath);
        if (br.status !== 0) {
          throw new Error(
            `launchctl bootstrap (pty-host) failed (${br.status}): ${br.stderr || br.stdout}`,
          );
        }
        log(`restarted: ${daemonTarget} (bootstrapped -- was not loaded)`);
      }
      kicked = true;
      //  R2 -- wait for the daemon socket to become ready
      // before kicking the server. Without this the server connects before
      // the daemon socket is bound and crash-loops with ECONNREFUSED.
      await waitFn(daemonPaths.socketPath);
    }
    if (fs.existsSync(serverPlistPath)) {
      const r = spawn("launchctl", ["kickstart", "-k", serverTarget]);
      if (r.status !== 0) {
        throw new Error(
          `launchctl kickstart (server) failed (${r.status}): ${r.stderr || r.stdout}`,
        );
      }
      log(`restarted: ${serverTarget}`);
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

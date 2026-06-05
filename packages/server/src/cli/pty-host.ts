/*
 * -- `parasor pty-host` CLI subcommands.
 *
 *   start    Start the daemon (idempotent).
 *   stop     Send SIGTERM to the running daemon, wait for graceful exit.
 *   status   Print pid + socket path + mode (running/down/locked-by-other).
 *   restart  stop + start in sequence (does *not* terminate sessions --
 *            the daemon's  SIGTERM/SIGKILL escalation is governed by
 *            the daemon itself; restart is a one-shot supervisor op).
 *   doctor   Diagnostic dump for support: paths, lockfile state, recorded
 *            pid liveness, mode-marker, last 50 lines of the daemon log,
 *            and the SessionRecord table from AppState.
 *
 * All commands take Partial<PtyHostDeps> for test seams. Production
 * defaults wrap node:fs / node:child_process / node:net.
 */

import { spawn as realSpawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { markerFileFor, readMarker } from "../pty/host-daemon/mode-marker.js";
import {
  type DaemonPaths,
  resolveDaemonPaths,
} from "../pty/host-daemon/paths.js";
import { AppStateStore } from "../state/app-state.js";

interface SpawnDetachedResult {
  pid?: number;
}

interface ProbeResult {
  /**
   * Connect attempt succeeded immediately. `start` polls this -- only
   * a real handshake-able socket should end the spawn loop.
   */
  socketReady: boolean;
  /**
   * connect succeeded OR connect timed out
   * (treated as "live but stalled", matching bootstrap.isSocketActive
   * fail-closed semantics). `probeStatus` uses this so a stalled-but-
   * bound daemon is classified `running`, preventing a double-spawn
   * race against the bootstrap reconcile path.
   */
  socketAlive: boolean;
}

export interface PtyHostDeps {
  paths: DaemonPaths;
  appStateDir: string;
  now: () => number;
  killProcess: (pid: number, signal: NodeJS.Signals | 0) => boolean;
  spawnDetached: (cmd: string, args: string[]) => SpawnDetachedResult;
  probeSocket: (path: string) => Promise<ProbeResult>;
  readPidFile: (path: string) => number | null;
  readLog: (path: string, lines: number) => string;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
  error: (msg: string) => void;
  daemonEntryPath: string;
}

const STOP_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;

function defaultConfigDir(): string {
  const fromEnv = process.env.PARASOR_CONFIG_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".config", "parasor");
}

function defaultKill(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function defaultSpawnDetached(
  cmd: string,
  args: string[],
): SpawnDetachedResult {
  const child = realSpawn(cmd, args, {
    detached: true,
    stdio: "ignore",
  });
  // detached spawn can emit `error` asynchronously
  // (ENOENT for the binary, EACCES on platforms without immediate
  // exec verification). Without a listener, unhandled error events
  // crash the parent. The CLI start path polls the socket afterward --
  // a failed spawn shows up as "did not become ready" rather than as
  // a parent crash.
  child.once("error", () => {
    /* swallow -- caller relies on probe loop to detect non-startup */
  });
  child.unref();
  return { pid: child.pid };
}

function defaultProbeSocket(path: string): Promise<ProbeResult> {
  return import("node:net").then(
    (net) =>
      new Promise<ProbeResult>((resolve) => {
        const s = net.connect(path);
        const finish = (outcome: "ready" | "timeout" | "error"): void => {
          s.removeAllListeners();
          try {
            s.destroy();
          } catch {
            /* ignore */
          }
          resolve({
            socketReady: outcome === "ready",
            // Connect-success and timeout both mean a live process owns
            // the socket; only ECONNREFUSED / ENOENT / etc. prove the
            // daemon is gone. See bootstrap.ts isSocketActive doc.
            socketAlive: outcome === "ready" || outcome === "timeout",
          });
        };
        s.once("connect", () => finish("ready"));
        s.once("error", () => finish("error"));
        s.setTimeout(250, () => finish("timeout"));
      }),
  );
}

function defaultReadPidFile(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function defaultReadLog(path: string, lines: number): string {
  if (!existsSync(path)) return "(no log file)";
  try {
    const content = readFileSync(path, "utf8");
    const all = content.split(/\r?\n/);
    return all.slice(-lines).join("\n");
  } catch (err) {
    return `(log unreadable: ${(err as Error).message})`;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultEntryPath(): string {
  // dist/server/cli/pty-host.js -> ../pty/host-daemon/entry.js
  // src/cli/pty-host.ts also resolves to the same .js after build, so
  // tests that exercise via `tsx` need to override this.
  const here = fileURLToPath(import.meta.url);
  return join(here, "..", "..", "pty", "host-daemon", "entry.js");
}

function resolveDeps(partial?: Partial<PtyHostDeps>): PtyHostDeps {
  const appStateDir = partial?.appStateDir ?? defaultConfigDir();
  return {
    paths: partial?.paths ?? resolveDaemonPaths(),
    appStateDir,
    now: partial?.now ?? Date.now,
    killProcess: partial?.killProcess ?? defaultKill,
    spawnDetached: partial?.spawnDetached ?? defaultSpawnDetached,
    probeSocket: partial?.probeSocket ?? defaultProbeSocket,
    readPidFile: partial?.readPidFile ?? defaultReadPidFile,
    readLog: partial?.readLog ?? defaultReadLog,
    sleep: partial?.sleep ?? defaultSleep,
    log: partial?.log ?? ((m: string) => console.log(m)),
    error: partial?.error ?? ((m: string) => console.error(m)),
    daemonEntryPath: partial?.daemonEntryPath ?? defaultEntryPath(),
  };
}

interface DaemonStatus {
  state: "running" | "down" | "stale-pidfile";
  pid: number | null;
  socketReady: boolean;
}

async function probeStatus(deps: PtyHostDeps): Promise<DaemonStatus> {
  const probe = await deps.probeSocket(deps.paths.socketPath);
  const pid = deps.readPidFile(deps.paths.pidFile);
  /*
   * bootstrap.isSocketActive treats a connect
   * timeout as "alive" (fail-closed) to avoid double-spawn races.
   * The CLI's old behavior (timeout = down) disagreed: a busy daemon
   * mid-handshake could be flagged stale-pidfile and (post HIGH#2
   * with --force) killed. Use socketAlive here so a live but stalled
   * daemon stays classified `running` -- the user can investigate
   * before forcing termination.
   */
  if (probe.socketAlive) {
    return { state: "running", pid, socketReady: probe.socketReady };
  }
  if (pid !== null && deps.killProcess(pid, 0)) {
    return { state: "stale-pidfile", pid, socketReady: false };
  }
  return { state: "down", pid: null, socketReady: false };
}

async function startCmd(deps: PtyHostDeps): Promise<number> {
  const status = await probeStatus(deps);
  if (status.state === "running") {
    deps.log(`parasor-pty-host already running (pid ${status.pid ?? "?"}).`);
    return 0;
  }
  /*
   * symmetry with spawn-daemon.ts. The auto-spawn
   * path falls back to `entry.ts` + `--import tsx` when the compiled
   * `entry.js` is missing (dev/test runs without `pnpm build`). The
   * operator-recovery `parasor pty-host start` CLI must do the same,
   * otherwise users on the dev tree see "entry script not found" and
   * have no way to start the daemon manually.
   */
  const tsFallback = deps.daemonEntryPath.endsWith(".js")
    ? `${deps.daemonEntryPath.slice(0, -3)}.ts`
    : null;
  let nodeArgs: string[];
  if (existsSync(deps.daemonEntryPath)) {
    nodeArgs = [deps.daemonEntryPath];
  } else if (tsFallback && existsSync(tsFallback)) {
    nodeArgs = ["--import", "tsx", tsFallback];
  } else {
    deps.error(
      `daemon entry script not found at ${deps.daemonEntryPath} ` +
        `(also tried ${tsFallback ?? "(no .ts fallback)"}). ` +
        "Rebuild @parasor/server before retrying.",
    );
    return 1;
  }
  let spawned: SpawnDetachedResult;
  try {
    spawned = deps.spawnDetached(process.execPath, nodeArgs);
  } catch (err) {
    deps.error(`spawn failed: ${(err as Error).message}`);
    return 1;
  }
  // Poll until socket accepts connections or timeout.
  const deadline = deps.now() + START_TIMEOUT_MS;
  while (deps.now() < deadline) {
    const probe = await deps.probeSocket(deps.paths.socketPath);
    if (probe.socketReady) {
      const pid = deps.readPidFile(deps.paths.pidFile);
      deps.log(
        `parasor-pty-host started (pid ${pid ?? "?"}, socket ${deps.paths.socketPath}).`,
      );
      return 0;
    }
    await deps.sleep(POLL_INTERVAL_MS);
  }
  /*
   * timeout means our spawned child either crashed
   * during boot or is hung. The child still holds the lockfile and may
   * still finish writing the marker; without an explicit reap the next
   * `start` waits 60s for proper-lockfile's stale window. Send SIGTERM
   * to the child we just spawned so the next attempt has a clean slate.
   * Best-effort: child may already be dead, or pid may be unknown
   * (test stubs don't always populate it).
   */
  if (typeof spawned.pid === "number") {
    deps.killProcess(spawned.pid, "SIGTERM");
  }
  deps.error(
    `daemon did not become ready within ${START_TIMEOUT_MS}ms. ` +
      `Check ${deps.paths.logFile} for errors.`,
  );
  return 1;
}

async function stopCmd(deps: PtyHostDeps, force: boolean): Promise<number> {
  const status = await probeStatus(deps);
  if (status.state === "down") {
    deps.log("parasor-pty-host is not running.");
    return 0;
  }
  /*
   * refuse to SIGTERM a pid we cannot prove is
   * the daemon. The kernel recycles PIDs; user-written or stale
   * pidfiles can name an unrelated process (a long-running editor,
   * sleep, etc.). Without a live socket on the daemon path we have
   * no proof of ownership, so default-stop bails out and points to
   * doctor for diagnosis. `--force` overrides for the rare ops case
   * where the daemon crashed mid-shutdown and pidfile must be cleared.
   */
  if (status.state === "stale-pidfile" && !force) {
    deps.error(
      `parasor-pty-host: socket ${deps.paths.socketPath} is unreachable but ` +
        `pidfile ${deps.paths.pidFile} names a live process (pid ${status.pid ?? "?"}). ` +
        `Refusing to send SIGTERM without ownership proof -- the pid may have been ` +
        `recycled by the kernel. Run \`parasor pty-host doctor\` to inspect, or ` +
        `pass \`--force\` if you have already verified the pid is the daemon.`,
    );
    return 1;
  }
  const pid = status.pid;
  if (pid === null) {
    deps.error(
      `socket reachable but pidfile missing (${deps.paths.pidFile}). ` +
        "Cannot send SIGTERM safely.",
    );
    return 1;
  }
  if (!deps.killProcess(pid, "SIGTERM")) {
    deps.error(`SIGTERM to pid ${pid} failed.`);
    return 1;
  }
  // Poll for exit.
  const deadline = deps.now() + STOP_TIMEOUT_MS;
  while (deps.now() < deadline) {
    if (!deps.killProcess(pid, 0)) {
      deps.log(`parasor-pty-host stopped (pid ${pid}).`);
      return 0;
    }
    await deps.sleep(POLL_INTERVAL_MS);
  }
  deps.error(
    `pid ${pid} did not exit after ${STOP_TIMEOUT_MS}ms. ` +
      "Escalate manually with kill -9.",
  );
  return 1;
}

async function statusCmd(deps: PtyHostDeps): Promise<number> {
  const status = await probeStatus(deps);
  const lines: string[] = [];
  lines.push(`socket: ${deps.paths.socketPath}`);
  lines.push(`pidfile: ${deps.paths.pidFile}`);
  lines.push(`logfile: ${deps.paths.logFile}`);
  lines.push(`state: ${status.state}`);
  if (status.pid !== null) lines.push(`pid: ${status.pid}`);
  lines.push(`socket-ready: ${status.socketReady}`);
  deps.log(lines.join("\n"));
  return status.state === "running" ? 0 : 1;
}

async function restartCmd(deps: PtyHostDeps, force: boolean): Promise<number> {
  // restart honours the same --force semantics as stop: the daemon may
  // be in stale-pidfile state after a crash, and the user is signalling
  // they have verified the pid.
  const stopRc = await stopCmd(deps, force);
  if (stopRc !== 0) {
    deps.error("stop failed; aborting restart.");
    return stopRc;
  }
  // Small drain to give the lockfile time to release. proper-lockfile
  // releases synchronously on graceful exit, but kernel cleanup of the
  // socket inode can lag a few ms.
  await deps.sleep(POLL_INTERVAL_MS);
  return startCmd(deps);
}

async function doctorCmd(deps: PtyHostDeps): Promise<number> {
  const status = await probeStatus(deps);
  const lines: string[] = [];
  lines.push("=== parasor pty-host doctor ===");
  lines.push(`runtimeDir: ${deps.paths.runtimeDir}`);
  lines.push(`socket: ${deps.paths.socketPath}`);
  lines.push(`pidfile: ${deps.paths.pidFile}`);
  lines.push(`lockfile: ${deps.paths.lockFile}`);
  lines.push(`logfile: ${deps.paths.logFile}`);
  lines.push(`appStateDir: ${deps.appStateDir}`);
  lines.push("");
  lines.push(`state: ${status.state}`);
  lines.push(`pid: ${status.pid ?? "(none)"}`);
  lines.push(`socket-ready: ${status.socketReady}`);
  // Mode marker -- tells us whether the AppState belongs to in-process
  // or daemon and surfaces stale markers from a prior crash.
  const markerFile = markerFileFor(deps.appStateDir);
  const marker = readMarker(markerFile);
  if (marker) {
    lines.push(
      `mode-marker: ${marker.mode} (pid=${marker.pid}, startedAt=${marker.startedAt})`,
    );
  } else {
    lines.push("mode-marker: (none)");
  }
  // SessionRecord table -- both daemon and in-process modes write to it
  // when a daemonContext is present, so this is the single best
  // user-facing snapshot of "what PTYs are tracked".
  // ensure store.destroy() runs even when get() or
  // the format loop throws -- without try/finally a failing read would
  // leak the AppStateStore's internal flush timer until process exit.
  let store: AppStateStore | null = null;
  try {
    store = new AppStateStore({ dir: deps.appStateDir, debounceMs: 0 });
    const recs = store.get().sessionRecords;
    lines.push("");
    lines.push(`sessionRecords (${recs.length}):`);
    for (const r of recs) {
      lines.push(
        `  ${r.id} state=${r.state} pid=${r.pid ?? "-"} pgid=${r.pgid ?? "-"} ` +
          `daemonPid=${r.daemonPid} startedAt=${r.startedAt}`,
      );
    }
  } catch (err) {
    lines.push(`sessionRecords: (load failed: ${(err as Error).message})`);
  } finally {
    store?.destroy();
  }
  // Tail of the log file.
  lines.push("");
  lines.push("=== last 50 log lines ===");
  lines.push(deps.readLog(deps.paths.logFile, 50));
  deps.log(lines.join("\n"));
  return 0;
}

const HELP = `Usage: parasor pty-host <subcommand> [--force]

Subcommands:
  start     Start the parasor-pty-host daemon (idempotent).
  stop      Send SIGTERM to the running daemon and wait for exit.
            Refuses to kill when the socket is unreachable (pid may be
            recycled). Pass --force to override after running doctor.
  status    Print daemon state, pid, and socket path.
  restart   stop then start. --force is forwarded to stop.
  doctor    Diagnostic dump (paths, lockfile, sessionRecords, log tail).

Environment:
  PARASOR_PTY_SOCK     Override socket path (also relocates pid/lock/log).
  XDG_RUNTIME_DIR      Linux runtime dir; defaults to ~/.parasor/run otherwise.
  PARASOR_CONFIG_DIR   AppState dir (default ~/.config/parasor).`;

export async function cliPtyHost(
  args: string[],
  partial?: Partial<PtyHostDeps>,
): Promise<number> {
  const deps = resolveDeps(partial);
  const sub = args[0];
  // Parse --force at the subcommand argument layer rather than the top
  // level so `parasor pty-host stop --force` reads naturally and the
  // flag never accidentally affects start/status/doctor.
  const force = args.slice(1).includes("--force");
  switch (sub) {
    case "start":
      return startCmd(deps);
    case "stop":
      return stopCmd(deps, force);
    case "status":
      return statusCmd(deps);
    case "restart":
      return restartCmd(deps, force);
    case "doctor":
      return doctorCmd(deps);
    case "help":
    case "--help":
    case "-h":
      deps.log(HELP);
      return 0;
    default:
      deps.error(`unknown subcommand: ${sub ?? "(none)"}\n\n${HELP}`);
      return 1;
  }
}

import { spawnSync as realSpawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

/*
 * Shared shutdown machinery for `parasor restart` and `parasor stop`.
 * Both commands need the same primitives to gracefully terminate a running
 * server: send the IPC `shutdown` request, fall back to SIGTERM via the
 * runtime.json pid, and wait for the lockfile / pidfile to clear.
 *
 * Kept separate from restart.ts so stop.ts does not need to depend on
 * respawn machinery (`spawnDetached`).
 */

export const IPC_TIMEOUT_MS = 2000;
export const PID_POLL_INTERVAL_MS = 250;
export const PID_WAIT_MAX_MS = 5000;
export const LOCK_RELEASE_POLL_INTERVAL_MS = 100;
export const LOCK_RELEASE_MAX_MS = 5000;

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RuntimeJson {
  pid?: number;
}

export interface ShutdownDeps {
  platform: NodeJS.Platform | string;
  configDir: string;
  now: () => number;
  sendIpc: (
    socketPath: string,
    req: unknown,
    timeoutMs: number,
  ) => Promise<unknown>;
  readRuntimeJson: (path: string) => RuntimeJson | null;
  killProcess: (pid: number, signal: NodeJS.Signals | 0) => boolean;
  spawnSync: (cmd: string, args: string[]) => SpawnResult;
  log: (msg: string) => void;
  sleep: (ms: number) => Promise<void>;
  fileExists: (path: string) => boolean;
  isLaunchdManaged: () => boolean;
  isSystemdManaged: () => boolean;
}

export function defaultConfigDir(): string {
  const fromEnv = process.env.PARASOR_CONFIG_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".config", "parasor");
}

export function defaultSendIpc(
  socketPath: string,
  req: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => {
      client.write(`${JSON.stringify(req)}\n`);
    });
    let data = "";
    client.on("data", (chunk) => {
      data += chunk;
    });
    client.on("end", () => {
      try {
        resolve(JSON.parse(data.trim()));
      } catch (err) {
        reject(err);
      }
    });
    client.on("error", (err) => reject(err));
    client.setTimeout(timeoutMs, () => {
      client.destroy(new Error("timeout"));
    });
  });
}

export function defaultReadRuntimeJson(path: string): RuntimeJson | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeJson;
    return parsed;
  } catch {
    return null;
  }
}

export function defaultKillProcess(
  pid: number,
  signal: NodeJS.Signals | 0,
): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true; // process exists; we just lack perms
    return false;
  }
}

export function defaultSpawnSync(cmd: string, args: string[]): SpawnResult {
  const r = realSpawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function defaultIsLaunchdManaged(
  spawnSync: ShutdownDeps["spawnSync"],
): boolean {
  const uid = userInfo().uid;
  const r = spawnSync("launchctl", ["print", `gui/${uid}/com.parasor`]);
  if (r.status !== 0) return false;
  return /state = running/.test(r.stdout);
}

export function defaultIsSystemdManaged(
  spawnSync: ShutdownDeps["spawnSync"],
): boolean {
  const r = spawnSync("systemctl", ["--user", "is-active", "parasor.service"]);
  return r.status === 0;
}

export function resolveShutdownDeps(
  partial?: Partial<ShutdownDeps>,
): ShutdownDeps {
  const spawnSyncFn = partial?.spawnSync ?? defaultSpawnSync;
  return {
    platform: partial?.platform ?? process.platform,
    configDir: partial?.configDir ?? defaultConfigDir(),
    now: partial?.now ?? Date.now,
    sendIpc: partial?.sendIpc ?? defaultSendIpc,
    readRuntimeJson: partial?.readRuntimeJson ?? defaultReadRuntimeJson,
    killProcess: partial?.killProcess ?? defaultKillProcess,
    spawnSync: spawnSyncFn,
    log: partial?.log ?? ((m) => console.log(m)),
    sleep: partial?.sleep ?? defaultSleep,
    fileExists: partial?.fileExists ?? ((p) => existsSync(p)),
    isLaunchdManaged:
      partial?.isLaunchdManaged ?? (() => defaultIsLaunchdManaged(spawnSyncFn)),
    isSystemdManaged:
      partial?.isSystemdManaged ?? (() => defaultIsSystemdManaged(spawnSyncFn)),
  };
}

export async function attemptGracefulShutdown(
  socketPath: string,
  deps: Pick<ShutdownDeps, "sendIpc">,
): Promise<boolean> {
  try {
    const res = await deps.sendIpc(
      socketPath,
      { cmd: "shutdown", args: {} },
      IPC_TIMEOUT_MS,
    );
    // Mixed-version guard: an older server without the `shutdown` handler
    // replies `{ok:false, error:"unknown-command"}`. Require ok===true so the
    // caller falls back to SIGTERM instead of returning early from a no-op ack.
    if (
      !res ||
      typeof res !== "object" ||
      (res as { ok?: unknown }).ok !== true
    ) {
      return false;
    }
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED" || code === "ENOENT") return false;
    if ((err as Error).message === "timeout") return false;
    return false;
  }
}

export async function waitForPidExit(
  pid: number,
  deps: Pick<ShutdownDeps, "now" | "killProcess" | "sleep">,
): Promise<boolean> {
  const start = deps.now();
  while (deps.now() - start < PID_WAIT_MAX_MS) {
    if (!deps.killProcess(pid, 0)) return true;
    await deps.sleep(PID_POLL_INTERVAL_MS);
  }
  return !deps.killProcess(pid, 0);
}

export async function waitForLockRelease(
  configDir: string,
  deps: Pick<ShutdownDeps, "now" | "fileExists" | "sleep">,
): Promise<boolean> {
  const socketPath = join(configDir, "parasor.sock");
  const lockPath = join(configDir, "parasor.lock.lock");
  const start = deps.now();
  while (deps.now() - start < LOCK_RELEASE_MAX_MS) {
    if (!deps.fileExists(socketPath) && !deps.fileExists(lockPath)) return true;
    await deps.sleep(LOCK_RELEASE_POLL_INTERVAL_MS);
  }
  return !deps.fileExists(socketPath) && !deps.fileExists(lockPath);
}

export function isServiceManagerActive(
  deps: Pick<
    ShutdownDeps,
    "platform" | "isLaunchdManaged" | "isSystemdManaged"
  >,
): boolean {
  if (deps.platform === "darwin") return deps.isLaunchdManaged();
  if (deps.platform === "linux") return deps.isSystemdManaged();
  return false;
}

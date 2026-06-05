/*
 * -- best-effort daemon auto-spawn for the
 * `createPtyHost("remote")` factory path. When the server is configured
 * for daemon mode but `connect(socketPath)` fails with ECONNREFUSED /
 * ENOENT, we fork a detached `parasor-pty-host` child, wait for the
 * socket to become connectable (capped at ~5s), then let the caller
 * retry the original connect().
 *
 * Auto-spawn is *opt-out* via `PARASOR_PTY_AUTOSTART=0` for ops who
 * prefer a dedicated supervisor (launchd / systemd). The exit
 * code from the daemon entry script is *not* awaited -- once the socket
 * accepts connections, the supervisor relationship is over (detached +
 * unref + stdio:"ignore"). If the daemon prints diagnostics they go to
 * its own log file via the entry script.
 *
 * Why not retry inside the connect() loop? Because startup should attempt
 * auto-spawn at most once per process boot. If the spawn fails (binary
 * missing, permission denied), we surface the error rather than thrashing
 * the lockfile.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DaemonPaths } from "./paths.js";

export interface SpawnDaemonOptions {
  paths: DaemonPaths;
  /**
   * Cap how long we wait for the daemon to start accepting connections.
   * Tests may shrink this; production keeps the configured 5s ceiling.
   */
  startupTimeoutMs?: number;
  /**
   * Override how the entry script is located. Defaults to the bundled
   * dist path resolved from this module's URL -- covers both `tsc` build
   * output and `tsx` dev runtime.
   */
  entryScriptPath?: string;
  /**
   * Test seam -- replaces `child_process.spawn`. Production passes the
   * real spawn so the daemon goes detached; tests pass a stub that
   * simulates the side-effects without forking.
   */
  spawnFn?: typeof spawn;
  /** Test seam for the connect probe. Defaults to net.connect. */
  probeFn?: (path: string) => Promise<boolean>;
  /** Test seam for the polling sleep. Defaults to setTimeout. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Inherit env so the child sees PARASOR_PTY_SOCK / DEBUG flags. */
  env?: NodeJS.ProcessEnv;
}

export class DaemonSpawnError extends Error {
  constructor(
    message: string,
    readonly cause?: Error,
  ) {
    super(message);
    this.name = "DaemonSpawnError";
  }
}

/**
 * Attempt to start the `parasor-pty-host` daemon and wait until its
 * socket is ready. Throws `DaemonSpawnError` on:
 *   - entry script missing (clearer than node's "ENOENT" exec error)
 *   - spawn() throws synchronously (permissions, exec format)
 *   - timeout waiting for socket (caller should treat as fatal:
 *     daemon may have crashed during boot, see paths.logFile)
 *
 * The returned Promise resolves once the socket *passes* a connect
 * probe. Caller is expected to retry its own connect() afterwards.
 */
export async function spawnDaemon(opts: SpawnDaemonOptions): Promise<void> {
  const timeoutMs = opts.startupTimeoutMs ?? 5_000;
  const entry = opts.entryScriptPath ?? defaultEntryScriptPath();
  const spawnFn = opts.spawnFn ?? spawn;
  const probe = opts.probeFn ?? probeSocket;
  const sleep =
    opts.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  /*
   * production runs after `pnpm build`, but the
   * dev/test path (`tsx --watch`) never produces `entry.js`. Resolve
   * to `entry.ts` and prepend `--import tsx` to the node args so the
   * tsx loader handles the TypeScript transparently. We pick the
   * fallback only when `entry.js` is genuinely missing -- this keeps
   * production unchanged.
   */
  const tsFallback = entry.endsWith(".js") ? `${entry.slice(0, -3)}.ts` : null;
  let resolvedEntry = entry;
  let nodeArgs: string[];
  if (existsSync(entry)) {
    nodeArgs = [entry];
  } else if (tsFallback && existsSync(tsFallback)) {
    resolvedEntry = tsFallback;
    nodeArgs = ["--import", "tsx", tsFallback];
  } else {
    throw new DaemonSpawnError(
      `parasor-pty-host entry script not found at ${entry} ` +
        `(also tried ${tsFallback ?? "(no .ts fallback)"}). ` +
        "Run `pnpm --filter @parasor/server build` to produce dist/, " +
        "set PARASOR_PTY_AUTOSTART=0 and start the daemon manually, " +
        "or rebuild @parasor/server.",
    );
  }

  let child: ReturnType<typeof spawn> | null = null;
  try {
    child = spawnFn(process.execPath, nodeArgs, {
      detached: true,
      stdio: "ignore",
      env: opts.env ?? process.env,
    });
    // detached spawn() can emit `error` asynchronously
    // for ENOENT / EACCES / exec format. Without a listener it becomes
    // an unhandled error event in the parent. We swallow here because
    // the probe loop below is the authoritative readiness signal -- a
    // dead child surfaces as a startup-timeout error instead of a
    // parent crash.
    child.once("error", () => {
      /* swallow -- startup-timeout path reports the failure */
    });
    child.unref();
  } catch (err) {
    throw new DaemonSpawnError(
      `failed to spawn parasor-pty-host (entry=${resolvedEntry}): ${(err as Error).message}`,
      err as Error,
    );
  }

  const deadline = Date.now() + timeoutMs;
  const pollMs = 100;
  while (Date.now() < deadline) {
    if (await probe(opts.paths.socketPath)) return;
    await sleep(pollMs);
  }
  // timeout means our spawned child either never
  // bound the socket or is hung mid-startup. Sending SIGTERM to the
  // child's pid (only one we have -- pgid is unknown to the parent)
  // prevents an orphan daemon process from sitting around eating fds.
  // Best-effort: child may have exited normally just before we hit
  // the deadline (race), or may not yet have setsid'd; either way the
  // signal is harmless.
  if (child && typeof child.pid === "number") {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  throw new DaemonSpawnError(
    `parasor-pty-host did not become ready within ${timeoutMs}ms (socket=${opts.paths.socketPath}). ` +
      `Check ${opts.paths.logFile} for daemon-side errors.`,
  );
}

/**
 * Non-blocking connect probe -- the same shape as
 * `bootstrap.ts#isSocketActive` but with a tighter timeout suitable
 * for tight polling. Returns true on `connect`, false on every error.
 */
function probeSocket(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(path);
    const cleanup = (ok: boolean): void => {
      sock.removeAllListeners();
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    sock.once("connect", () => cleanup(true));
    sock.once("error", () => cleanup(false));
    sock.setTimeout(250, () => cleanup(false));
  });
}

/**
 * Resolve the bundled daemon entry script path. Production points at
 * `dist/pty/host-daemon/entry.js`. The dev/test runtime (`tsx --watch`)
 * skips the build step entirely; spawnDaemon() handles that by falling
 * back to `entry.ts` with a `--import tsx` node-arg prefix when the .js
 * file is missing.  */
function defaultEntryScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "entry.js");
}

/*
 * -- `parasor-pty-host` daemon bootstrap.
 *
 * `bootstrapDaemon` wires the runtime path layer (paths.ts), the
 * single-instance lock layer (lockfile.ts), the IPC accept loop, and the
 * `PtyHostDaemon` core into one start/stop lifecycle. It does *not* parse
 * argv / write logs / fork to background -- those are the entry-point's
 * job (entry.ts) so tests can drive bootstrap without touching the host
 * process state.
 *
 * Design notes:
 *   - `acceptUnix` (default true) listens on `paths.socketPath`. Tests
 *     pass `acceptUnix: false` + `acceptTcpPort: 0` to avoid macOS
 *     sandbox-exec restrictions on Unix-socket bind() (Mach lookup).
 *   - SIGTERM/SIGINT trigger graceful shutdown: dispose daemon (drops
 *     current server, leaves underlying PTYs alone -- that's the daemon-mode
 *     contract), close listening socket, dispose host, drop
 *     lockfile/socket. Idempotent -- repeated signals are a no-op.
 *   - Caller-supplied `host` overrides the default in-process host.
 *     Useful for tests that bring their own `PtyHost` mock.
 */

import { existsSync, unlinkSync } from "node:fs";
import * as net from "node:net";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";
import {
  readAndClearDaemonShutdownMarker,
  writeDaemonShutdownMarker,
} from "../../bootstrap/shutdown-marker.js";
import type { AppStateStore } from "../../state/app-state.js";
import type { PtyHost } from "../host.js";
import { InProcessPtyHost } from "../in-process-host.js";
import { PtyHostDaemon } from "./daemon.js";
import {
  acquireDaemonLock,
  DaemonAlreadyRunningError,
  type DaemonLock,
} from "./lockfile.js";
import {
  type AppStateOwner,
  acquireAppStateOwnership,
  markerFileFor,
} from "./mode-marker.js";
import { reconcileSessionRecords } from "./orphan-cleanup.js";
import {
  type DaemonPaths,
  ensureRuntimeDir,
  resolveDaemonPaths,
} from "./paths.js";

function defaultAppStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PARASOR_CONFIG_DIR ?? pathJoin(homedir(), ".config", "parasor");
}

export interface BootstrapOptions {
  paths?: DaemonPaths;
  host?: PtyHost;
  store?: AppStateStore;
  log?: (line: string) => void;
  /** Listen on `paths.socketPath` (default true). Disable for TCP-only tests. */
  acceptUnix?: boolean;
  /** When ≥ 0, also accept on 127.0.0.1:<port>. 0 picks an ephemeral port. */
  acceptTcpPort?: number;
  /** Signals that should trigger graceful shutdown. Default: SIGTERM, SIGINT. */
  signals?: NodeJS.Signals[];
  /** When false, skip lockfile acquisition (tests share a runtime dir). */
  acquireLock?: boolean;
  /** When false, skip the  mode-marker enforcement (in-process tests). */
  enforceModeMarker?: boolean;
  /**
   * AppState directory (where `state.json` lives). The  mode
   * marker is written here so an in-process server that opens the
   * same `state.json` collides on the same marker regardless of
   * daemon-runtime-dir overrides. Defaults to `PARASOR_CONFIG_DIR`
   * or `~/.config/parasor`, matching `AppStateStore`.
   */
  appStateDir?: string;
  /**
   * SIGTERM->5s->SIGKILL escalation test seams. Production
   * defaults to `process.kill` and `setTimeout`-based sleep. Tests pass
   * spies + virtual clock to drive the escalation deterministically
   * without spawning real PTYs (sandbox-blocked).
   */
  killProcess?: (pid: number, signal: NodeJS.Signals | 0) => boolean;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Override the SIGTERM->SIGKILL grace window. Tests use 0 to skip the
   * wall-clock wait intentionally.
   */
  shutdownGraceMs?: number;
  /**
   * Override the in-flight-host-call drain deadline. Defaults to 3000ms
   * in production. Tests pass a small value to drive the timeout branch,
   * where bootstrap must skip the daemon-shutdown marker.
   */
  drainTimeoutMs?: number;
  /**
   * Canonical absolute path of `<rootDir>/uploads`. Plumbed through to
   * `InProcessPtyHost` so the
   * daemon-side `buildSessionEnv` can stamp `PARASOR_UPLOAD_DIR=<dir>/<sid>`
   * onto every spawned PTY. Without this the default-deployment
   * (`PARASOR_PTY_DAEMON !== "0"`, i.e. remote mode) silently bypasses
   * the per-session isolation the in-process path enforces -- a
   * different PTY's `--add-dir` would either point at nothing or inherit a
   * stale shared root via `setPtyEnv` from an older server. Null in tests
   * that don't exercise the upload pipeline.
   */
  uploadsDir?: string | null;
}

export interface RunningDaemon {
  daemon: PtyHostDaemon;
  paths: DaemonPaths;
  /** Bound TCP port if `acceptTcpPort` was provided, else `null`. */
  tcpPort: number | null;
  /** Stop accepting connections, evict the current peer, release lock. */
  shutdown: (reason?: string) => Promise<void>;
}

const DEFAULT_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

export async function bootstrapDaemon(
  opts: BootstrapOptions = {},
): Promise<RunningDaemon> {
  const paths = opts.paths ?? resolveDaemonPaths();
  const log = opts.log ?? (() => {});
  const acceptUnix = opts.acceptUnix ?? true;
  const acquire = opts.acquireLock ?? true;

  ensureRuntimeDir(paths.runtimeDir);

  /*
   * refuse to start if a live in-process server already
   * owns the AppStateStore. The check is done *after* the daemon lock
   * is acquired so two daemons racing on the same runtime dir cannot
   * both write the marker and then have the loser's lock-failure path
   * unlink the winner's marker (reviewed for correctness). Lock acquisition
   * is the actual mutex; marker reads/writes piggy-back its serialisation.
   *
   * The marker file lives in the AppState dir (`paths.appStateDir`),
   * not the daemon runtime dir -- it must collide with whatever path
   * the in-process server uses for state.json, regardless of the
   * daemon's `XDG_RUNTIME_DIR` / `PARASOR_PTY_SOCK` overrides
   * (reviewed for correctness).
   */
  let lock: DaemonLock | null = null;
  if (acquire) {
    lock = await acquireDaemonLock(paths);
  }

  /*
   * Design contract: the marker file lives next to
   * whichever `state.json` *this* store will open. We derive the dir
   * without instantiating the store (creating it triggers
   * `mkdir`/`load` side effects we want sequenced after the conflict
   * check):
   *   1) explicit `opts.appStateDir` (tests / custom layouts)
   *   2) `opts.store.getDir()` if a store was supplied
   *   3) `PARASOR_CONFIG_DIR` env or `~/.config/parasor` (matches
   *      `AppStateStore`'s own default)
   * `acquireAppStateOwnership` holds a proper-lockfile advisory lock
   * on the marker file for the daemon's lifetime -- the same primitive
   * we use for the daemon-runtime lockfile. The lock is the mutex; the
   * marker body is informational diagnostics for `parasor doctor`.
   */
  const enforceMarker = opts.enforceModeMarker ?? true;
  const appStateDir =
    opts.appStateDir ??
    (opts.store && typeof opts.store.getDir === "function"
      ? opts.store.getDir()
      : defaultAppStateDir());
  const markerFile = markerFileFor(appStateDir);
  let appStateOwner: AppStateOwner | null = null;
  if (enforceMarker) {
    try {
      appStateOwner = await acquireAppStateOwnership(markerFile, "daemon");
    } catch (err) {
      if (lock) await lock.release();
      throw err;
    }
  }

  /*
   * Socket probe -- defensive layer over `proper-lockfile`.
   *
   * proper-lockfile is mtime + stale-timeout based, not kernel flock. A
   * live daemon whose event loop is stalled, whose host machine slept, or
   * whose lockfile mtime got skewed by a clock jump can have its lock
   * declared stale even though it is still bound to `paths.socketPath`
   * and still accepting connections. Without this probe two daemons
   * could end up sharing the runtime dir (split-brain).
   *
   * The probe is the *only* signal we trust here: kernel-bound sockets
   * survive sleep, so an alive `connect()` is unambiguous proof that a
   * daemon is listening. Conversely ECONNREFUSED / ENOENT prove the file
   * is a leftover with no listener -- exactly the recycled-PID and
   * crash-restart paths we want to allow.
   */
  if (acceptUnix && existsSync(paths.socketPath)) {
    if (await isSocketActive(paths.socketPath, 200)) {
      if (lock) await lock.release();
      if (appStateOwner) await appStateOwner.release();
      throw new DaemonAlreadyRunningError(-1, paths.pidFile);
    }
    try {
      unlinkSync(paths.socketPath);
    } catch (err) {
      if (lock) await lock.release();
      if (appStateOwner) await appStateOwner.release();
      throw err;
    }
  }

  const ownsHost = opts.host === undefined;
  let store: AppStateStore | undefined = opts.store;
  let host: PtyHost;
  let daemonStartedAt: string | null = null;
  if (opts.host) {
    host = opts.host;
  } else {
    if (!store) {
      // Default store path matches AppStateStore's own default. We pass
      // the default explicitly so tests can override paths.host without
      // also having to plumb a store.
      const { AppStateStore: AppStateStoreCtor } = await import(
        "../../state/app-state.js"
      );
      store = new AppStateStoreCtor({ dir: appStateDir });
    }
    /*
     * -- every SessionRecord written by this
     * daemon carries our (pid, startedAt) tuple. orphan-cleanup uses
     * the tuple at next-boot to distinguish records this generation
     * just created from records inherited from a previous daemon. The
     * timestamp is captured *here* (lock acquired, before any record
     * mutation) so it is a stable identifier for the daemon's lifetime.
     * Reused by reconcileSessionRecords below so both the writer-side
     * stamp and the boot-time orphan check see the exact same string --
     * a sub-ms gap between two `new Date()` calls could otherwise mark
     * this daemon's own freshly-written records as orphans.
     */
    daemonStartedAt = new Date().toISOString();
    host = new InProcessPtyHost(
      store,
      null,
      {
        pid: process.pid,
        startedAt: daemonStartedAt,
      },
      opts.uploadsDir ?? null,
    );
  }

  /*
   * orphan reconciliation runs *before* we accept any IPC
   * connections. Records left behind by a previous daemon generation
   * (different (pid, startedAt) tuple) get marked "orphaned" if their
   * underlying PTY is still alive, "lost" otherwise. The daemon owns
   * the writer side, so we go through `internalMutate` to bypass the
   * read-only mirror guard set by createPtyHost("remote").
   *
   * The reconcile only runs in the default ownsHost path: a caller-
   * supplied `host` (test fixture, mock) brings its own state model
   * and we don't presume access to its sessionRecords array.
   */
  if (ownsHost && store) {
    const before = store.get().sessionRecords;
    const result = reconcileSessionRecords(before, {
      currentDaemonPid: process.pid,
      currentDaemonStartedAt: daemonStartedAt ?? new Date().toISOString(),
    });
    if (
      result.transitions.some((t) => t.type === "orphaned" || t.type === "lost")
    ) {
      store.internalMutate((s) => {
        s.sessionRecords = result.records;
      });
      for (const t of result.transitions) {
        if (t.type === "orphaned") {
          log(
            `orphan-reconcile: session=${t.id} -> orphaned (previous daemon pid=${t.previousDaemonPid})`,
          );
        } else if (t.type === "lost") {
          log(`orphan-reconcile: session=${t.id} -> lost (${t.reason})`);
        }
      }
    }
  }

  /*
   * -- daemon-side session continuity. The daemon
   * persists sessions (state.json) so a kill-and-relaunch cycle preserves
   * the user's tab list. The marker file at `<appStateDir>/daemon-shutdown.marker`
   * lets us distinguish a clean SIGTERM (graceful) from an abrupt SIGKILL/OOM
   * (crash); sessions that already carry an `endReason` (process exited
   * before shutdown, or `shutdownAll` already stamped daemon-graceful)
   * keep theirs untouched. Mirrors the index.ts:220 server-side path.
   */
  if (ownsHost && store) {
    const wasGracefulShutdown = readAndClearDaemonShutdownMarker(appStateDir);
    for (const session of store.get().sessions) {
      (host as InProcessPtyHost).loadPersistedSession(
        session,
        wasGracefulShutdown,
      );
    }
  }

  const daemon = new PtyHostDaemon({ host, store });

  const servers: net.Server[] = [];
  let tcpPort: number | null = null;

  /*
   * Track every accepted socket so shutdown can force-close them. Without
   * this, a peer that connects but never sends HELLO is invisible to
   * `daemon.dispose()` (which only knows about the *current* peer) and
   * keeps `net.Server.close()` waiting forever -- a single idle probe
   * pins SIGTERM and prevents lockfile/socket cleanup. See the shutdown-safety guard
   * "Daemon shutdown can hang forever on idle pre-HELLO sockets".
   */
  const accepted = new Set<net.Socket>();
  const trackSocket = (socket: net.Socket): void => {
    accepted.add(socket);
    socket.once("close", () => accepted.delete(socket));
  };

  const onConnection = (socket: net.Socket): void => {
    trackSocket(socket);
    try {
      daemon.acceptConnection(socket);
    } catch (err) {
      log(`accept error: ${(err as Error).message}`);
      socket.destroy();
    }
  };

  /*
   * listen() can fail (EADDRINUSE on the TCP port,
   * EACCES on the Unix path, ENOSPC, …) AFTER we've taken the lockfile
   * and the AppState owner marker. Without explicit cleanup, a failed
   * boot leaves the lockfile pinning the runtime dir for ~60s
   * (proper-lockfile's stale window) and the marker preventing any
   * server-side reconcile. Wrap the listen path so any reject runs the
   * full release sequence before rethrowing.
   */
  const releaseAcquiredResources = async (): Promise<void> => {
    for (const s of servers) {
      try {
        await new Promise<void>((resolve) => s.close(() => resolve()));
      } catch {
        /* best-effort */
      }
    }
    if (acceptUnix && existsSync(paths.socketPath)) {
      try {
        unlinkSync(paths.socketPath);
      } catch {
        /* file may have been unlinked by failing listen() itself */
      }
    }
    if (appStateOwner) {
      try {
        await appStateOwner.release();
      } catch {
        /* best-effort */
      }
    }
    if (lock) {
      try {
        await lock.release();
      } catch {
        /* best-effort */
      }
    }
  };
  try {
    if (acceptUnix) {
      const unixServer = net.createServer(onConnection);
      await new Promise<void>((resolve, reject) => {
        unixServer.once("error", reject);
        unixServer.listen(paths.socketPath, () => {
          unixServer.removeListener("error", reject);
          resolve();
        });
      });
      servers.push(unixServer);
    }

    if (typeof opts.acceptTcpPort === "number" && opts.acceptTcpPort >= 0) {
      const tcpServer = net.createServer(onConnection);
      await new Promise<void>((resolve, reject) => {
        tcpServer.once("error", reject);
        tcpServer.listen(opts.acceptTcpPort, "127.0.0.1", () => {
          tcpServer.removeListener("error", reject);
          resolve();
        });
      });
      const addr = tcpServer.address();
      if (addr && typeof addr === "object") tcpPort = addr.port;
      servers.push(tcpServer);
    }
  } catch (listenErr) {
    await releaseAcquiredResources();
    throw listenErr;
  }

  let stopped = false;
  const shutdown = async (reason: string = "external"): Promise<void> => {
    if (stopped) return;
    stopped = true;
    log(`shutdown reason=${reason}`);
    daemon.dispose();
    /*
     * Destroy every accepted socket *before* awaiting server.close().
     * Pre-HELLO probes that never became `currentServer` are invisible
     * to daemon.dispose() -- without explicit destroy here, server.close()
     * would block until those sockets close themselves and our shutdown
     * could hang indefinitely (idle probe = no FIN). daemon.dispose()
     * already FIN'd `currentServer`'s socket via evict(), so destroying
     * it again is idempotent.
     */
    for (const sock of accepted) {
      try {
        sock.destroy();
      } catch {
        /* socket already in error state */
      }
    }
    accepted.clear();
    await Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
          }),
      ),
    );
    if (acceptUnix && existsSync(paths.socketPath)) {
      try {
        unlinkSync(paths.socketPath);
      } catch {
        /* best-effort */
      }
    }
    /*
     * -- drain in-flight host-call chains before
     * tearing the host down. By this point `daemon.dispose()` has
     * flagged shutdown and evicted the current peer, and every accepted
     * socket is destroyed, so no new requests can be handled. The
     * remaining in-flight Promises (CREATE/RESTART/DISPOSE/INIT_CLIENT
     * that were already mid-await on the host) still need to settle:
     * their `.then` handlers persist sessions to state.json. Without
     * this drain a CREATE that won the race against SIGTERM would
     * spawn its PTY *after* shutdownAll iterated `this.sessions`,
     * leaving an orphan child the next boot cannot reclaim.
     */
    let drained = true;
    try {
      drained = await daemon.drain(opts.drainTimeoutMs);
      if (!drained) {
        log(
          "daemon drain timeout -- proceeding with shutdownAll, in-flight host calls may leak",
        );
      }
    } catch (err) {
      drained = false;
      log(`daemon drain error: ${(err as Error).message}`);
    }
    /*
     * Daemon graceful shutdown terminates every
     * owned PTY using a deterministic SIGTERM -> 5s grace -> SIGKILL
     * escalation. This is *not* the server-side `detach()` semantic
     * used when the server process shuts down and sessions stay alive inside
     * the daemon. Here we are the daemon process exiting -- once we go the
     * master fds close and PTY children receive SIGHUP at unpredictable
     * timing, so we terminate the process groups ourselves first.
     *
     * Algorithm:
     *   1. Snapshot every (pid, pgid) we have written to AppState.
     *   2. Call host.shutdownAll({type:"daemon-graceful"}) -- this
     *      issues node-pty's default SIGHUP via `proc.kill()` for each
     *      live session AND stamps every session in state.json with
     *      state="ended" + endReason="daemon-graceful" so the next
     *      daemon boot can restore them as terminated tabs (with
     *      scrollback) instead of losing them. Distinct from
     *      `disposeAll()` which destructively removes sessions.
     *   3. Poll `kill(pid, 0)` every 250ms for 5s. Any pid still alive
     *      at the deadline gets `kill(-pgid, "SIGKILL")` -- process-
     *      group kill so foreground children inherit the death.
     *   4. Write the daemon-shutdown marker so the next boot knows the
     *      previous exit was graceful (sessions without an existing
     *      endReason get `daemon-graceful` instead of `daemon-crash`).
     *   5. Best-effort logging only; we never fail shutdown over a
     *      stuck child (the lockfile/socket cleanup must still run).
     */
    if (ownsHost && "shutdownAll" in host) {
      const survivors: { pid: number; pgid: number; id: string }[] = [];
      if (store) {
        for (const r of store.get().sessionRecords) {
          if (r.state === "running" && r.pid !== null && r.pgid !== null) {
            survivors.push({ pid: r.pid, pgid: r.pgid, id: r.id });
          }
        }
      }
      try {
        await (host as InProcessPtyHost).shutdownAll({
          type: "daemon-graceful",
        });
      } catch (err) {
        log(`host shutdownAll error: ${(err as Error).message}`);
      }
      /*
       * -- `shutdownAll` mutates every session's
       * `state` and `endReason` via `store.mutateSessions()`, which schedules a
       * debounced flush (300ms by default). The marker write below is
       * the post-condition users observe after SIGTERM; if `store.destroy()`
       * runs before the timer fires, the cancellation drops every "ended
       * + daemon-graceful" mutation and the next boot reads stale
       * "running" sessions stamped with `daemon-crash` on absent marker --
       * a clean shutdown gets misread as a crash. Force the writes through
       * synchronously here so state.json reflects daemon-graceful before
       * we touch the marker or the store. Track success: on flush failure
       * (ENOSPC/EIO) we MUST skip the marker so the next boot does not
       * see stale "running" rows beside a graceful marker. The conservative
       * side is "treat as crash".
       */
      let stateFlushed = true;
      if (store && typeof store.flush === "function") {
        try {
          await store.flush();
        } catch (err) {
          stateFlushed = false;
          log(`store flush error: ${(err as Error).message}`);
        }
      }
      // Poll-then-SIGKILL escalation. Skip entirely when no survivors.
      if (survivors.length > 0) {
        const graceMs = opts.shutdownGraceMs ?? 5000;
        const pollMs = 250;
        const polls = Math.max(1, Math.ceil(graceMs / pollMs));
        const sleep =
          opts.sleep ??
          ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
        const kill = opts.killProcess ?? defaultKill;
        for (let i = 0; i < polls; i++) {
          if (!survivors.some((s) => kill(s.pid, 0))) break;
          if (i < polls - 1) await sleep(pollMs);
        }
        for (const s of survivors) {
          if (!kill(s.pid, 0)) continue;
          // kill(-pgid, SIGKILL) -- negative pid signals the whole
          // process group, catching foreground children that survive
          // the shell exit (long-running grep, vim, …).
          const ok = kill(-s.pgid, "SIGKILL");
          log(
            `host SIGKILL pid=${s.pid} pgid=${s.pgid} session=${s.id} ${ok ? "ok" : "failed"}`,
          );
        }
      }
      /*
       * Write the marker AFTER PTY teardown completes. The marker is
       * the post-condition of "graceful exit was reached"; if we'd
       * crashed mid-shutdownAll the marker would not be written and
       * the next boot would correctly treat orphan-risk sessions as
       * `daemon-crash`. Skip when:
       *   - state flush failed: in-memory "ended" mutation never reached
       *     state.json, so the next boot would pair `running` rows with a
       *     graceful marker.
       *   - drain timed out: an in-flight
       *     CREATE / INIT_CLIENT can settle *after* shutdownAll snapshotted
       *     `this.sessions`, potentially writing a fresh "running" row that
       *     shutdownAll never saw -- the same orphan race the drain was
       *     supposed to close, just shifted to the timeout window. Treat
       *     as crash so the orphan-cleanup reconciler runs on next boot.
       * Best-effort otherwise -- a write failure is logged but never
       * blocks shutdown (worst case: graceful is misread as crash,
       * conservative side).
       */
      if (!stateFlushed) {
        log("daemon-shutdown marker skipped -- state flush failed");
      } else if (!drained) {
        log("daemon-shutdown marker skipped -- drain timeout");
      } else {
        try {
          writeDaemonShutdownMarker(appStateDir);
        } catch (err) {
          log(`daemon-shutdown marker write error: ${(err as Error).message}`);
        }
      }
    }
    if (ownsHost && store && "destroy" in store) {
      try {
        store.destroy();
      } catch (err) {
        log(`store destroy error: ${(err as Error).message}`);
      }
    }
    if (lock) {
      try {
        await lock.release();
      } catch (err) {
        log(`lock release error: ${(err as Error).message}`);
      }
    }
    if (appStateOwner) {
      try {
        await appStateOwner.release();
      } catch (err) {
        log(`appstate owner release error: ${(err as Error).message}`);
      }
    }
    for (const sig of installedSignals) {
      process.removeListener(sig, signalHandler);
    }
  };

  const signals = opts.signals ?? DEFAULT_SIGNALS;
  const installedSignals: NodeJS.Signals[] = [];
  const signalHandler = (signal: NodeJS.Signals): void => {
    void shutdown(signal);
  };
  for (const sig of signals) {
    process.on(sig, signalHandler);
    installedSignals.push(sig);
  }

  return { daemon, paths, tcpPort, shutdown };
}

/**
 * Default `kill(pid, signal)` for the  SIGTERM->SIGKILL escalation.
 * Returns true when the process exists (or `EPERM` -- process exists,
 * but we lack permission, which is still "alive" for our purposes),
 * false on `ESRCH` / unknown pid. Test seam injects a deterministic
 * spy in place of this so escalation can be driven without a real
 * child process under sandbox.
 */
function defaultKill(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Probes a Unix-domain socket path with a non-blocking connect.
 *
 *   - `connect` event   -> true  (= a daemon is listening and accepted SYN)
 *   - `error` event     -> false (ECONNREFUSED / ENOENT / etc. -- file is
 *                                a stale leftover, kernel decides instantly)
 *   - timeout exceeded  -> true  (treated as "live but stalled", *not*
 *                                "dead". Fail-closed for split-brain
 *                                defense -- see reviewed for correctness 5th pass.)
 *
 * Why timeout = alive: when no listener owns `socketPath` the kernel
 * synchronously returns ECONNREFUSED (file exists, no socket) or ENOENT
 * (file gone), so a probe that takes longer than `timeoutMs` is almost
 * certainly hitting a daemon whose accept loop is blocked (event loop
 * stall, GC pause, kernel listen-backlog full). Treating that as "dead"
 * would unlink the active socket and let a second daemon take over --
 * exactly the split-brain scenario this probe exists to prevent. The
 * priority axis here is stability > startup latency, so we err on the
 * side of "another daemon is alive, refuse to boot".
 *
 * We open the socket and IMMEDIATELY destroy it without sending HELLO --
 * the daemon's connection-tracking layer drops idle pre-HELLO sockets
 * cleanly so this leaves no observable state behind.
 *
 * Exported only for unit testing -- the alive-detection path is also
 * exercised end-to-end by  manual smoke tests (Unix-socket bind is
 * blocked under macOS sandbox-exec so we can't drive a real listener
 * from Vitest).
 */
export async function isSocketActive(
  socketPath: string,
  timeoutMs: number,
  // Test seam -- production callers always use net.connect. Vitest cannot
  // spy on the ESM `node:net` namespace, so we accept the connector here
  // to drive the timeout-as-alive branch from a unit test.
  connectFn: (path: string) => net.Socket = net.connect,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connectFn(socketPath);
    let settled = false;
    const finish = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(alive);
    };
    // Timeout = "live but stalled" -> fail-closed (true). See doc comment.
    const timer = setTimeout(() => finish(true), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

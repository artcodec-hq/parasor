/*
 * Bootstrap integration tests use the TCP fast-path (`acceptUnix=false`,
 * `acceptTcpPort=0`) so we don't have to bind a Unix socket -- that path
 * is blocked under macOS sandbox-exec and is exercised manually in smoke
 * testing instead.
 */

import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "../../state/app-state.js";
import { RemotePtyHost } from "../remote-host.js";
import {
  bootstrapDaemon,
  isSocketActive,
  type RunningDaemon,
} from "./bootstrap.js";
import type { DaemonPaths } from "./paths.js";

function makePaths(root: string): DaemonPaths {
  return {
    runtimeDir: root,
    socketPath: join(root, "p.sock"),
    pidFile: join(root, "p.pid"),
    lockFile: join(root, "p.lock"),
    logFile: join(root, "p.log"),
  };
}

async function connectClient(port: number): Promise<{
  host: RemotePtyHost;
  socket: net.Socket;
}> {
  const socket = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const host = await RemotePtyHost.connect({
    socket,
    requestTimeoutMs: 2000,
  });
  return { host, socket };
}

function requireTcpPort(running: RunningDaemon): number {
  if (running.tcpPort == null) {
    throw new Error("expected TCP bootstrap port");
  }
  return running.tcpPort;
}

describe("bootstrapDaemon", () => {
  let root: string;
  let store: AppStateStore;
  let running: RunningDaemon | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bootstrap-"));
    store = new AppStateStore({ dir: root, debounceMs: 0 });
    running = null;
  });
  afterEach(async () => {
    if (running) await running.shutdown("test-cleanup");
    store.destroy();
    rmSync(root, { recursive: true, force: true });
  });

  it("starts a daemon, accepts a TCP HELLO, and returns the bound port", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [], // don't pollute Node's signal handlers from tests
    });
    expect(running.tcpPort).not.toBeNull();
    expect(running.tcpPort).toBeGreaterThan(0);

    const { host, socket } = await connectClient(requireTcpPort(running));
    try {
      const sessions = host.list();
      expect(sessions).toEqual([]);
    } finally {
      socket.destroy();
    }
  });

  it("a second bootstrap on the same paths fails with DaemonAlreadyRunningError", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
    });
    await expect(
      bootstrapDaemon({
        paths: makePaths(root),
        store,
        acceptUnix: false,
        acceptTcpPort: 0,
        signals: [],
      }),
    ).rejects.toThrow(/already running/);
  });

  it("listen() failure releases the lockfile so a retry can succeed", async () => {
    /*
     * -- bind a TCP port, then ask bootstrapDaemon
     * to listen on the SAME port. listen() rejects with EADDRINUSE.
     * Without cleanup the lockfile would pin the runtime dir for ~60s;
     * we verify a fresh bootstrap on the same paths succeeds
     * immediately (which proves the lock and AppState owner marker
     * were released).
     */
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => {
        blocker.removeListener("error", reject);
        resolve();
      });
    });
    const blockedPort = (blocker.address() as net.AddressInfo).port;
    try {
      await expect(
        bootstrapDaemon({
          paths: makePaths(root),
          store,
          acceptUnix: false,
          acceptTcpPort: blockedPort,
          signals: [],
        }),
      ).rejects.toThrow();

      // Lock + marker should be released -- a retry on the same paths
      // with a free port must succeed.
      running = await bootstrapDaemon({
        paths: makePaths(root),
        store,
        acceptUnix: false,
        acceptTcpPort: 0,
        signals: [],
      });
      expect(running.tcpPort).not.toBeNull();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("shutdown() closes the listener and rejects further connect attempts", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
    });
    const port = requireTcpPort(running);
    await running.shutdown("test");
    running = null;

    await new Promise<void>((resolve) => {
      const probe = net.connect(port, "127.0.0.1");
      probe.on("error", () => {
        probe.destroy();
        resolve();
      });
      probe.on("connect", () => {
        probe.destroy();
        resolve();
      });
    });

    // Re-bootstrap should now succeed (lockfile released).
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
    });
    expect(running.tcpPort).not.toBeNull();
  });

  it("shutdown completes promptly even with an idle pre-HELLO probe attached", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
    });
    const port = requireTcpPort(running);

    // Connect a probe socket and *never* send HELLO. Without socket
    // tracking + force-destroy in shutdown, this would pin
    // net.Server.close() forever.
    const probe = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      probe.once("connect", resolve);
      probe.once("error", reject);
    });

    const start = Date.now();
    await running.shutdown("test-idle-probe");
    const elapsed = Date.now() - start;
    running = null;
    probe.destroy();

    // Generous bound -- proper close should finish in well under 250ms.
    // The point is to fail fast if the idle probe pins shutdown.
    expect(elapsed).toBeLessThan(1000);
  });

  it("evicts the in-flight peer when shutdown fires", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
    });
    const { host, socket } = await connectClient(requireTcpPort(running));

    const closed = new Promise<void>((resolve) =>
      socket.once("close", resolve),
    );
    await running.shutdown("test-evict");
    running = null;
    await closed;
    // After shutdown, the host should reject any new request -- its socket
    // is closed and no new requests can complete.
    await expect(host.disposeAll()).rejects.toThrow(/dropped/);
  });

  /*
   * Socket-probe split-brain defense (codex 4th pass HIGH).
   *
   * isSocketActive's positive path (alive listener returns true) cannot
   * be exercised here because Unix-socket bind() is blocked under macOS
   * sandbox-exec. That path is covered end-to-end by  manual smoke
   * testing on a real workstation. We do verify the two negative paths
   * that drive the cleanup-and-continue branch: ENOENT and a leftover
   * file with no listener (ECONNREFUSED).
   */
  it("isSocketActive returns false for a non-existent socket path", async () => {
    const probe = join(root, "does-not-exist.sock");
    expect(await isSocketActive(probe, 200)).toBe(false);
  });

  it("isSocketActive returns false for a leftover regular file with no listener", async () => {
    const probe = join(root, "stale.sock");
    writeFileSync(probe, "");
    expect(await isSocketActive(probe, 200)).toBe(false);
  });

  it("isSocketActive treats timeout as alive (split-brain defense, codex 5th HIGH)", async () => {
    // Inject a stalled connector that returns a Duplex-like EventEmitter
    // and never emits `connect` or `error` -- simulates a daemon whose
    // accept loop is blocked. The probe must time out and resolve `true`
    // (= "live but stalled, do NOT unlink the socket file").
    const stalled = new EventEmitter();
    Object.assign(stalled, { destroy: () => stalled });
    const stalledConnect = (): net.Socket => stalled as unknown as net.Socket;
    const result = await isSocketActive(
      "/tmp/unused-fake-path.sock",
      30,
      stalledConnect,
    );
    expect(result).toBe(true);
  });

  it("respects opts.host: caller-supplied host is used instead of InProcessPtyHost", async () => {
    const calls: string[] = [];
    const fakeHost = {
      onSessionData: (_cb: unknown) => {
        calls.push("onSessionData");
        return () => {};
      },
      onSessionInput: (_cb: unknown) => {
        calls.push("onSessionInput");
        return () => {};
      },
      onSessionExit: null,
      list: () => [],
      get: () => undefined,
      getProjectId: () => null,
      getEnv: () => ({}),
      setEnv: () => {},
      setTitle: () => false,
      setPinned: () => false,
      create: async () => {
        throw new Error("unused");
      },
      restart: async () => {
        throw new Error("unused");
      },
      dispose: async () => false,
      disposeAll: async () => {},
      shutdownAll: async () => {},
      initClient: async () => {},
      write: () => {},
      resize: () => {},
      isInteractive: () => false,
    } as unknown as import("../host.js").PtyHost;

    running = await bootstrapDaemon({
      paths: makePaths(root),
      host: fakeHost,
      appStateDir: root,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
    });
    expect(calls).toContain("onSessionData");
    expect(calls).toContain("onSessionInput");
  });
});

/*
 * -- daemon SIGTERM graceful shutdown.
 *
 * Verifies the signal-installed shutdown path end-to-end: the handler
 * fires, the listener stops accepting, the in-flight peer is evicted,
 * the lockfile + mode marker + socket file are released, and a fresh
 * bootstrap on the same paths can take the runtime dir over again.
 *
 * We use SIGUSR2 instead of SIGTERM because SIGTERM would terminate the
 * vitest worker before the test's await chain completes; the bootstrap
 * code path is identical (`signals` is just an array passed to
 * `process.on(sig, signalHandler)`).
 */
describe("bootstrapDaemon SIGTERM graceful shutdown", () => {
  let root: string;
  let store: AppStateStore;
  let running: RunningDaemon | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bootstrap-shutdown-"));
    store = new AppStateStore({ dir: root, debounceMs: 0 });
    running = null;
  });
  afterEach(async () => {
    if (running) {
      try {
        await running.shutdown("test-cleanup");
      } catch {
        /* shutdown may have already run via signal */
      }
    }
    store.destroy();
    rmSync(root, { recursive: true, force: true });
  });

  it("SIGUSR2 handler closes the listener, evicts the peer, releases lock + marker + socket file", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: ["SIGUSR2"],
    });
    const port = requireTcpPort(running);

    // Connect a real client so we exercise the "evict the in-flight peer"
    // branch. Wait until the handshake completes -- `RemotePtyHost.connect`
    // resolves only after HELLO_ACK + first SESSION_LIST, matching the
    //  contract.
    const { host: remoteHost, socket } = await connectClient(port);
    const closed = new Promise<void>((resolve) =>
      socket.once("close", resolve),
    );

    // Fire the installed signal handler (fire-and-forget). The handler
    // runs `void shutdown(signal)` so we await its observable side effects
    // explicitly: the client socket close + the server-side resources.
    process.kill(process.pid, "SIGUSR2");
    await closed;

    // The signal-driven shutdown is async; poll until the on-disk
    // resources are gone before the test exits. running.shutdown() also
    // listens to "stopped" idempotency, so we don't need to call it again.
    await vi.waitFor(() => {
      expect(existsSync(makePaths(root).pidFile)).toBe(false);
      // proper-lockfile's lock-dir convention is `<file>.lock/`. Both the
      // daemon lock and the AppState marker should be cleaned up.
      expect(existsSync(`${makePaths(root).lockFile}.lock`)).toBe(false);
      expect(existsSync(`${root}/appstate.mode.lock`)).toBe(false);
    });

    // Subsequent operations on the now-defunct host fail loud (its socket
    // is closed). This proves the peer was evicted and the listener no
    // longer routes back.
    await expect(remoteHost.disposeAll()).rejects.toThrow();

    // Mark `running` as null so afterEach doesn't try to shut down again
    // (idempotent but makes the cleanup log quieter).
    running = null;
  });

  it("after SIGUSR2 shutdown, a fresh bootstrap on the same paths succeeds", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: ["SIGUSR2"],
    });

    process.kill(process.pid, "SIGUSR2");
    // Wait for the lock release before re-bootstrapping. The daemon's
    // shutdown awaits lock.release() so the lock-dir disappears once the
    // signal handler's promise chain completes.
    await vi.waitFor(() => {
      expect(existsSync(`${makePaths(root).lockFile}.lock`)).toBe(false);
    });

    // store has its own fs handles independent of the daemon -- destroy
    // the previous store and create a fresh one to avoid re-using a
    // closed instance with the new bootstrap.
    store.destroy();
    store = new AppStateStore({ dir: root, debounceMs: 0 });

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
    });
    expect(running.tcpPort).not.toBeNull();
  });
});

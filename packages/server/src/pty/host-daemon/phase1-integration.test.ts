/*
 * -- Daemon integration coverage.
 *
 * What this exercises end-to-end through the real daemon over TCP:
 *   1. Daemon boot writes a mode-marker (in tests, we provide a custom
 *      appStateDir so the marker is observable).
 *   2. RemotePtyHost.connect() succeeds and SESSION_LIST returns empty.
 *   3. Daemon's own AppStateStore is the writer -- `store.get()` from a
 *      separately-constructed store reading the same directory shows
 *      the daemon's writes after a debounce flush.
 *   4. After `shutdown()`, the lockfile is released and a fresh
 *      bootstrap on the same paths succeeds (proves cleanup runs).
 *
 * What this does NOT exercise:
 *   - Real PTY spawn (sandbox-blocked under macOS sandbox-exec). The
 *     in-process-host.test.ts (sandbox-disabled) covers PTY spawn.
 *   - parasor-pty-host entry-script subprocess fork. That requires
 *     `child_process.spawn` of node which fails in sandbox-exec; it is
 *     covered in the  manual smoke matrix in deployment.md.
 *
 * The TCP fast-path (`acceptUnix=false, acceptTcpPort=0`) is the same
 * test seam used by bootstrap.test.ts; it bypasses the AF_UNIX bind
 * which sandbox-exec blocks.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppStateStore } from "../../state/app-state.js";
import { RemotePtyHost } from "../remote-host.js";
import { bootstrapDaemon, type RunningDaemon } from "./bootstrap.js";
import { markerFileFor, readMarker } from "./mode-marker.js";
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

async function connect(
  port: number,
): Promise<{ host: RemotePtyHost; socket: net.Socket }> {
  const socket = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", (err) => reject(err));
  });
  const host = await RemotePtyHost.connect({ socket, requestTimeoutMs: 2000 });
  return { host, socket };
}

function requireTcpPort(running: RunningDaemon): number {
  if (running.tcpPort == null) {
    throw new Error("expected TCP bootstrap port");
  }
  return running.tcpPort;
}

describe("Daemon integration (TCP fast-path)", () => {
  let root: string;
  let stateDir: string;
  let store: AppStateStore;
  let running: RunningDaemon | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "phase1-int-"));
    stateDir = mkdtempSync(join(tmpdir(), "phase1-int-state-"));
    store = new AppStateStore({ dir: stateDir, debounceMs: 0 });
    running = null;
  });

  afterEach(async () => {
    if (running) {
      try {
        await running.shutdown("test-cleanup");
      } catch {
        /* ignore */
      }
      running = null;
    }
    store.destroy();
    rmSync(root, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("daemon boot -> mode-marker written -> RemotePtyHost connects -> empty SESSION_LIST", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
      appStateDir: stateDir,
    });
    expect(running.tcpPort).not.toBeNull();

    // Mode marker landed.
    const marker = readMarker(markerFileFor(stateDir));
    expect(marker).not.toBeNull();
    expect(marker?.mode).toBe("daemon");
    expect(marker?.pid).toBe(process.pid);

    // RemotePtyHost connects and sees empty session list.
    const { host, socket } = await connect(requireTcpPort(running));
    try {
      expect(host.list()).toEqual([]);
    } finally {
      socket.destroy();
    }
  });

  it("uses appStateDir for the default daemon AppStateStore", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
      appStateDir: stateDir,
    });

    const { host, socket } = await connect(requireTcpPort(running));
    let sessionId: string;
    try {
      const session = await host.create({
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/",
        title: "appStateDir regression",
      });
      sessionId = session.id;
    } finally {
      socket.destroy();
    }

    await running.shutdown("test");
    running = null;

    const statePath = join(stateDir, "state.json");
    expect(existsSync(statePath)).toBe(true);
    const saved = JSON.parse(readFileSync(statePath, "utf8")) as {
      sessions?: Array<{ id: string }>;
    };
    expect(saved.sessions?.some((session) => session.id === sessionId)).toBe(
      true,
    );
  });

  it("orphan reconcile transitions a stale running record to lost", async () => {
    // Pre-seed BEFORE bootstrap: a record with a different daemonPid
    // and a dead pid. After bootstrap it should be marked "lost".
    store.mutateSessions((s) => {
      s.sessionRecords.push({
        id: "stale",
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/",
        pid: 999_998, // dead
        pgid: 999_998,
        argv: ["bash"],
        startedAt: "2026-04-27T00:00:00.000Z",
        state: "running",
        exitCode: null,
        exitSignal: null,
        daemonPid: 999_999, // not us
        daemonStartedAt: "2026-04-27T00:00:00.000Z",
      });
    });
    await store.flush();

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
      appStateDir: stateDir,
    });

    const recs = store.get().sessionRecords;
    expect(recs).toHaveLength(1);
    expect(recs[0]?.id).toBe("stale");
    expect(recs[0]?.state).toBe("lost");
  });

  it("shutdown releases lockfile and a fresh bootstrap on the same paths succeeds", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      signals: [],
      appStateDir: stateDir,
    });
    await running.shutdown("test");
    running = null;

    // mode-marker should be cleared.
    const marker = readMarker(markerFileFor(stateDir));
    expect(marker).toBeNull();

    // Re-bootstrap on the same paths.
    const store2 = new AppStateStore({ dir: stateDir, debounceMs: 0 });
    try {
      running = await bootstrapDaemon({
        paths: makePaths(root),
        store: store2,
        acceptUnix: false,
        acceptTcpPort: 0,
        signals: [],
        appStateDir: stateDir,
      });
      expect(running.tcpPort).not.toBeNull();
    } finally {
      store2.destroy();
    }
  });
});

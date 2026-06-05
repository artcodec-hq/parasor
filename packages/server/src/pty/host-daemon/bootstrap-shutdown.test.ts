/*
 * - focused tests for the daemon
 * shutdown escalation path and the startup orphan reconciliation.
 *
 * Both flows are normally hidden behind real PTY children which we
 * cannot spawn under macOS sandbox-exec. The bootstrap layer exposes
 * `killProcess` / `sleep` / `shutdownGraceMs` test seams so the
 * SIGTERM -> 5s -> SIGKILL escalation can be driven deterministically
 * with virtual time + a kill spy. Orphan reconciliation is exercised
 * by seeding sessionRecords directly into the AppStateStore before
 * boot and reading them back after.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "../../state/app-state.js";
import { bootstrapDaemon, type RunningDaemon } from "./bootstrap.js";
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

describe("bootstrapDaemon shutdown SIGTERM->SIGKILL escalation", () => {
  let root: string;
  let stateDir: string;
  let store: AppStateStore;
  let running: RunningDaemon | null = null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bootstrap-shutdown-"));
    stateDir = mkdtempSync(join(tmpdir(), "bootstrap-shutdown-state-"));
    store = new AppStateStore({ dir: stateDir, debounceMs: 0 });
  });

  afterEach(async () => {
    if (running) {
      try {
        await running.shutdown("test cleanup");
      } catch {
        /* ignore */
      }
      running = null;
    }
    store.destroy();
    rmSync(root, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("issues SIGKILL to survivor pgids after the grace window", async () => {
    // killSpy: the survivors stay alive (return true) for every probe
    // until SIGKILL arrives -- that proves the escalation actually fires.
    const killCalls: { pid: number; signal: NodeJS.Signals | 0 }[] = [];
    const killSpy = vi.fn(
      (pid: number, signal: NodeJS.Signals | 0): boolean => {
        killCalls.push({ pid, signal });
        // Pretend survivors stay alive forever so escalation must fire.
        return true;
      },
    );
    const sleepSpy = vi.fn((_ms: number) => Promise.resolve());

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      shutdownGraceMs: 100,
      killProcess: killSpy,
      sleep: sleepSpy,
      log: () => {},
      appStateDir: stateDir,
    });

    // Seed records *after* bootstrap so the orphan-reconcile pass
    // (which would otherwise mark them with a stale-daemon tuple) is
    // already done. We're simulating sessions the daemon has spawned
    // during its own lifetime -- the kill spy will see their pids on
    // shutdown.
    store.internalMutate((s) => {
      s.sessionRecords.push(
        {
          id: "s1",
          projectId: "p1",
          command: { type: "shell" },
          cwd: "/",
          pid: 1001,
          pgid: 1001,
          argv: ["bash"],
          startedAt: "2026-04-28T00:00:00.000Z",
          state: "running",
          exitCode: null,
          exitSignal: null,
          daemonPid: process.pid,
          daemonStartedAt: "2026-04-28T00:00:00.000Z",
        },
        {
          id: "s2",
          projectId: "p1",
          command: { type: "shell" },
          cwd: "/",
          pid: 1002,
          pgid: 1002,
          argv: ["bash"],
          startedAt: "2026-04-28T00:00:00.000Z",
          state: "running",
          exitCode: null,
          exitSignal: null,
          daemonPid: process.pid,
          daemonStartedAt: "2026-04-28T00:00:00.000Z",
        },
      );
    });

    await running.shutdown("test");
    running = null;

    // Probe calls (signal=0) should be present, plus SIGKILL for both
    // survivors at the negative pgid.
    const probes = killCalls.filter((c) => c.signal === 0);
    const sigkills = killCalls.filter((c) => c.signal === "SIGKILL");
    expect(probes.length).toBeGreaterThan(0);
    // Each survivor should receive exactly one SIGKILL targeting -pgid.
    const sigkillTargets = sigkills.map((c) => c.pid).sort((a, b) => a - b);
    expect(sigkillTargets).toEqual([-1002, -1001]); // sorted ascending
  });

  it("skips SIGKILL when no survivors remain", async () => {
    // No records -> nothing to escalate. killSpy should never be called.
    const killSpy = vi.fn(() => true);
    const sleepSpy = vi.fn((_ms: number) => Promise.resolve());

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      shutdownGraceMs: 100,
      killProcess: killSpy,
      sleep: sleepSpy,
      log: () => {},
      appStateDir: stateDir,
    });

    await running.shutdown("test");
    running = null;

    expect(killSpy).not.toHaveBeenCalled();
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it("skips escalation when survivors die during the grace window", async () => {
    let probeCount = 0;
    const killSpy = vi.fn(
      (_pid: number, signal: NodeJS.Signals | 0): boolean => {
        if (signal === 0) {
          probeCount++;
          // Pretend the child died after the second probe (clean exit).
          return probeCount < 2;
        }
        return true;
      },
    );
    const sleepSpy = vi.fn((_ms: number) => Promise.resolve());

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      shutdownGraceMs: 100,
      killProcess: killSpy,
      sleep: sleepSpy,
      log: () => {},
      appStateDir: stateDir,
    });

    store.internalMutate((s) => {
      s.sessionRecords.push({
        id: "s1",
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/",
        pid: 1001,
        pgid: 1001,
        argv: ["bash"],
        startedAt: "2026-04-28T00:00:00.000Z",
        state: "running",
        exitCode: null,
        exitSignal: null,
        daemonPid: process.pid,
        daemonStartedAt: "2026-04-28T00:00:00.000Z",
      });
    });

    await running.shutdown("test");
    running = null;

    const sigkills = killSpy.mock.calls.filter((c) => c[1] === "SIGKILL");
    expect(sigkills).toHaveLength(0);
  });
});

describe("bootstrapDaemon orphan reconcile on startup", () => {
  let root: string;
  let stateDir: string;
  let store: AppStateStore;
  let running: RunningDaemon | null = null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bootstrap-reconcile-"));
    stateDir = mkdtempSync(join(tmpdir(), "bootstrap-reconcile-state-"));
    store = new AppStateStore({ dir: stateDir, debounceMs: 0 });
  });

  afterEach(async () => {
    if (running) {
      try {
        await running.shutdown("test cleanup");
      } catch {
        /* ignore */
      }
      running = null;
    }
    store.destroy();
    rmSync(root, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("transitions previous-generation records to lost / orphaned", async () => {
    // Pre-seed: one running record from a *different* daemon generation
    // with a dead pid (state should become "lost"), one with a "live"
    // pid that is the current process (state should become "orphaned"
    // because the daemonPid tuple does not match).
    const STALE_DAEMON_PID = 999_999; // pid we know is dead
    store.mutateSessions((s) => {
      s.sessionRecords.push(
        {
          id: "dead",
          projectId: "p1",
          command: { type: "shell" },
          cwd: "/",
          pid: 999_998, // not alive
          pgid: 999_998,
          argv: ["bash"],
          startedAt: "2026-04-27T00:00:00.000Z",
          state: "running",
          exitCode: null,
          exitSignal: null,
          daemonPid: STALE_DAEMON_PID,
          daemonStartedAt: "2026-04-27T00:00:00.000Z",
        },
        {
          id: "alive-orphan",
          projectId: "p1",
          command: { type: "shell" },
          cwd: "/",
          pid: process.pid, // alive (we're it)
          pgid: process.pid,
          argv: ["bash"],
          startedAt: "2026-04-27T00:00:00.000Z",
          state: "running",
          exitCode: null,
          exitSignal: null,
          daemonPid: STALE_DAEMON_PID, // does NOT match current daemon
          daemonStartedAt: "2026-04-27T00:00:00.000Z",
        },
      );
    });

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      log: () => {},
      appStateDir: stateDir,
    });

    const recs = store.get().sessionRecords;
    const dead = recs.find((r) => r.id === "dead");
    const orphan = recs.find((r) => r.id === "alive-orphan");
    expect(dead?.state).toBe("lost");
    expect(orphan?.state).toBe("orphaned");
  });

  it("writes the daemon-shutdown marker on graceful exit", async () => {
    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      log: () => {},
      appStateDir: stateDir,
    });

    const markerPath = join(stateDir, "daemon-shutdown.marker");
    expect(existsSync(markerPath)).toBe(false);

    await running.shutdown("test");
    running = null;

    expect(existsSync(markerPath)).toBe(true);
  });

  it("clears the daemon-shutdown marker on next bootstrap (graceful path)", async () => {
    // Pre-write a marker as if the previous daemon had exited gracefully.
    const markerPath = join(stateDir, "daemon-shutdown.marker");
    writeFileSync(markerPath, String(Date.now()), "utf8");
    expect(existsSync(markerPath)).toBe(true);

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      log: () => {},
      appStateDir: stateDir,
    });

    // Marker consumed by readAndClearDaemonShutdownMarker on boot.
    expect(existsSync(markerPath)).toBe(false);
  });

  it("loads persisted sessions from store and stamps daemon-graceful when marker present", async () => {
    // Pre-write the marker -> boot should treat the previous shutdown as
    // graceful. Pre-seed a session in store with no endReason so the
    // fallback path runs.
    writeFileSync(
      join(stateDir, "daemon-shutdown.marker"),
      String(Date.now()),
      "utf8",
    );
    store.mutateSessions((s) => {
      s.sessions.push({
        id: "persisted-1",
        projectId: "p1",
        pid: null,
        state: "ended",
        generation: 1,
        title: "persisted",
        command: { type: "shell" },
        cwd: "/",
        shell: "/bin/zsh",
        createdAt: Date.now() - 1000,
      });
    });

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      log: () => {},
      appStateDir: stateDir,
    });

    const session = store.get().sessions.find((s) => s.id === "persisted-1");
    expect(session?.endReason).toEqual({ type: "daemon-graceful" });
  });

  it("flushes pending store mutations to state.json before store.destroy (HIGH 1)", async () => {
    /*
     * -- without flushSync in the shutdown path,
     * `store.destroy()` cancels the debounce timer and pending writes
     * (e.g. shutdownAll's "ended + daemon-graceful" stamp) never reach
     * state.json. We pin the regression by using a long debounceMs so
     * the timer cannot fire on its own; only the explicit flushSync
     * call we added can land the mutation on disk.
     */
    store.destroy();
    const longDebounceDir = mkdtempSync(
      join(tmpdir(), "bootstrap-flush-state-"),
    );
    const flushyStore = new AppStateStore({
      dir: longDebounceDir,
      debounceMs: 60_000,
    });

    running = await bootstrapDaemon({
      paths: makePaths(mkdtempSync(join(tmpdir(), "bootstrap-flush-rt-"))),
      store: flushyStore,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      shutdownGraceMs: 0,
      log: () => {},
      appStateDir: longDebounceDir,
    });

    flushyStore.mutateSessions((s) => {
      s.sessions.push({
        id: "pending-flush",
        projectId: "p1",
        pid: null,
        state: "running",
        generation: 1,
        title: "pending",
        command: { type: "shell" },
        cwd: "/",
        shell: "/bin/zsh",
        createdAt: Date.now(),
      });
    });

    await running.shutdown("flush-test");
    running = null;

    const raw = readFileSync(join(longDebounceDir, "state.json"), "utf8");
    const parsed = JSON.parse(raw) as { sessions: { id: string }[] };
    expect(parsed.sessions.find((s) => s.id === "pending-flush")).toBeDefined();

    rmSync(longDebounceDir, { recursive: true, force: true });
    // Re-create the outer-scope store so afterEach's destroy() is a no-op.
    store = new AppStateStore({ dir: stateDir, debounceMs: 0 });
  });

  it("skips daemon-shutdown marker when drain times out", async () => {
    /*
     * drain timeout MUST also skip the marker.
     * Otherwise an in-flight CREATE / INIT_CLIENT that settles after
     * shutdownAll's session snapshot writes a stray "running" row, then
     * the marker tells the next boot "graceful" and orphan-cleanup
     * never runs. We pin this by injecting a never-settling Promise
     * into the daemon's inFlight set and using `drainTimeoutMs: 50` so
     * shutdown takes the timeout branch deterministically.
     */
    const driveDir = mkdtempSync(join(tmpdir(), "bootstrap-drain-timeout-"));
    const driveStore = new AppStateStore({ dir: driveDir, debounceMs: 0 });
    const localRunning = await bootstrapDaemon({
      paths: makePaths(
        mkdtempSync(join(tmpdir(), "bootstrap-drain-timeout-rt-")),
      ),
      store: driveStore,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      shutdownGraceMs: 0,
      drainTimeoutMs: 50,
      log: () => {},
      appStateDir: driveDir,
    });

    // Inject a never-settling promise so drain() takes the timeout
    // branch. inFlight is private -- same internal-cast escape used by
    // in-process-host-records.test.ts to drive deterministic flows
    // around node-pty (which we cannot spawn under sandbox).
    const stall = new Promise<void>(() => {
      /* never resolves */
    });
    (
      localRunning.daemon as unknown as { inFlight: Set<Promise<unknown>> }
    ).inFlight.add(stall);

    await localRunning.shutdown("drain-timeout-test");

    const markerPath = join(driveDir, "daemon-shutdown.marker");
    expect(existsSync(markerPath)).toBe(false);

    driveStore.destroy();
    rmSync(driveDir, { recursive: true, force: true });
  });

  it("skips daemon-shutdown marker when flushSync throws ()", async () => {
    /*
     * -- if `flushSync` fails (ENOSPC/EIO),
     * state.json is still stale ("running") but the marker would
     * incorrectly stamp the next boot as graceful. We pin the
     * regression by injecting a flushSync that throws and verifying
     * `daemon-shutdown.marker` does NOT land on disk.
     */
    store.destroy();
    const failDir = mkdtempSync(join(tmpdir(), "bootstrap-flush-fail-"));
    const failStore = new AppStateStore({ dir: failDir, debounceMs: 60_000 });
    const originalFlush = failStore.flush.bind(failStore);
    failStore.flush = async (): Promise<void> => {
      throw new Error("simulated ENOSPC");
    };

    running = await bootstrapDaemon({
      paths: makePaths(mkdtempSync(join(tmpdir(), "bootstrap-flush-fail-rt-"))),
      store: failStore,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      shutdownGraceMs: 0,
      log: () => {},
      appStateDir: failDir,
    });

    await running.shutdown("flush-fail-test");
    running = null;

    const markerPath = join(failDir, "daemon-shutdown.marker");
    expect(existsSync(markerPath)).toBe(false);

    // Restore for clean teardown.
    failStore.flush = originalFlush;
    failStore.destroy();
    rmSync(failDir, { recursive: true, force: true });
    store = new AppStateStore({ dir: stateDir, debounceMs: 0 });
  });

  it("loads persisted sessions and stamps daemon-crash when marker absent", async () => {
    store.mutateSessions((s) => {
      s.sessions.push({
        id: "persisted-2",
        projectId: "p1",
        pid: null,
        state: "ended",
        generation: 1,
        title: "persisted",
        command: { type: "shell" },
        cwd: "/",
        shell: "/bin/zsh",
        createdAt: Date.now() - 1000,
      });
    });

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      log: () => {},
      appStateDir: stateDir,
    });

    const session = store.get().sessions.find((s) => s.id === "persisted-2");
    expect(session?.endReason).toEqual({ type: "daemon-crash" });
  });

  it("leaves already-terminal records untouched", async () => {
    store.mutateSessions((s) => {
      s.sessionRecords.push({
        id: "already-exited",
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/",
        pid: null,
        pgid: null,
        argv: ["bash"],
        startedAt: "2026-04-27T00:00:00.000Z",
        state: "exited",
        exitCode: 0,
        exitSignal: null,
        daemonPid: 999_999,
        daemonStartedAt: "2026-04-27T00:00:00.000Z",
      });
    });

    running = await bootstrapDaemon({
      paths: makePaths(root),
      store,
      acceptUnix: false,
      acceptTcpPort: 0,
      acquireLock: false,
      enforceModeMarker: false,
      signals: [],
      log: () => {},
      appStateDir: stateDir,
    });

    const rec = store.get().sessionRecords[0];
    expect(rec.state).toBe("exited");
    expect(rec.exitCode).toBe(0);
  });
});

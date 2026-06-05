import { describe, expect, it, vi } from "vitest";
import type { DaemonPaths } from "./paths.js";
import { terminateDaemon } from "./terminate-daemon.js";

const PATHS: DaemonPaths = {
  runtimeDir: "/run/parasor",
  socketPath: "/run/parasor/parasor-pty.sock",
  pidFile: "/run/parasor/parasor-pty.pid",
  lockFile: "/run/parasor/parasor-pty.lock",
  logFile: "/run/parasor/parasor-pty.log",
};

interface FakeProc {
  alive: boolean;
  receivedSignals: NodeJS.Signals[];
}

function buildDeps(proc: FakeProc | null) {
  let nowMs = 0;
  const unlinked: string[] = [];
  const lockFilesUnlinked: string[] = [];
  const deps = {
    killProcess: vi.fn((_pid: number, signal: NodeJS.Signals | 0) => {
      if (proc === null) return false;
      if (signal === 0) return proc.alive;
      proc.receivedSignals.push(signal);
      return true;
    }),
    readPidFile: vi.fn((path: string) => {
      if (path !== PATHS.pidFile) return null;
      return proc === null ? null : 12345;
    }),
    unlinkSocket: vi.fn((path: string) => {
      unlinked.push(path);
    }),
    unlinkLockFile: vi.fn((path: string) => {
      lockFilesUnlinked.push(path);
    }),
    sleep: vi.fn(async (ms: number) => {
      nowMs += ms;
    }),
    now: vi.fn(() => nowMs),
  };
  return {
    deps,
    unlinked,
    lockFilesUnlinked,
    advance: (ms: number) => (nowMs += ms),
  };
}

describe("terminateDaemon", () => {
  it("returns no-pidfile when pidfile is missing and unlinks socket + lock", async () => {
    const { deps, unlinked, lockFilesUnlinked } = buildDeps(null);
    const result = await terminateDaemon(PATHS, deps);
    expect(result.outcome).toBe("no-pidfile");
    expect(result.pid).toBe(null);
    expect(unlinked).toContain(PATHS.socketPath);
    expect(lockFilesUnlinked).toContain(PATHS.lockFile);
  });

  it("returns already-dead when the recorded pid is gone", async () => {
    const proc: FakeProc = { alive: false, receivedSignals: [] };
    const { deps, unlinked, lockFilesUnlinked } = buildDeps(proc);
    const result = await terminateDaemon(PATHS, deps);
    expect(result.outcome).toBe("already-dead");
    expect(result.pid).toBe(12345);
    expect(unlinked).toContain(PATHS.socketPath);
    expect(lockFilesUnlinked).toContain(PATHS.lockFile);
  });

  it("SIGTERMs a live daemon and returns stopped once the pid clears", async () => {
    const proc: FakeProc = { alive: true, receivedSignals: [] };
    const { deps, unlinked, lockFilesUnlinked } = buildDeps(proc);
    deps.killProcess.mockImplementation((_pid, signal) => {
      if (signal === "SIGTERM") {
        proc.alive = false;
        proc.receivedSignals.push(signal);
        return true;
      }
      if (signal === 0) return proc.alive;
      proc.receivedSignals.push(signal);
      return true;
    });
    const result = await terminateDaemon(PATHS, deps);
    expect(result.outcome).toBe("stopped");
    expect(proc.receivedSignals).toContain("SIGTERM");
    expect(proc.receivedSignals).not.toContain("SIGKILL");
    expect(unlinked).toContain(PATHS.socketPath);
    expect(lockFilesUnlinked).toContain(PATHS.lockFile);
  });

  it("escalates to SIGKILL when SIGTERM does not stop the daemon", async () => {
    const proc: FakeProc = { alive: true, receivedSignals: [] };
    const { deps, unlinked, lockFilesUnlinked } = buildDeps(proc);
    deps.killProcess.mockImplementation((_pid, signal) => {
      if (signal === "SIGTERM") {
        proc.receivedSignals.push(signal);
        return true; // ignored by the fake daemon
      }
      if (signal === "SIGKILL") {
        proc.alive = false;
        proc.receivedSignals.push(signal);
        return true;
      }
      if (signal === 0) return proc.alive;
      return true;
    });
    const result = await terminateDaemon(PATHS, deps);
    expect(result.outcome).toBe("killed-after-timeout");
    expect(proc.receivedSignals).toContain("SIGTERM");
    expect(proc.receivedSignals).toContain("SIGKILL");
    expect(unlinked).toContain(PATHS.socketPath);
    expect(lockFilesUnlinked).toContain(PATHS.lockFile);
  });

  it("returns still-alive but still cleans socket + lock for manual recovery", async () => {
    const proc: FakeProc = { alive: true, receivedSignals: [] };
    const { deps, unlinked, lockFilesUnlinked } = buildDeps(proc);
    deps.killProcess.mockImplementation((_pid, signal) => {
      proc.receivedSignals.push(signal as NodeJS.Signals);
      return true;
    });
    const result = await terminateDaemon(PATHS, deps);
    expect(result.outcome).toBe("still-alive");
    expect(proc.receivedSignals).toContain("SIGKILL");
    expect(unlinked).toContain(PATHS.socketPath);
    expect(lockFilesUnlinked).toContain(PATHS.lockFile);
  });
});

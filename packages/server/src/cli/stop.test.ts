import { describe, expect, it, vi } from "vitest";
import { cliStop, type StopDeps } from "./stop.js";

/*
 * Mirrors the dependency-injection seam used in restart.test.ts so the
 * stop path can be exercised without touching real IPC sockets, child
 * processes, or filesystem state. waitForPidExit / waitForLockRelease
 * loop on deps.now() + deps.sleep() -- both are stubbed so timeouts can
 * be simulated in milliseconds.
 */

interface SendIpcCall {
  socketPath: string;
  req: unknown;
  timeoutMs: number;
}

interface TestContext {
  deps: StopDeps;
  logs: string[];
  sendIpcCalls: SendIpcCall[];
  killCalls: Array<{ pid: number; signal: NodeJS.Signals | 0 }>;
  spawnSyncCalls: Array<{ cmd: string; args: string[] }>;
  stopDaemonCalls: number;
}

interface TestOverrides {
  platform?: NodeJS.Platform | string;
  sendIpc?: StopDeps["sendIpc"];
  readRuntimeJson?: StopDeps["readRuntimeJson"];
  killProcess?: StopDeps["killProcess"];
  spawnSync?: StopDeps["spawnSync"];
  fileExists?: StopDeps["fileExists"];
  isLaunchdManaged?: StopDeps["isLaunchdManaged"];
  isSystemdManaged?: StopDeps["isSystemdManaged"];
  stopDaemon?: StopDeps["stopDaemon"];
  clock?: { nowMs: number };
}

function makeDeps(overrides: TestOverrides = {}): TestContext {
  const logs: string[] = [];
  const sendIpcCalls: SendIpcCall[] = [];
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
  const spawnSyncCalls: Array<{ cmd: string; args: string[] }> = [];
  let stopDaemonCalls = 0;
  const clock = overrides.clock ?? { nowMs: 0 };

  const deps: StopDeps = {
    platform: overrides.platform ?? "darwin",
    configDir: "/tmp/parasor-test",
    now: () => clock.nowMs,
    sendIpc:
      overrides.sendIpc ??
      ((socketPath, req, timeoutMs) => {
        sendIpcCalls.push({ socketPath, req, timeoutMs });
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        return Promise.reject(err);
      }),
    readRuntimeJson: overrides.readRuntimeJson ?? (() => null),
    killProcess:
      overrides.killProcess ??
      ((pid, signal) => {
        killCalls.push({ pid, signal });
        return false;
      }),
    spawnSync:
      overrides.spawnSync ??
      ((cmd, args) => {
        spawnSyncCalls.push({ cmd, args });
        return { status: 1, stdout: "", stderr: "" };
      }),
    log: (msg) => logs.push(msg),
    sleep: async (ms) => {
      clock.nowMs += ms;
    },
    fileExists: overrides.fileExists ?? (() => false),
    isLaunchdManaged: overrides.isLaunchdManaged ?? (() => false),
    isSystemdManaged: overrides.isSystemdManaged ?? (() => false),
    stopDaemon:
      overrides.stopDaemon ??
      (async () => {
        stopDaemonCalls += 1;
        return 0;
      }),
  };

  // Wrap supplied stubs so we still record call counts even when overrides
  // replace the default behavior.
  if (overrides.sendIpc) {
    const original = deps.sendIpc;
    deps.sendIpc = (socketPath, req, timeoutMs) => {
      sendIpcCalls.push({ socketPath, req, timeoutMs });
      return original(socketPath, req, timeoutMs);
    };
  }
  if (overrides.killProcess) {
    const original = deps.killProcess;
    deps.killProcess = (pid, signal) => {
      killCalls.push({ pid, signal });
      return original(pid, signal);
    };
  }
  if (overrides.spawnSync) {
    const original = deps.spawnSync;
    deps.spawnSync = (cmd, args) => {
      spawnSyncCalls.push({ cmd, args });
      return original(cmd, args);
    };
  }
  if (overrides.stopDaemon) {
    const original = deps.stopDaemon;
    deps.stopDaemon = async () => {
      stopDaemonCalls += 1;
      return original();
    };
  }

  return {
    deps,
    logs,
    sendIpcCalls,
    killCalls,
    spawnSyncCalls,
    get stopDaemonCalls() {
      return stopDaemonCalls;
    },
  } as TestContext;
}

describe("cliStop", () => {
  it("invokes launchctl bootout for both labels on darwin when launchd manages parasor", async () => {
    // Service-managed path always falls through to the manual path as an
    // idempotent backstop (a partial
    // success in the service path must not leave the other unit
    // orphaned). The manual path here finds nothing live to stop.
    const ctx = makeDeps({
      platform: "darwin",
      isLaunchdManaged: () => true,
      spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
    });

    await cliStop(ctx.deps);

    const bootouts = ctx.spawnSyncCalls.filter(
      (c) => c.cmd === "launchctl" && c.args[0] === "bootout",
    );
    expect(bootouts).toHaveLength(2);
    expect(bootouts[0]?.args[1]).toMatch(/^gui\/\d+\/com\.parasor$/);
    expect(bootouts[1]?.args[1]).toMatch(/^gui\/\d+\/com\.parasor\.pty-host$/);
    // Backstop runs: manual path attempts IPC (refused -> no live server)
    // and stopDaemon (idempotent for already-stopped daemon).
    expect(ctx.sendIpcCalls).toHaveLength(1);
    expect(ctx.stopDaemonCalls).toBe(1);
  });

  it("invokes systemctl stop for both units on linux when systemd manages parasor", async () => {
    const ctx = makeDeps({
      platform: "linux",
      isSystemdManaged: () => true,
      spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
    });

    await cliStop(ctx.deps);

    const stops = ctx.spawnSyncCalls.filter(
      (c) =>
        c.cmd === "systemctl" && c.args[0] === "--user" && c.args[1] === "stop",
    );
    expect(stops).toHaveLength(2);
    expect(stops[0]?.args[2]).toBe("parasor.service");
    expect(stops[1]?.args[2]).toBe("parasor-pty-host.service");
    expect(ctx.sendIpcCalls).toHaveLength(1);
    expect(ctx.stopDaemonCalls).toBe(1);
  });

  it("partial-success in service-managed path: server bootout succeeds but daemon bootout fails -- manual path still runs as backstop", async () => {
    // Regression guard for process-stop safety: previously
    // the service-managed branch returned early on partial success,
    // leaving the failing-side unit orphaned. The fix removes the early
    // return; this test pins it down by asserting the manual stopDaemon
    // call runs even after the darwin bootout for the daemon failed.
    const callOrder: number[] = [];
    let callIdx = 0;
    const ctx = makeDeps({
      platform: "darwin",
      isLaunchdManaged: () => true,
      spawnSync: (cmd, args) => {
        callIdx += 1;
        if (cmd === "launchctl" && args[0] === "bootout") {
          callOrder.push(callIdx);
          // First bootout (server) succeeds; second (daemon) fails as
          // if the unit is no longer loaded under launchd.
          if (callOrder.length === 1) {
            return { status: 0, stdout: "", stderr: "" };
          }
          return { status: 36, stdout: "", stderr: "not loaded" };
        }
        return { status: 1, stdout: "", stderr: "" };
      },
    });

    await cliStop(ctx.deps);

    // Both bootouts attempted (server + daemon), neither blocking.
    const bootouts = ctx.spawnSyncCalls.filter(
      (c) => c.cmd === "launchctl" && c.args[0] === "bootout",
    );
    expect(bootouts).toHaveLength(2);
    // Manual backstop ran: IPC attempt + stopDaemon called.
    expect(ctx.sendIpcCalls).toHaveLength(1);
    expect(ctx.stopDaemonCalls).toBe(1);
  });

  it("falls through to manual path when service-managed bootout reports nothing acted on", async () => {
    // Both launchctl bootout calls return non-zero (no unit loaded); the
    // manual graceful-IPC path then takes over and shuts down the server.
    const ctx = makeDeps({
      platform: "darwin",
      isLaunchdManaged: () => true,
      spawnSync: () => ({ status: 1, stdout: "", stderr: "not loaded" }),
      sendIpc: vi.fn().mockResolvedValue({ ok: true }),
    });

    await cliStop(ctx.deps);

    expect(ctx.sendIpcCalls).toHaveLength(1);
    expect(ctx.stopDaemonCalls).toBe(1);
  });

  it("graceful IPC shutdown succeeds, lock releases, then daemon is stopped", async () => {
    let poll = 0;
    const ctx = makeDeps({
      sendIpc: vi.fn().mockResolvedValue({ ok: true }),
      fileExists: () => {
        poll += 1;
        return poll <= 1;
      },
    });

    await cliStop(ctx.deps);

    expect(ctx.sendIpcCalls).toHaveLength(1);
    expect(ctx.stopDaemonCalls).toBe(1);
    // No SIGTERM dance -- graceful path took the fast lane.
    expect(ctx.killCalls.filter((c) => c.signal === "SIGTERM")).toHaveLength(0);
  });

  it("throws when graceful shutdown acks but lockfile never releases (and skips daemon stop)", async () => {
    const ctx = makeDeps({
      sendIpc: vi.fn().mockResolvedValue({ ok: true }),
      fileExists: () => true, // lock never clears
    });

    await expect(cliStop(ctx.deps)).rejects.toThrow(
      /did not release its lockfile/,
    );
    // Daemon stop is skipped when server stop hard-errors -- the user
    // should investigate the wedged server before the daemon path runs.
    expect(ctx.stopDaemonCalls).toBe(0);
  });

  it("falls back to SIGTERM via runtime.json pid when IPC is refused, then stops the daemon", async () => {
    let pidAlive = true;
    let sigtermSent = false;
    const ctx = makeDeps({
      sendIpc: vi.fn().mockImplementation(() => {
        const err = new Error("refused") as NodeJS.ErrnoException;
        err.code = "ECONNREFUSED";
        return Promise.reject(err);
      }),
      readRuntimeJson: () => ({ pid: 4242 }),
      killProcess: (_pid, signal) => {
        if (signal === "SIGTERM") {
          sigtermSent = true;
          pidAlive = false;
          return true;
        }
        if (signal === 0) return pidAlive;
        return false;
      },
    });

    await cliStop(ctx.deps);

    expect(sigtermSent).toBe(true);
    expect(ctx.stopDaemonCalls).toBe(1);
    expect(ctx.logs.some((l) => l.includes("SIGTERM"))).toBe(true);
  });

  it("throws actionable error when pid survives SIGTERM for 5s (and skips daemon stop)", async () => {
    const ctx = makeDeps({
      sendIpc: vi.fn().mockImplementation(() => {
        const err = new Error("refused") as NodeJS.ErrnoException;
        err.code = "ECONNREFUSED";
        return Promise.reject(err);
      }),
      readRuntimeJson: () => ({ pid: 4242 }),
      killProcess: (_pid, signal) => {
        if (signal === "SIGTERM") return true;
        if (signal === 0) return true; // always alive
        return true;
      },
    });

    await expect(cliStop(ctx.deps)).rejects.toThrow(
      /did not exit after SIGTERM within 5s/,
    );
    expect(ctx.stopDaemonCalls).toBe(0);
  });

  it("logs and still stops the daemon when no live server is detected", async () => {
    // No IPC, no pid in runtime.json -> server is already gone but the
    // daemon may still be running (e.g. from a crashed `parasor`).
    const ctx = makeDeps({
      readRuntimeJson: () => null,
    });

    await cliStop(ctx.deps);

    expect(ctx.killCalls.filter((c) => c.signal === "SIGTERM")).toHaveLength(0);
    expect(ctx.stopDaemonCalls).toBe(1);
    expect(
      ctx.logs.some((l) => l.includes("no live parasor server detected")),
    ).toBe(true);
  });

  it.each([
    { label: "0 (process group)", pid: 0 },
    { label: "-1 (all-user-processes)", pid: -1 },
    { label: "NaN", pid: Number.NaN },
    { label: "Infinity", pid: Number.POSITIVE_INFINITY },
  ])("rejects pid=$label in runtime.json without sending any signal (security regression process-stop safety)", async ({
    pid,
  }) => {
    // Regression guard for invalid pid input: a pid<=0 (or non-finite)
    // in runtime.json would otherwise reach `process.kill(pid, "SIGTERM")`,
    // where pid=0 broadcasts to the caller's process group and pid=-1
    // broadcasts to every process owned by the user. Threat model:
    // PARASOR_CONFIG_DIR redirects to an attacker-writable path with a
    // crafted runtime.json. Mirrors the `pid > 0` guard in pty-host.ts:134.
    const ctx = makeDeps({
      sendIpc: vi.fn().mockImplementation(() => {
        const err = new Error("refused") as NodeJS.ErrnoException;
        err.code = "ECONNREFUSED";
        return Promise.reject(err);
      }),
      readRuntimeJson: () => ({ pid }),
    });

    await cliStop(ctx.deps);

    // Critical: NO killProcess call may have been issued for this pid.
    expect(ctx.killCalls).toHaveLength(0);
    // Treated as "no live server" -- daemon stop still runs idempotently.
    expect(ctx.stopDaemonCalls).toBe(1);
    expect(
      ctx.logs.some((l) => l.includes("no live parasor server detected")),
    ).toBe(true);
  });

  it("surfaces a daemon-stop failure as an actionable error pointing at --force recovery", async () => {
    // Common cause is cliPtyHost refusing to SIGTERM under stale-pidfile
    // ownership uncertainty (refuses without --force per pty-host.ts
    // safety guard). The error must guide the user from `parasor stop`
    // into `parasor pty-host doctor` + `parasor pty-host stop --force`.
    const ctx = makeDeps({
      sendIpc: vi.fn().mockResolvedValue({ ok: true }),
      stopDaemon: async () => 1,
    });

    await expect(cliStop(ctx.deps)).rejects.toThrow(
      /parasor-pty-host stop reported failure/,
    );
    await expect(cliStop(ctx.deps)).rejects.toThrow(/pty-host doctor/);
    await expect(cliStop(ctx.deps)).rejects.toThrow(
      /parasor pty-host stop --force/,
    );
  });
});

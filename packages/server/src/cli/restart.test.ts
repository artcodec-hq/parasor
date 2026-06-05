import { describe, expect, it, vi } from "vitest";
import { cliRestart, type RestartDeps } from "./restart.js";

/*
 * Every test injects the full dependency surface so nothing touches the real
 * IPC socket, real child processes, or real filesystem. `waitForPidExit`
 * loops with `deps.now()` + `deps.sleep(250)`; we drive both via fakes so the
 * 5s timeout can be exercised in milliseconds.
 */

interface SendIpcCall {
  socketPath: string;
  req: unknown;
  timeoutMs: number;
}

interface TestContext {
  deps: RestartDeps;
  logs: string[];
  sendIpcCalls: SendIpcCall[];
  killCalls: Array<{ pid: number; signal: NodeJS.Signals | 0 }>;
  spawnSyncCalls: Array<{ cmd: string; args: string[] }>;
  spawnDetachedCalls: Array<{ cmd: string; args: string[] }>;
}

interface TestOverrides {
  platform?: NodeJS.Platform | string;
  sendIpc?: RestartDeps["sendIpc"];
  readRuntimeJson?: RestartDeps["readRuntimeJson"];
  killProcess?: RestartDeps["killProcess"];
  spawnSync?: RestartDeps["spawnSync"];
  spawnDetached?: RestartDeps["spawnDetached"];
  fileExists?: RestartDeps["fileExists"];
  isLaunchdManaged?: RestartDeps["isLaunchdManaged"];
  isSystemdManaged?: RestartDeps["isSystemdManaged"];
  confirmRestart?: RestartDeps["confirmRestart"];
  clock?: { nowMs: number };
}

function makeDeps(overrides: TestOverrides = {}): TestContext {
  const logs: string[] = [];
  const sendIpcCalls: SendIpcCall[] = [];
  const killCalls: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
  const spawnSyncCalls: Array<{ cmd: string; args: string[] }> = [];
  const spawnDetachedCalls: Array<{ cmd: string; args: string[] }> = [];
  const clock = overrides.clock ?? { nowMs: 0 };

  const deps: RestartDeps = {
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
    spawnDetached:
      overrides.spawnDetached ??
      ((cmd, args) => {
        spawnDetachedCalls.push({ cmd, args });
        return { pid: 9999 };
      }),
    log: (msg) => logs.push(msg),
    sleep: async (ms) => {
      clock.nowMs += ms;
    },
    fileExists: overrides.fileExists ?? (() => false),
    isLaunchdManaged: overrides.isLaunchdManaged ?? (() => false),
    isSystemdManaged: overrides.isSystemdManaged ?? (() => false),
    confirmRestart:
      overrides.confirmRestart ??
      (async () => ({ proceed: true, reason: "test stub" })),
  };

  // Record sendIpc calls when the caller supplies a custom one too.
  if (overrides.sendIpc) {
    const original = deps.sendIpc;
    deps.sendIpc = (socketPath, req, timeoutMs) => {
      sendIpcCalls.push({ socketPath, req, timeoutMs });
      return original(socketPath, req, timeoutMs);
    };
  }
  // Same for killProcess.
  if (overrides.killProcess) {
    const original = deps.killProcess;
    deps.killProcess = (pid, signal) => {
      killCalls.push({ pid, signal });
      return original(pid, signal);
    };
  }

  return {
    deps,
    logs,
    sendIpcCalls,
    killCalls,
    spawnSyncCalls,
    spawnDetachedCalls,
  };
}

describe("cliRestart", () => {
  it("delegates to launchctl kickstart on darwin when launchd manages parasor", async () => {
    const spawnSyncLog: Array<{ cmd: string; args: string[] }> = [];
    const ctx = makeDeps({
      platform: "darwin",
      isLaunchdManaged: () => true,
      spawnSync: (cmd, args) => {
        spawnSyncLog.push({ cmd, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await cliRestart(ctx.deps);

    const kickstart = spawnSyncLog.find((c) => c.cmd === "launchctl");
    expect(kickstart).toBeDefined();
    expect(kickstart?.args).toEqual([
      "kickstart",
      "-k",
      expect.stringMatching(/^gui\/\d+\/com\.parasor$/),
    ]);
    expect(ctx.sendIpcCalls).toHaveLength(0);
    expect(ctx.killCalls).toHaveLength(0);
    expect(ctx.spawnDetachedCalls).toHaveLength(0);
  });

  it("delegates to systemctl restart on linux when systemd manages parasor", async () => {
    const spawnSyncLog: Array<{ cmd: string; args: string[] }> = [];
    const ctx = makeDeps({
      platform: "linux",
      isSystemdManaged: () => true,
      spawnSync: (cmd, args) => {
        spawnSyncLog.push({ cmd, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await cliRestart(ctx.deps);

    const sysctl = spawnSyncLog.find((c) => c.cmd === "systemctl");
    expect(sysctl?.args).toEqual(["--user", "restart", "parasor.service"]);
    expect(ctx.sendIpcCalls).toHaveLength(0);
    expect(ctx.spawnDetachedCalls).toHaveLength(0);
  });

  it("falls through to manual path when service-managed kickstart fails", async () => {
    let sigtermSent = false;
    let pidAlive = true;
    const spawnSyncLog: Array<{ cmd: string; args: string[] }> = [];
    const ctx = makeDeps({
      platform: "darwin",
      isLaunchdManaged: () => true,
      spawnSync: (cmd, args) => {
        spawnSyncLog.push({ cmd, args });
        // Non-zero -> kickstart failed -> fallback triggers.
        return { status: 1, stdout: "", stderr: "error" };
      },
      sendIpc: () => {
        const err = new Error("refused") as NodeJS.ErrnoException;
        err.code = "ECONNREFUSED";
        return Promise.reject(err);
      },
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

    await cliRestart(ctx.deps);

    expect(sigtermSent).toBe(true);
    expect(ctx.spawnDetachedCalls).toHaveLength(1);
  });

  it("respawns after IPC shutdown succeeds and lock releases (no service manager)", async () => {
    // Simulate the lock file clearing a beat after graceful shutdown.
    let poll = 0;
    const ctx = makeDeps({
      sendIpc: vi.fn().mockResolvedValue({ ok: true }),
      fileExists: () => {
        poll += 1;
        // Return true (lock still held) for the first poll, then false.
        return poll <= 1;
      },
    });

    await cliRestart(ctx.deps);

    expect(ctx.sendIpcCalls).toHaveLength(1);
    expect(ctx.spawnDetachedCalls).toHaveLength(1);
  });

  it("throws when graceful shutdown acks but lockfile never releases", async () => {
    const ctx = makeDeps({
      sendIpc: vi.fn().mockResolvedValue({ ok: true }),
      fileExists: () => true, // lock never clears
    });

    await expect(cliRestart(ctx.deps)).rejects.toThrow(
      /did not release its lockfile/,
    );
    expect(ctx.spawnDetachedCalls).toHaveLength(0);
  });

  it("falls back to SIGTERM path when IPC shutdown returns {ok:false}", async () => {
    // Mixed-version server: handler missing, server replies with error envelope.
    let sigtermSent = false;
    let pidAlive = true;
    const ctx = makeDeps({
      sendIpc: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "unknown-command" }),
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

    await cliRestart(ctx.deps);

    expect(sigtermSent).toBe(true);
    expect(ctx.spawnDetachedCalls).toHaveLength(1);
  });

  it("SIGTERMs holder pid and respawns when pid alive + IPC refused", async () => {
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

    await cliRestart(ctx.deps);

    expect(sigtermSent).toBe(true);
    expect(ctx.spawnDetachedCalls).toHaveLength(1);
    expect(ctx.logs.some((l) => l.includes("SIGTERM"))).toBe(true);
  });

  it("throws actionable error without SIGKILL when pid survives SIGTERM for 5s", async () => {
    let sigkillSent = false;
    const ctx = makeDeps({
      sendIpc: vi.fn().mockImplementation(() => {
        const err = new Error("refused") as NodeJS.ErrnoException;
        err.code = "ECONNREFUSED";
        return Promise.reject(err);
      }),
      readRuntimeJson: () => ({ pid: 4242 }),
      killProcess: (_pid, signal) => {
        if (signal === "SIGKILL") {
          sigkillSent = true;
          return true;
        }
        if (signal === "SIGTERM") return true;
        if (signal === 0) return true; // always alive
        return true;
      },
    });

    await expect(cliRestart(ctx.deps)).rejects.toThrow(
      /did not exit after SIGTERM within 5s/,
    );
    expect(sigkillSent).toBe(false);
    expect(ctx.spawnDetachedCalls).toHaveLength(0);
  });

  it("performs cold respawn when neither runtime.json nor socket exists", async () => {
    const ctx = makeDeps({
      readRuntimeJson: () => null,
    });

    await cliRestart(ctx.deps);

    expect(ctx.killCalls.filter((c) => c.signal === "SIGTERM")).toHaveLength(0);
    expect(ctx.spawnDetachedCalls).toHaveLength(1);
    expect(ctx.logs.some((l) => l.includes("cold start"))).toBe(true);
  });
});

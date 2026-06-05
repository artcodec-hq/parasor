/**
 * Socket-ready poll tests for createLinuxAdapter (R1 install, R2 restart).
 * Split from service-linux.test.ts to keep the evidence-gate clean.
 */
import { describe, expect, it, vi } from "vitest";
import { createLinuxAdapter } from "./service-linux.js";

const BIN = "/home/u/.npm-global/lib/node_modules/@parasor/cli/bin/parasor.mjs";
const DAEMON_ENTRY =
  "/home/u/.npm-global/lib/node_modules/@parasor/cli/server/pty/host-daemon/entry.js";
const NODE = "/usr/bin/node";
const HOME = "/home/u";
const CONFIG = "/home/u/.config/parasor";
const SERVER_UNIT = "/home/u/.config/systemd/user/parasor.service";
const DAEMON_UNIT = "/home/u/.config/systemd/user/parasor-pty-host.service";

function mkFs() {
  const writes = new Map<string, string>();
  return {
    writes,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn((p: string, c: string) => writes.set(p, c)),
    readFileSync: vi.fn((p: string) => {
      const v = writes.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    }),
    rmSync: vi.fn((p: string) => writes.delete(p)),
    existsSync: vi.fn((p: string) => writes.has(p)),
  };
}

function mkSpawn() {
  const calls: string[][] = [];
  return {
    calls,
    spawn: vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    }),
  };
}

function mk(overrides: Partial<Parameters<typeof createLinuxAdapter>[0]> = {}) {
  const fs = mkFs();
  const spawn = mkSpawn();
  const adapter = createLinuxAdapter({
    binPath: BIN,
    daemonEntryPath: DAEMON_ENTRY,
    home: HOME,
    configDir: CONFIG,
    execPath: NODE,
    fs,
    spawn: spawn.spawn,
    log: vi.fn(),
    ...overrides,
  });
  return { adapter, fs, spawn };
}

describe("createLinuxAdapter install -- socket-ready poll (R1)", () => {
  it("calls waitFn with the daemon socket path, completing before server enable", async () => {
    const waitCalls: string[] = [];
    const waitFn = vi.fn((path: string) => {
      waitCalls.push(path);
      return Promise.resolve();
    });
    const { adapter, spawn } = mk({ waitFn });
    await adapter.install();
    expect(waitCalls.length).toBeGreaterThanOrEqual(1);
    expect(waitCalls[0]).toMatch(/parasor-pty\.sock$/);
    // daemon enable must precede server enable
    const daemonEnableIdx = spawn.calls.findIndex(
      (c) => c.includes("enable") && c.includes("parasor-pty-host.service"),
    );
    const serverEnableIdx = spawn.calls.findIndex(
      (c) => c.includes("enable") && c.includes("parasor.service"),
    );
    expect(daemonEnableIdx).toBeGreaterThanOrEqual(0);
    expect(serverEnableIdx).toBeGreaterThan(daemonEnableIdx);
  });

  it("aborts install and does not enable server when waitFn rejects (timeout)", async () => {
    const waitFn = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "daemon socket did not become ready within 5000ms (path=/run/test.sock)",
        ),
      );
    const { adapter, spawn } = mk({ waitFn });
    await expect(adapter.install()).rejects.toThrow(
      "daemon socket did not become ready",
    );
    const serverEnables = spawn.calls.filter(
      (c) => c.includes("enable") && c.includes("parasor.service"),
    );
    expect(serverEnables).toHaveLength(0);
  });

  it("passes through to server enable when waitFn resolves", async () => {
    const waitFn = vi.fn().mockResolvedValue(undefined);
    const { adapter, spawn } = mk({ waitFn });
    await adapter.install();
    const serverEnables = spawn.calls.filter(
      (c) => c.includes("enable") && c.includes("parasor.service"),
    );
    expect(serverEnables.length).toBeGreaterThanOrEqual(1);
  });
});

describe("createLinuxAdapter restart -- socket-ready poll (R2)", () => {
  it("calls waitFn after daemon restart and before server restart", async () => {
    const waitCalls: string[] = [];
    const waitFn = vi.fn((path: string) => {
      waitCalls.push(path);
      return Promise.resolve();
    });
    const { adapter, fs, spawn } = mk({ waitFn });
    fs.writes.set(SERVER_UNIT, "existing");
    fs.writes.set(DAEMON_UNIT, "existing");
    await adapter.restart({ all: true });
    expect(waitCalls.length).toBeGreaterThanOrEqual(1);
    expect(waitCalls[0]).toMatch(/parasor-pty\.sock$/);
    const daemonRestartIdx = spawn.calls.findIndex(
      (c) => c.includes("restart") && c.includes("parasor-pty-host.service"),
    );
    const serverRestartIdx = spawn.calls.findIndex(
      (c) => c.includes("restart") && c.includes("parasor.service"),
    );
    expect(daemonRestartIdx).toBeGreaterThanOrEqual(0);
    expect(serverRestartIdx).toBeGreaterThan(daemonRestartIdx);
  });

  it("aborts restart and does not restart server when waitFn rejects (timeout)", async () => {
    const waitFn = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "daemon socket did not become ready within 5000ms (path=/run/test.sock)",
        ),
      );
    const { adapter, fs, spawn } = mk({ waitFn });
    fs.writes.set(SERVER_UNIT, "existing");
    fs.writes.set(DAEMON_UNIT, "existing");
    await expect(adapter.restart({ all: true })).rejects.toThrow(
      "daemon socket did not become ready",
    );
    const serverRestarts = spawn.calls.filter(
      (c) => c.includes("restart") && c.includes("parasor.service"),
    );
    expect(serverRestarts).toHaveLength(0);
  });

  it("does not call waitFn when daemon unit is not installed", async () => {
    const waitFn = vi.fn().mockResolvedValue(undefined);
    const { adapter, fs } = mk({ waitFn });
    fs.writes.set(SERVER_UNIT, "existing");
    // daemon unit absent
    await adapter.restart({ all: true });
    expect(waitFn).not.toHaveBeenCalled();
  });
});

/**
 * Socket-ready poll tests for createDarwinAdapter (R1 install, R2 restart).
 * Split from service-darwin.test.ts to keep the evidence-gate clean.
 */
import { describe, expect, it, vi } from "vitest";
import { createDarwinAdapter } from "./service-darwin.js";

const BIN = "/opt/homebrew/lib/node_modules/@parasor/cli/bin/parasor.mjs";
const DAEMON_ENTRY =
  "/opt/homebrew/lib/node_modules/@parasor/cli/server/pty/host-daemon/entry.js";
const NODE = "/opt/homebrew/bin/node";
const HOME = "/Users/testuser";
const CONFIG = "/Users/testuser/.config/parasor";
const SERVER_PLIST = "/Users/testuser/Library/LaunchAgents/com.parasor.plist";
const DAEMON_PLIST =
  "/Users/testuser/Library/LaunchAgents/com.parasor.pty-host.plist";

function mkFs() {
  const writes = new Map<string, string>();
  const removed: string[] = [];
  return {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn((p: string, content: string) => {
      writes.set(p, content);
    }),
    readFileSync: vi.fn((p: string) => {
      const v = writes.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    }),
    rmSync: vi.fn((p: string) => {
      removed.push(p);
      writes.delete(p);
    }),
    existsSync: vi.fn((p: string) => writes.has(p)),
    writes,
    removed,
  };
}

function mkSpawn() {
  const calls: string[][] = [];
  return {
    spawn: vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    }),
    calls,
  };
}

function mkAdapter(
  overrides: Partial<Parameters<typeof createDarwinAdapter>[0]> = {},
) {
  const fs = mkFs();
  const spawn = mkSpawn();
  const adapter = createDarwinAdapter({
    binPath: BIN,
    daemonEntryPath: DAEMON_ENTRY,
    home: HOME,
    configDir: CONFIG,
    uid: 501,
    execPath: NODE,
    fs,
    spawn: spawn.spawn,
    log: vi.fn(),
    ...overrides,
  });
  return { adapter, fs, spawn };
}

describe("createDarwinAdapter install -- socket-ready poll (R1)", () => {
  it("calls waitFn with the daemon socket path, completing before server bootstrap", async () => {
    const waitCalls: string[] = [];
    const waitFn = vi.fn((path: string) => {
      waitCalls.push(path);
      return Promise.resolve();
    });
    const { adapter, spawn } = mkAdapter({ waitFn });
    await adapter.install();
    expect(waitCalls.length).toBeGreaterThanOrEqual(1);
    expect(waitCalls[0]).toMatch(/parasor-pty\.sock$/);
    // daemon bootstrap must precede server bootstrap.
    // launchctl bootstrap <domain> <plist-path>: idx 0=launchctl, 1=bootstrap, 2=domain, 3=plist
    const daemonBootstrapIdx = spawn.calls.findIndex(
      (c) => c[1] === "bootstrap" && c[3] === DAEMON_PLIST,
    );
    const serverBootstrapIdx = spawn.calls.findIndex(
      (c) => c[1] === "bootstrap" && c[3] === SERVER_PLIST,
    );
    expect(daemonBootstrapIdx).toBeGreaterThanOrEqual(0);
    expect(serverBootstrapIdx).toBeGreaterThan(daemonBootstrapIdx);
  });

  it("aborts install and does not bootstrap server when waitFn rejects (timeout)", async () => {
    const waitFn = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "daemon socket did not become ready within 5000ms (path=/run/test.sock)",
        ),
      );
    const { adapter, spawn } = mkAdapter({ waitFn });
    await expect(adapter.install()).rejects.toThrow(
      "daemon socket did not become ready",
    );
    const serverBootstraps = spawn.calls.filter(
      (c) => c[1] === "bootstrap" && c[3] === SERVER_PLIST,
    );
    expect(serverBootstraps).toHaveLength(0);
  });

  it("passes through to server bootstrap when waitFn resolves", async () => {
    const waitFn = vi.fn().mockResolvedValue(undefined);
    const { adapter, spawn } = mkAdapter({ waitFn });
    await adapter.install();
    // server was bootstrapped
    const serverBootstraps = spawn.calls.filter(
      (c) => c[1] === "bootstrap" && c[3] === SERVER_PLIST,
    );
    expect(serverBootstraps.length).toBeGreaterThanOrEqual(1);
  });
});

describe("createDarwinAdapter restart -- socket-ready poll (R2)", () => {
  it("calls waitFn after daemon kickstart and before server kickstart", async () => {
    const waitCalls: string[] = [];
    const waitFn = vi.fn((path: string) => {
      waitCalls.push(path);
      return Promise.resolve();
    });
    const { adapter, fs, spawn } = mkAdapter({ waitFn });
    fs.writes.set(SERVER_PLIST, "existing");
    fs.writes.set(DAEMON_PLIST, "existing");
    await adapter.restart({ all: true });
    expect(waitCalls.length).toBeGreaterThanOrEqual(1);
    expect(waitCalls[0]).toMatch(/parasor-pty\.sock$/);
    const daemonKickIdx = spawn.calls.findIndex(
      (c) => c[1] === "kickstart" && c[3] === "gui/501/com.parasor.pty-host",
    );
    const serverKickIdx = spawn.calls.findIndex(
      (c) => c[1] === "kickstart" && c[3] === "gui/501/com.parasor",
    );
    expect(daemonKickIdx).toBeGreaterThanOrEqual(0);
    expect(serverKickIdx).toBeGreaterThan(daemonKickIdx);
  });

  it("aborts restart and does not kickstart server when waitFn rejects (timeout)", async () => {
    const waitFn = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "daemon socket did not become ready within 5000ms (path=/run/test.sock)",
        ),
      );
    const { adapter, fs, spawn } = mkAdapter({ waitFn });
    fs.writes.set(SERVER_PLIST, "existing");
    fs.writes.set(DAEMON_PLIST, "existing");
    await expect(adapter.restart({ all: true })).rejects.toThrow(
      "daemon socket did not become ready",
    );
    const serverKicks = spawn.calls.filter(
      (c) => c[1] === "kickstart" && c[3] === "gui/501/com.parasor",
    );
    expect(serverKicks).toHaveLength(0);
  });

  it("does not call waitFn when daemon plist is not installed", async () => {
    const waitFn = vi.fn().mockResolvedValue(undefined);
    const { adapter, fs } = mkAdapter({ waitFn });
    fs.writes.set(SERVER_PLIST, "existing");
    // daemon plist absent
    await adapter.restart({ all: true });
    expect(waitFn).not.toHaveBeenCalled();
  });
});

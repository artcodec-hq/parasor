import { describe, expect, it, vi } from "vitest";
import { createLinuxAdapter, renderUnit } from "./service-linux.js";

const BIN = "/home/u/.npm-global/lib/node_modules/@parasor/cli/bin/parasor.mjs";
const DAEMON_ENTRY =
  "/home/u/.npm-global/lib/node_modules/@parasor/cli/server/pty/host-daemon/entry.js";
const NODE = "/usr/bin/node";
const HOME = "/home/u";
const CONFIG = "/home/u/.config/parasor";
const SERVER_UNIT = "/home/u/.config/systemd/user/parasor.service";
const DAEMON_UNIT = "/home/u/.config/systemd/user/parasor-pty-host.service";

describe("renderUnit", () => {
  it("has the load-bearing systemd keys (server defaults)", () => {
    const body = renderUnit({
      description: "parasor",
      node: NODE,
      bin: BIN,
      stdoutLog: `${CONFIG}/service.log`,
      stderrLog: `${CONFIG}/service.err.log`,
      env: { HOME, PATH: "/usr/bin:/bin" },
    });
    expect(body).toMatch(/\[Unit\]/);
    expect(body).toMatch(/\[Service\]/);
    expect(body).toMatch(/\[Install\]/);
    expect(body).toMatch(new RegExp(`ExecStart=${NODE} ${BIN}`));
    expect(body).toMatch(/Type=notify/);
    expect(body).toMatch(/WatchdogSec=30/);
    expect(body).toMatch(/Restart=on-failure/);
    expect(body).toMatch(/RestartSec=3/);
    expect(body).toMatch(/After=network\.target/);
    expect(body).toMatch(/StandardOutput=append:/);
    expect(body).toMatch(/StandardError=append:/);
    expect(body).toMatch(/Environment="HOME=/);
    expect(body).toMatch(/Environment="PATH=/);
    expect(body).toMatch(/WantedBy=default.target/);
  });

  it("renders Type=simple + Restart=always + KillMode=mixed + StartLimit=0 + RestartPreventExitStatus=2 for daemon", () => {
    const body = renderUnit({
      description: "parasor PTY host daemon",
      node: NODE,
      bin: DAEMON_ENTRY,
      stdoutLog: `${CONFIG}/pty-host.out.log`,
      stderrLog: `${CONFIG}/pty-host.err.log`,
      env: { HOME },
      after: "default.target",
      notify: false,
      restartOnAlways: true,
      killModeMixed: true,
      unlimitedStartRate: true,
      restartPreventExitStatus: [2],
    });
    expect(body).toMatch(/Type=simple/);
    expect(body).not.toMatch(/Type=notify/);
    expect(body).not.toMatch(/WatchdogSec/);
    expect(body).toMatch(/Restart=always/);
    expect(body).toMatch(/RestartSec=2/);
    expect(body).toMatch(/RestartPreventExitStatus=2/);
    expect(body).toMatch(/KillMode=mixed/);
    expect(body).toMatch(/TimeoutStopSec=10/);
    expect(body).toMatch(/After=default\.target/);
    expect(body).toMatch(/StartLimitIntervalSec=0/);
    expect(body).toMatch(/StartLimitBurst=0/);
  });

  it("omits RestartPreventExitStatus when not set (server default)", () => {
    const body = renderUnit({
      description: "parasor",
      node: NODE,
      bin: BIN,
      stdoutLog: "/tmp/o",
      stderrLog: "/tmp/e",
      env: { HOME },
    });
    expect(body).not.toMatch(/RestartPreventExitStatus/);
  });

  it("escapes backslashes and double-quotes in environment values", () => {
    const body = renderUnit({
      description: "x",
      node: NODE,
      bin: BIN,
      stdoutLog: "/tmp/o",
      stderrLog: "/tmp/e",
      env: { WEIRD: 'a"b\\c' },
    });
    // Backslash -> \\, double-quote -> \"
    expect(body).toContain('Environment="WEIRD=a\\"b\\\\c"');
  });

  it("rejects newlines in environment values", () => {
    expect(() =>
      renderUnit({
        description: "x",
        node: NODE,
        bin: BIN,
        stdoutLog: "/tmp/o",
        stderrLog: "/tmp/e",
        env: { BAD: "line1\nline2" },
      }),
    ).toThrow(/newline/i);
  });
});

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
    //  R1/R2 -- stub the daemon socket-ready poll so the
    // existing canonical-install / restart tests do not block on a real
    // unix socket that never opens. The poll itself is exercised in
    // service-linux-socket-ready.test.ts.
    waitFn: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  return { adapter, fs, spawn };
}

describe("createLinuxAdapter install (canonical)", () => {
  it("writes both units and enables both via systemctl --user", async () => {
    const { adapter, fs, spawn } = mk();
    await adapter.install();
    expect(fs.writes.has(SERVER_UNIT)).toBe(true);
    expect(fs.writes.has(DAEMON_UNIT)).toBe(true);
    const enables = spawn.calls
      .filter((c) => c.includes("enable"))
      .map((c) => c[c.length - 1]);
    expect(enables).toEqual(["parasor-pty-host.service", "parasor.service"]);
  });

  it("enables the daemon BEFORE the server", async () => {
    const { adapter, spawn } = mk();
    await adapter.install();
    const enableTargets = spawn.calls
      .filter((c) => c.includes("enable"))
      .map((c) => c[c.length - 1]);
    expect(enableTargets[0]).toBe("parasor-pty-host.service");
    expect(enableTargets[1]).toBe("parasor.service");
  });

  it("injects PARASOR_PTY_DAEMON=1 and PARASOR_PTY_AUTOSTART=0 in the server unit", async () => {
    const { adapter, fs } = mk();
    await adapter.install();
    const body = fs.writes.get(SERVER_UNIT) ?? "";
    expect(body).toContain('Environment="PARASOR_PTY_DAEMON=1"');
    expect(body).toContain('Environment="PARASOR_PTY_AUTOSTART=0"');
  });

  it("daemon unit has Type=simple + Restart=always + KillMode=mixed + StartLimitBurst=0 + ExecStart=daemon entry", async () => {
    const { adapter, fs } = mk();
    await adapter.install();
    const body = fs.writes.get(DAEMON_UNIT) ?? "";
    expect(body).toContain(`ExecStart=${NODE} ${DAEMON_ENTRY}`);
    expect(body).toMatch(/Type=simple/);
    expect(body).toMatch(/Restart=always/);
    expect(body).toMatch(/KillMode=mixed/);
    expect(body).toMatch(/StartLimitBurst=0/);
    expect(body).toMatch(/After=default\.target/);
  });

  it("calls daemon-reload after each unit write", async () => {
    const { adapter, spawn } = mk();
    await adapter.install();
    const reloads = spawn.calls.filter((c) => c.includes("daemon-reload"));
    expect(reloads.length).toBeGreaterThanOrEqual(2);
  });

  it("explicitly restarts each unit when it existed before (so new env propagates)", async () => {
    const { adapter, fs, spawn } = mk();
    fs.writes.set(SERVER_UNIT, "<pre-existing-server>");
    fs.writes.set(DAEMON_UNIT, "<pre-existing-daemon>");
    await adapter.install();
    const restarts = spawn.calls
      .filter((c) => c.includes("restart"))
      .map((c) => c[c.length - 1]);
    expect(restarts).toContain("parasor-pty-host.service");
    expect(restarts).toContain("parasor.service");
  });

  it("does NOT restart on first-time install (enable --now already starts it)", async () => {
    const { adapter, spawn } = mk();
    await adapter.install();
    const restarts = spawn.calls.filter((c) => c.includes("restart"));
    expect(restarts).toHaveLength(0);
  });

  it("skips restart when both unit files are byte-identical (preserves running daemon across npm-style updates)", async () => {
    const { adapter, fs, spawn } = mk();
    await adapter.install();
    const priorServer = fs.writes.get(SERVER_UNIT);
    const priorDaemon = fs.writes.get(DAEMON_UNIT);
    expect(priorServer).toBeTruthy();
    expect(priorDaemon).toBeTruthy();
    spawn.calls.length = 0;
    await adapter.install();
    const restarts = spawn.calls.filter((c) => c.includes("restart"));
    expect(restarts).toHaveLength(0);
  });

  it("restarts only the daemon unit when only the daemon content changed (server preserved)", async () => {
    const { adapter, fs, spawn } = mk();
    await adapter.install();
    fs.writes.set(DAEMON_UNIT, "<stale-daemon>");
    spawn.calls.length = 0;
    await adapter.install();
    const restarts = spawn.calls
      .filter((c) => c.includes("restart"))
      .map((c) => c[c.length - 1]);
    expect(restarts).toContain("parasor-pty-host.service");
    expect(restarts).not.toContain("parasor.service");
  });

  it("aborts and removes the freshly-written daemon unit when enable fails on a clean system", async () => {
    const fs = mkFs();
    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (
        cmd === "systemctl" &&
        args.includes("enable") &&
        args.includes("parasor-pty-host.service")
      ) {
        return { status: 1, stdout: "", stderr: "spawn-failed" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mk({ fs, spawn });
    await expect(adapter.install()).rejects.toThrow(/pty-host/);
    expect(fs.writes.has(DAEMON_UNIT)).toBe(false);
  });

  it("restores the prior daemon unit content when reinstall enable fails", async () => {
    const fs = mkFs();
    const PRIOR = "<prior-working-daemon-unit>";
    fs.writes.set(DAEMON_UNIT, PRIOR);
    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (
        cmd === "systemctl" &&
        args.includes("enable") &&
        args.includes("parasor-pty-host.service")
      ) {
        return { status: 1, stdout: "", stderr: "broken-config" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mk({ fs, spawn });
    await expect(adapter.install()).rejects.toThrow(/rolled back/);
    expect(fs.writes.get(DAEMON_UNIT)).toBe(PRIOR);
  });

  it("restores the prior daemon unit + restarts when reinstall restart fails", async () => {
    const fs = mkFs();
    const PRIOR = "<prior-working-daemon-unit>";
    fs.writes.set(DAEMON_UNIT, PRIOR);
    let firstRestart = true;
    const calls: string[][] = [];
    const spawn = vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (
        cmd === "systemctl" &&
        args.includes("restart") &&
        args.includes("parasor-pty-host.service")
      ) {
        if (firstRestart) {
          firstRestart = false;
          return { status: 1, stdout: "", stderr: "broken-config" };
        }
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mk({ fs, spawn });
    await expect(adapter.install()).rejects.toThrow(/rolled back/);
    expect(fs.writes.get(DAEMON_UNIT)).toBe(PRIOR);
    const daemonRestarts = calls.filter(
      (c) =>
        c[0] === "systemctl" &&
        c.includes("restart") &&
        c.includes("parasor-pty-host.service"),
    );
    expect(daemonRestarts).toHaveLength(2);
  });

  it("rolls back the daemon if the server enable fails on a clean system", async () => {
    const fs = mkFs();
    const calls: string[][] = [];
    const spawn = vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (
        cmd === "systemctl" &&
        args.includes("enable") &&
        args.includes("parasor.service")
      ) {
        return { status: 1, stdout: "", stderr: "port-in-use" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mk({ fs, spawn });
    await expect(adapter.install()).rejects.toThrow(/server/);
    expect(fs.writes.has(SERVER_UNIT)).toBe(false);
    expect(fs.writes.has(DAEMON_UNIT)).toBe(false);
    const disables = calls
      .filter((c) => c.includes("disable"))
      .map((c) => c[c.length - 1]);
    expect(disables).toContain("parasor-pty-host.service");
  });

  it("preserves prior daemon unit when server enable fails on reinstall", async () => {
    const fs = mkFs();
    const PRIOR_DAEMON = "<prior-daemon-unit>";
    fs.writes.set(DAEMON_UNIT, PRIOR_DAEMON);
    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (
        cmd === "systemctl" &&
        args.includes("enable") &&
        args.includes("parasor.service")
      ) {
        return { status: 1, stdout: "", stderr: "port-in-use" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mk({ fs, spawn });
    await expect(adapter.install()).rejects.toThrow(/server/);
    expect(fs.writes.has(SERVER_UNIT)).toBe(false);
    // Daemon must remain installed (it pre-existed; reinstall rewrote it
    // with the canonical config and that succeeded; only the server
    // enable failed).
    expect(fs.writes.has(DAEMON_UNIT)).toBe(true);
  });
});

describe("createLinuxAdapter uninstall", () => {
  it("disables+removes both units when present", async () => {
    const { adapter, fs, spawn } = mk();
    fs.writes.set(SERVER_UNIT, "server");
    fs.writes.set(DAEMON_UNIT, "daemon");
    await adapter.uninstall();
    expect(fs.writes.has(SERVER_UNIT)).toBe(false);
    expect(fs.writes.has(DAEMON_UNIT)).toBe(false);
    const disableOrder = spawn.calls
      .filter((c) => c.includes("disable"))
      .map((c) => c[c.length - 1]);
    // server first to avoid PTY-host-disconnected banner
    expect(disableOrder).toEqual([
      "parasor.service",
      "parasor-pty-host.service",
    ]);
  });

  it("is idempotent when nothing is installed", async () => {
    const { adapter } = mk();
    await expect(adapter.uninstall()).resolves.toBeUndefined();
  });

  it("surfaces a warning if systemctl disable fails (instead of swallowing it silently)", async () => {
    const fs = mkFs();
    fs.writes.set(SERVER_UNIT, "server");
    fs.writes.set(DAEMON_UNIT, "daemon");
    const log = vi.fn();
    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (
        cmd === "systemctl" &&
        args.includes("disable") &&
        args.includes("parasor-pty-host.service")
      ) {
        return { status: 5, stdout: "", stderr: "Unit not found" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mk({ fs, spawn, log });
    await adapter.uninstall();
    const lines = log.mock.calls.map((c) => c[0] as string);
    expect(
      lines.some((l) => l.includes("warning") && l.includes("pty-host")),
    ).toBe(true);
    // File still removed regardless of disable failure.
    expect(fs.writes.has(DAEMON_UNIT)).toBe(false);
  });
});

describe("createLinuxAdapter restart", () => {
  it("default scope restarts only the server so daemon-owned PTYs survive", async () => {
    const { adapter, fs, spawn } = mk();
    fs.writes.set(SERVER_UNIT, "x");
    fs.writes.set(DAEMON_UNIT, "x");
    await adapter.restart({ all: false });
    const restarts = spawn.calls
      .filter((c) => c.includes("restart"))
      .map((c) => c[c.length - 1]);
    expect(restarts).toEqual(["parasor.service"]);
  });

  it("--all restarts both units (daemon first)", async () => {
    const { adapter, fs, spawn } = mk();
    fs.writes.set(SERVER_UNIT, "x");
    fs.writes.set(DAEMON_UNIT, "x");
    await adapter.restart({ all: true });
    const restarts = spawn.calls
      .filter((c) => c.includes("restart"))
      .map((c) => c[c.length - 1]);
    expect(restarts).toEqual(["parasor-pty-host.service", "parasor.service"]);
  });

  it("restarts only what is installed", async () => {
    const { adapter, fs, spawn } = mk();
    fs.writes.set(SERVER_UNIT, "x");
    await adapter.restart({ all: true });
    const restarts = spawn.calls
      .filter((c) => c.includes("restart"))
      .map((c) => c[c.length - 1]);
    expect(restarts).toEqual(["parasor.service"]);
  });
});

describe("createLinuxAdapter status", () => {
  it("reports pty-host before server", async () => {
    const log = vi.fn();
    const { adapter, fs } = mk({ log });
    fs.writes.set(SERVER_UNIT, "server");
    fs.writes.set(DAEMON_UNIT, "daemon");
    await adapter.status();
    const lines = log.mock.calls.map((c) => c[0] as string);
    const ptyHostIdx = lines.findIndex((l) => l.startsWith("pty-host:"));
    const serverIdx = lines.findIndex((l) => l.startsWith("server:"));
    expect(ptyHostIdx).toBeGreaterThanOrEqual(0);
    expect(serverIdx).toBeGreaterThan(ptyHostIdx);
  });
});

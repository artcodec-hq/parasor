import { describe, expect, it, vi } from "vitest";
import { createDarwinAdapter, renderPlist } from "./service-darwin.js";

/*
 * The darwin adapter has two halves we care about separately:
 *   1. renderPlist() -- pure function, snapshot-tested to guard against
 *      accidental key removal (breaking KeepAlive.SuccessfulExit=false
 *      would cause the infinite-restart lockfile loop described in the
 *      spec, so the plist body is load-bearing).
 *   2. createDarwinAdapter().install/uninstall/restart -- side effects,
 *      tested by recording the shell commands and filesystem writes they
 *      would perform.
 *
 * Install is canonical and provisions BOTH
 * server + daemon plists. Tests below pin (a) presence of both env vars
 * in the server unit, (b) daemon-first install order, (c) server-first
 * uninstall order, (d) daemon-first restart order, (e) daemon-failure
 * cleanup, (f) server-failure rollback.
 */

const BIN = "/opt/homebrew/lib/node_modules/@parasor/cli/bin/parasor.mjs";
const DAEMON_ENTRY =
  "/opt/homebrew/lib/node_modules/@parasor/cli/server/pty/host-daemon/entry.js";
const NODE = "/opt/homebrew/bin/node";
const HOME = "/Users/testuser";
const CONFIG = "/Users/testuser/.config/parasor";
const SERVER_PLIST = "/Users/testuser/Library/LaunchAgents/com.parasor.plist";
const DAEMON_PLIST =
  "/Users/testuser/Library/LaunchAgents/com.parasor.pty-host.plist";

describe("renderPlist", () => {
  it("contains all load-bearing keys", () => {
    const body = renderPlist({
      label: "com.parasor",
      node: NODE,
      bin: BIN,
      stdoutLog: `${CONFIG}/service.log`,
      stderrLog: `${CONFIG}/service.err.log`,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME },
    });
    expect(body).toContain("<key>Label</key>");
    expect(body).toContain("<string>com.parasor</string>");
    expect(body).toContain("<key>ProgramArguments</key>");
    expect(body).toContain(`<string>${NODE}</string>`);
    expect(body).toContain(`<string>${BIN}</string>`);
    expect(body).toContain("<key>RunAtLoad</key>");
    expect(body).toContain("<key>KeepAlive</key>");
    expect(body).toContain("<key>Crashed</key>");
    expect(body).toContain("<key>SuccessfulExit</key>");
    expect(body).toContain("<false/>"); // SuccessfulExit=false
    expect(body).toContain(`<string>${CONFIG}/service.log</string>`);
    expect(body).toContain(`<string>${CONFIG}/service.err.log</string>`);
    expect(body).toContain("<key>EnvironmentVariables</key>");
    expect(body).toContain("<key>PATH</key>");
    expect(body).toContain("<key>HOME</key>");
    expect(body).toContain("<string>Interactive</string>"); // ProcessType
  });

  it("renders ProcessType=Background when background=true", () => {
    const body = renderPlist({
      label: "com.parasor.pty-host",
      node: NODE,
      bin: DAEMON_ENTRY,
      stdoutLog: "/tmp/o.log",
      stderrLog: "/tmp/e.log",
      env: {},
      background: true,
    });
    expect(body).toContain("<string>Background</string>");
    expect(body).not.toContain("<string>Interactive</string>");
  });

  it("escapes XML-special characters in values", () => {
    const body = renderPlist({
      label: "com.parasor",
      node: NODE,
      bin: "/tmp/evil<script>&name.mjs",
      stdoutLog: "/tmp/out.log",
      stderrLog: "/tmp/err.log",
      env: {},
    });
    expect(body).toContain("/tmp/evil&lt;script&gt;&amp;name.mjs");
    expect(body).not.toContain("/tmp/evil<script>&name.mjs");
  });
});

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
    //  R1/R2 -- stub the daemon socket-ready poll so the
    // existing canonical-install / restart tests do not block on a real
    // unix socket that never opens. The poll itself is exercised in
    // service-darwin-socket-ready.test.ts.
    waitFn: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  return { adapter, fs, spawn };
}

describe("createDarwinAdapter install (canonical)", () => {
  it("writes both plists and bootstraps both via launchctl", async () => {
    const { adapter, fs, spawn } = mkAdapter();
    await adapter.install();
    expect(fs.writes.has(SERVER_PLIST)).toBe(true);
    expect(fs.writes.has(DAEMON_PLIST)).toBe(true);
    const bootstraps = spawn.calls.filter((c) => c[1] === "bootstrap");
    expect(bootstraps).toHaveLength(2);
  });

  it("bootstraps the daemon BEFORE the server", async () => {
    const { adapter, spawn } = mkAdapter();
    await adapter.install();
    const bootstrapTargets = spawn.calls
      .filter((c) => c[1] === "bootstrap")
      .map((c) => c[3]);
    expect(bootstrapTargets).toEqual([DAEMON_PLIST, SERVER_PLIST]);
  });

  it("injects PARASOR_PTY_DAEMON=1 and PARASOR_PTY_AUTOSTART=0 in the server plist", async () => {
    const { adapter, fs } = mkAdapter();
    await adapter.install();
    const serverBody = fs.writes.get(SERVER_PLIST) ?? "";
    expect(serverBody).toMatch(
      /<key>PARASOR_PTY_DAEMON<\/key>\s*<string>1<\/string>/,
    );
    expect(serverBody).toMatch(
      /<key>PARASOR_PTY_AUTOSTART<\/key>\s*<string>0<\/string>/,
    );
  });

  it("daemon plist points at the resolved daemon entry path with Background QoS", async () => {
    const { adapter, fs } = mkAdapter();
    await adapter.install();
    const daemonBody = fs.writes.get(DAEMON_PLIST) ?? "";
    expect(daemonBody).toContain(`<string>${DAEMON_ENTRY}</string>`);
    expect(daemonBody).toContain("com.parasor.pty-host");
    expect(daemonBody).toContain("Background");
  });

  it("is idempotent: bootouts existing registrations before bootstrap", async () => {
    const { adapter, fs, spawn } = mkAdapter();
    fs.writes.set(SERVER_PLIST, "<pre-existing-server/>");
    fs.writes.set(DAEMON_PLIST, "<pre-existing-daemon/>");
    await adapter.install();
    const order = spawn.calls
      .filter((c) => c[1] === "bootout" || c[1] === "bootstrap")
      .map((c) => c[1]);
    expect(order.indexOf("bootout")).toBeLessThan(order.indexOf("bootstrap"));
  });

  it("aborts and removes the freshly-written daemon plist when bootstrap fails on a clean system", async () => {
    const fs = mkFs();
    const spawn = vi.fn((cmd: string, args: string[]) => {
      // Fail only the daemon bootstrap, succeed everything else.
      if (
        cmd === "launchctl" &&
        args[0] === "bootstrap" &&
        args[2] === DAEMON_PLIST
      ) {
        return { status: 1, stdout: "", stderr: "spawn-failed" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mkAdapter({ fs, spawn });
    await expect(adapter.install()).rejects.toThrow(/pty-host/);
    // No prior plist existed -> freshly-written one removed
    expect(fs.writes.has(DAEMON_PLIST)).toBe(false);
  });

  it("restores the prior daemon plist + re-bootstraps when reinstall bootstrap fails", async () => {
    const fs = mkFs();
    const PRIOR = "<prior-working-daemon-plist/>";
    fs.writes.set(DAEMON_PLIST, PRIOR);
    const calls: string[][] = [];
    let firstDaemonBootstrap = true;
    const spawn = vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (
        cmd === "launchctl" &&
        args[0] === "bootstrap" &&
        args[2] === DAEMON_PLIST
      ) {
        if (firstDaemonBootstrap) {
          firstDaemonBootstrap = false;
          return { status: 1, stdout: "", stderr: "broken-config" };
        }
        // Recovery bootstrap of the restored plist succeeds.
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mkAdapter({ fs, spawn });
    await expect(adapter.install()).rejects.toThrow(/rolled back to prior/);
    // Prior plist content restored on disk
    expect(fs.writes.get(DAEMON_PLIST)).toBe(PRIOR);
    // Two bootstrap calls for the daemon (failed attempt + recovery)
    const daemonBootstraps = calls.filter(
      (c) => c[1] === "bootstrap" && c[3] === DAEMON_PLIST,
    );
    expect(daemonBootstraps).toHaveLength(2);
  });

  it("rolls back the daemon if the server bootstrap fails on a clean system", async () => {
    const fs = mkFs();
    const calls: string[][] = [];
    const spawn = vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      // Fail only the server bootstrap, succeed everything else.
      if (
        cmd === "launchctl" &&
        args[0] === "bootstrap" &&
        args[2] === SERVER_PLIST
      ) {
        return { status: 1, stdout: "", stderr: "port-in-use" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mkAdapter({ fs, spawn });
    await expect(adapter.install()).rejects.toThrow(/server/);
    // Both plists rolled back, daemon bootouted (clean system, nothing pre-existed)
    expect(fs.writes.has(SERVER_PLIST)).toBe(false);
    expect(fs.writes.has(DAEMON_PLIST)).toBe(false);
    const bootouts = calls.filter((c) => c[1] === "bootout");
    expect(bootouts.some((c) => c[3] === DAEMON_PLIST)).toBe(true);
  });

  it("skips bootout/bootstrap when both plists are byte-identical (preserves running daemon across npm-style updates)", async () => {
    const { adapter, fs, spawn } = mkAdapter();
    // First install: writes both plists, bootstraps both.
    await adapter.install();
    const priorServer = fs.writes.get(SERVER_PLIST);
    const priorDaemon = fs.writes.get(DAEMON_PLIST);
    expect(priorServer).toBeTruthy();
    expect(priorDaemon).toBeTruthy();
    spawn.calls.length = 0;
    fs.writes.clear();
    fs.writes.set(SERVER_PLIST, priorServer ?? "");
    fs.writes.set(DAEMON_PLIST, priorDaemon ?? "");
    // Second install on identical content: must NOT bootout or bootstrap.
    await adapter.install();
    const bootouts = spawn.calls.filter((c) => c[1] === "bootout");
    const bootstraps = spawn.calls.filter((c) => c[1] === "bootstrap");
    expect(bootouts).toHaveLength(0);
    expect(bootstraps).toHaveLength(0);
  });

  it("byte-identical plist + unit unloaded -> bootstrap (codex MED 3)", async () => {
    /*
     * -- when the user has manually `launchctl bootout`-ed
     * the daemon (or the unit never loaded for any reason), a second
     * install with byte-identical plist must NOT silently skip bootstrap.
     * Otherwise the user thinks "install succeeded" but no daemon is
     * running. Mock `launchctl print` to fail (= unloaded) for the daemon
     * target on the *second* install only.
     */
    const fs = mkFs();
    let installCount = 0;
    const calls: string[][] = [];
    const spawn = vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      // First install: everything succeeds (sets up plists + loaded state).
      // Second install: print returns non-zero -> unloaded. Bootstrap path
      // must be reachable to recover.
      if (
        installCount >= 1 &&
        cmd === "launchctl" &&
        args[0] === "print" &&
        args[1] === "gui/501/com.parasor.pty-host"
      ) {
        return { status: 113, stdout: "", stderr: "Could not find service" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const adapter = createDarwinAdapter({
      binPath: BIN,
      daemonEntryPath: DAEMON_ENTRY,
      home: HOME,
      configDir: CONFIG,
      uid: 501,
      execPath: NODE,
      fs,
      spawn,
      log: vi.fn(),
      waitFn: vi.fn().mockResolvedValue(undefined),
    });

    await adapter.install();
    installCount++;

    // Snapshot the plists so the second install sees byte-identical content.
    const priorServer = fs.writes.get(SERVER_PLIST);
    const priorDaemon = fs.writes.get(DAEMON_PLIST);
    fs.writes.clear();
    fs.writes.set(SERVER_PLIST, priorServer ?? "");
    fs.writes.set(DAEMON_PLIST, priorDaemon ?? "");
    calls.length = 0;

    await adapter.install();

    // The unloaded daemon must be re-bootstrapped. No bootout should fire
    // because the plist on disk is already correct.
    const daemonBootstraps = calls.filter(
      (c) => c[1] === "bootstrap" && c[3] === DAEMON_PLIST,
    );
    const daemonBootouts = calls.filter(
      (c) => c[1] === "bootout" && c[3] === DAEMON_PLIST,
    );
    expect(daemonBootstraps).toHaveLength(1);
    expect(daemonBootouts).toHaveLength(0);
  });

  it("re-bootouts and re-bootstraps when only the daemon plist changed (server preserved)", async () => {
    const { adapter, fs, spawn } = mkAdapter();
    await adapter.install();
    const priorServer = fs.writes.get(SERVER_PLIST);
    fs.writes.set(DAEMON_PLIST, "<stale-daemon-plist/>");
    fs.writes.set(SERVER_PLIST, priorServer ?? "");
    spawn.calls.length = 0;
    await adapter.install();
    const daemonBootouts = spawn.calls.filter(
      (c) => c[1] === "bootout" && c[3] === DAEMON_PLIST,
    );
    const serverBootouts = spawn.calls.filter(
      (c) => c[1] === "bootout" && c[3] === SERVER_PLIST,
    );
    expect(daemonBootouts).toHaveLength(1);
    expect(serverBootouts).toHaveLength(0);
  });

  it("stops an unmanaged daemon at install time so launchd can take over", async () => {
    const daemonPidFile = `${CONFIG}/parasor-pty.pid`;
    const fs = mkFs();
    fs.writes.set(daemonPidFile, "26205\n");
    // No plist installed yet; user ran `parasor` manually first.
    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (
        cmd === "launchctl" &&
        args[0] === "print" &&
        args[1] === "gui/501/com.parasor.pty-host"
      ) {
        return { status: 113, stdout: "", stderr: "Could not find service" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const log = vi.fn();
    const killCalls: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    let probes = 0;
    const killProcess = vi.fn(
      (pid: number, signal: NodeJS.Signals | 0): boolean => {
        killCalls.push({ pid, signal });
        if (signal === 0) {
          probes++;
          return probes <= 1;
        }
        return true;
      },
    );
    const adapter = createDarwinAdapter({
      binPath: BIN,
      daemonEntryPath: DAEMON_ENTRY,
      home: HOME,
      configDir: CONFIG,
      uid: 501,
      execPath: NODE,
      fs,
      spawn,
      log,
      daemonPidFile,
      killProcess,
      waitFn: vi.fn().mockResolvedValue(undefined),
      sleepFn: vi.fn().mockResolvedValue(undefined),
    });
    await adapter.install();
    const lines = log.mock.calls.map((c) => c[0] as string);
    expect(
      lines.some((l) => /stopping unmanaged daemon \(pid 26205\)/.test(l)),
    ).toBe(true);
    expect(
      killCalls.some((c) => c.pid === 26205 && c.signal === "SIGTERM"),
    ).toBe(true);
    // Bootstrap still fires for the freshly-written plist.
    expect(fs.writes.has(DAEMON_PLIST)).toBe(true);
  });

  it("does not stop a launchd-managed daemon at install time", async () => {
    const daemonPidFile = `${CONFIG}/parasor-pty.pid`;
    const fs = mkFs();
    fs.writes.set(daemonPidFile, "26205\n");
    // launchctl print returns running -> daemon is launchd-managed.
    const spawn = vi.fn((_cmd: string, _args: string[]) => ({
      status: 0,
      stdout: "state = running\n",
      stderr: "",
    }));
    const killCalls: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    const killProcess = vi.fn(
      (pid: number, signal: NodeJS.Signals | 0): boolean => {
        killCalls.push({ pid, signal });
        return true;
      },
    );
    const adapter = createDarwinAdapter({
      binPath: BIN,
      daemonEntryPath: DAEMON_ENTRY,
      home: HOME,
      configDir: CONFIG,
      uid: 501,
      execPath: NODE,
      fs,
      spawn,
      log: vi.fn(),
      daemonPidFile,
      killProcess,
      waitFn: vi.fn().mockResolvedValue(undefined),
    });
    await adapter.install();
    // SIGTERM / SIGKILL must not have been sent.
    expect(killCalls.some((c) => c.signal !== 0)).toBe(false);
  });

  it("kickstarts the daemon after stopping an unmanaged process when plist is byte-equal and loaded", async () => {
    const daemonPidFile = `${CONFIG}/parasor-pty.pid`;
    const fs = mkFs();

    // First install: writes plist + bootstraps (set up byte-equal baseline).
    const initSpawn = mkSpawn();
    const init = createDarwinAdapter({
      binPath: BIN,
      daemonEntryPath: DAEMON_ENTRY,
      home: HOME,
      configDir: CONFIG,
      uid: 501,
      execPath: NODE,
      fs,
      spawn: initSpawn.spawn,
      log: vi.fn(),
      daemonPidFile,
      killProcess: vi.fn().mockReturnValue(true),
      waitFn: vi.fn().mockResolvedValue(undefined),
    });
    await init.install();

    // Snapshot the produced plist + simulate an unmanaged daemon pid file.
    const priorDaemon = fs.writes.get(DAEMON_PLIST);
    const priorServer = fs.writes.get(SERVER_PLIST);
    fs.writes.clear();
    fs.writes.set(DAEMON_PLIST, priorDaemon ?? "");
    fs.writes.set(SERVER_PLIST, priorServer ?? "");
    fs.writes.set(daemonPidFile, "26205\n");

    // Second install: launchctl says NOT running (unmanaged owns socket),
    // but the unit IS loaded. After stop, the heal path should kickstart.
    const calls: string[][] = [];
    const spawn2 = vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (
        cmd === "launchctl" &&
        args[0] === "print" &&
        args[1] === "gui/501/com.parasor.pty-host"
      ) {
        // status=0 with no "state = running" line -> loaded but not running.
        return { status: 0, stdout: "state = stopped\n", stderr: "" };
      }
      return { status: 0, stdout: "state = running\n", stderr: "" };
    });
    let probes = 0;
    const killProcess2 = vi.fn(
      (_pid: number, signal: NodeJS.Signals | 0): boolean => {
        if (signal === 0) {
          probes++;
          return probes <= 1;
        }
        return true;
      },
    );
    const adapter = createDarwinAdapter({
      binPath: BIN,
      daemonEntryPath: DAEMON_ENTRY,
      home: HOME,
      configDir: CONFIG,
      uid: 501,
      execPath: NODE,
      fs,
      spawn: spawn2,
      log: vi.fn(),
      daemonPidFile,
      killProcess: killProcess2,
      waitFn: vi.fn().mockResolvedValue(undefined),
      sleepFn: vi.fn().mockResolvedValue(undefined),
    });
    await adapter.install();

    const daemonKickstarts = calls.filter(
      (c) => c[1] === "kickstart" && c[3] === "gui/501/com.parasor.pty-host",
    );
    expect(daemonKickstarts).toHaveLength(1);
    // No daemon bootstrap (plist was unchanged + loaded).
    const daemonBootstraps = calls.filter(
      (c) => c[1] === "bootstrap" && c[3] === DAEMON_PLIST,
    );
    expect(daemonBootstraps).toHaveLength(0);
  });

  it("preserves prior daemon when server bootstrap fails on reinstall", async () => {
    const fs = mkFs();
    const PRIOR_DAEMON = "<prior-daemon-plist/>";
    fs.writes.set(DAEMON_PLIST, PRIOR_DAEMON);
    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (
        cmd === "launchctl" &&
        args[0] === "bootstrap" &&
        args[2] === SERVER_PLIST
      ) {
        return { status: 1, stdout: "", stderr: "port-in-use" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const { adapter } = mkAdapter({ fs, spawn });
    await expect(adapter.install()).rejects.toThrow(/server/);
    // Server rolled back; daemon must remain installed (it pre-existed)
    expect(fs.writes.has(SERVER_PLIST)).toBe(false);
    expect(fs.writes.has(DAEMON_PLIST)).toBe(true);
  });
});

describe("createDarwinAdapter uninstall", () => {
  it("removes both plists when present", async () => {
    const { adapter, fs } = mkAdapter();
    fs.writes.set(SERVER_PLIST, "server");
    fs.writes.set(DAEMON_PLIST, "daemon");
    await adapter.uninstall();
    expect(fs.removed).toContain(SERVER_PLIST);
    expect(fs.removed).toContain(DAEMON_PLIST);
  });

  it("removes the SERVER before the daemon (avoid PTY-host-disconnected banner)", async () => {
    const { adapter, fs } = mkAdapter();
    fs.writes.set(SERVER_PLIST, "server");
    fs.writes.set(DAEMON_PLIST, "daemon");
    await adapter.uninstall();
    expect(fs.removed.indexOf(SERVER_PLIST)).toBeLessThan(
      fs.removed.indexOf(DAEMON_PLIST),
    );
  });

  it("is idempotent when nothing is installed", async () => {
    const { adapter } = mkAdapter();
    await expect(adapter.uninstall()).resolves.toBeUndefined();
  });
});

describe("createDarwinAdapter restart", () => {
  it("default scope kicks only the server so daemon-owned PTYs survive", async () => {
    const { adapter, fs, spawn } = mkAdapter();
    fs.writes.set(SERVER_PLIST, "existing");
    fs.writes.set(DAEMON_PLIST, "existing");
    await adapter.restart({ all: false });
    const targets = spawn.calls
      .filter((c) => c[1] === "kickstart")
      .map((c) => c[3]);
    expect(targets).toEqual(["gui/501/com.parasor"]);
  });

  it("refuses server-only restart when launchd is not managing the live canonical daemon", async () => {
    const daemonPidFile = `${CONFIG}/parasor-pty.pid`;
    const fs = mkFs();
    fs.writes.set(SERVER_PLIST, "existing");
    fs.writes.set(DAEMON_PLIST, "existing");
    fs.writes.set(daemonPidFile, "26205\n");
    const calls: string[][] = [];
    const spawn = vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (
        cmd === "launchctl" &&
        args[0] === "print" &&
        args[1] === "gui/501/com.parasor.pty-host"
      ) {
        return { status: 113, stdout: "", stderr: "Could not find service" };
      }
      return { status: 0, stdout: "state = running\n", stderr: "" };
    });
    const adapter = createDarwinAdapter({
      binPath: BIN,
      daemonEntryPath: DAEMON_ENTRY,
      home: HOME,
      configDir: CONFIG,
      uid: 501,
      execPath: NODE,
      fs,
      spawn,
      log: vi.fn(),
      daemonPidFile,
      killProcess: vi.fn().mockReturnValue(true),
      waitFn: vi.fn().mockResolvedValue(undefined),
    });

    await expect(adapter.restart({ all: false })).rejects.toThrow(
      /refusing server-only restart/,
    );
    const kickstarts = calls.filter((c) => c[1] === "kickstart");
    expect(kickstarts).toHaveLength(0);
  });

  it("--all kicks both the daemon and the server (daemon first)", async () => {
    const { adapter, fs, spawn } = mkAdapter();
    fs.writes.set(SERVER_PLIST, "existing");
    fs.writes.set(DAEMON_PLIST, "existing");
    await adapter.restart({ all: true });
    const targets = spawn.calls
      .filter((c) => c[1] === "kickstart")
      .map((c) => c[3]);
    expect(targets).toEqual([
      "gui/501/com.parasor.pty-host",
      "gui/501/com.parasor",
    ]);
  });

  it("restarts only what is installed", async () => {
    const { adapter, fs, spawn } = mkAdapter();
    fs.writes.set(SERVER_PLIST, "existing");
    await adapter.restart({ all: true });
    const targets = spawn.calls
      .filter((c) => c[1] === "kickstart")
      .map((c) => c[3]);
    expect(targets).toEqual(["gui/501/com.parasor"]);
  });

  it("guard error includes the root-cause hint about manual `parasor`", async () => {
    const daemonPidFile = `${CONFIG}/parasor-pty.pid`;
    const fs = mkFs();
    fs.writes.set(SERVER_PLIST, "existing");
    fs.writes.set(DAEMON_PLIST, "existing");
    fs.writes.set(daemonPidFile, "26205\n");
    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (
        cmd === "launchctl" &&
        args[0] === "print" &&
        args[1] === "gui/501/com.parasor.pty-host"
      ) {
        return { status: 113, stdout: "", stderr: "Could not find service" };
      }
      return { status: 0, stdout: "state = running\n", stderr: "" };
    });
    const adapter = createDarwinAdapter({
      binPath: BIN,
      daemonEntryPath: DAEMON_ENTRY,
      home: HOME,
      configDir: CONFIG,
      uid: 501,
      execPath: NODE,
      fs,
      spawn,
      log: vi.fn(),
      daemonPidFile,
      killProcess: vi.fn().mockReturnValue(true),
      waitFn: vi.fn().mockResolvedValue(undefined),
    });
    await expect(adapter.restart({ all: false })).rejects.toThrow(
      /started manually before installing the service/,
    );
  });

  it("--all stops unmanaged daemon then bootstraps when launchd is not managing it", async () => {
    const daemonPidFile = `${CONFIG}/parasor-pty.pid`;
    const fs = mkFs();
    fs.writes.set(SERVER_PLIST, "existing");
    fs.writes.set(DAEMON_PLIST, "existing");
    fs.writes.set(daemonPidFile, "26205\n");

    let printCount = 0;
    const calls: string[][] = [];
    const spawn = vi.fn((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (
        cmd === "launchctl" &&
        args[0] === "print" &&
        args[1] === "gui/501/com.parasor.pty-host"
      ) {
        printCount++;
        // Unmanaged the whole time -> kickstart unreachable, bootstrap path.
        return { status: 113, stdout: "", stderr: "Could not find service" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });

    // Simulate the unmanaged daemon dying after SIGTERM: first liveness probe
    // says alive (true), subsequent probes return dead (false).
    const killCalls: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    let probes = 0;
    const killProcess = vi.fn(
      (pid: number, signal: NodeJS.Signals | 0): boolean => {
        killCalls.push({ pid, signal });
        if (signal === 0) {
          probes++;
          return probes <= 1; // alive once, then gone
        }
        return true; // signal delivery succeeded
      },
    );

    const adapter = createDarwinAdapter({
      binPath: BIN,
      daemonEntryPath: DAEMON_ENTRY,
      home: HOME,
      configDir: CONFIG,
      uid: 501,
      execPath: NODE,
      fs,
      spawn,
      log: vi.fn(),
      daemonPidFile,
      killProcess,
      waitFn: vi.fn().mockResolvedValue(undefined),
      sleepFn: vi.fn().mockResolvedValue(undefined),
    });

    await adapter.restart({ all: true });

    // SIGTERM sent to the unmanaged pid before launchctl bootstrap fires.
    const sigterm = killCalls.find(
      (c) => c.pid === 26205 && c.signal === "SIGTERM",
    );
    expect(sigterm).toBeTruthy();
    // SIGKILL must NOT fire when SIGTERM succeeds.
    expect(killCalls.some((c) => c.signal === "SIGKILL")).toBe(false);

    // Daemon path is bootstrap (not kickstart) because isLoaded=false.
    const daemonBootstraps = calls.filter(
      (c) => c[1] === "bootstrap" && c[3] === DAEMON_PLIST,
    );
    expect(daemonBootstraps).toHaveLength(1);
    const daemonKickstarts = calls.filter(
      (c) => c[1] === "kickstart" && c[3] === "gui/501/com.parasor.pty-host",
    );
    expect(daemonKickstarts).toHaveLength(0);
    // Server still kickstarts after the daemon socket is ready.
    const serverKickstarts = calls.filter(
      (c) => c[1] === "kickstart" && c[3] === "gui/501/com.parasor",
    );
    expect(serverKickstarts).toHaveLength(1);
    // The unmanaged-state print + the post-stop isLoaded probe both fire.
    expect(printCount).toBeGreaterThanOrEqual(2);
  });

  it("--all escalates SIGTERM to SIGKILL when the unmanaged daemon refuses to die", async () => {
    const daemonPidFile = `${CONFIG}/parasor-pty.pid`;
    const fs = mkFs();
    fs.writes.set(SERVER_PLIST, "existing");
    fs.writes.set(DAEMON_PLIST, "existing");
    fs.writes.set(daemonPidFile, "26205\n");

    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (
        cmd === "launchctl" &&
        args[0] === "print" &&
        args[1] === "gui/501/com.parasor.pty-host"
      ) {
        return { status: 113, stdout: "", stderr: "Could not find service" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });

    const killCalls: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
    let dead = false;
    const killProcess = vi.fn(
      (pid: number, signal: NodeJS.Signals | 0): boolean => {
        killCalls.push({ pid, signal });
        if (signal === 0) return !dead;
        if (signal === "SIGKILL") {
          dead = true;
          return true;
        }
        // SIGTERM ignored -- daemon does not die.
        return true;
      },
    );

    // Drive a virtual clock so the SIGTERM/SIGKILL deadline loops don't wait
    // 5s/2s of wall-clock time. Each sleepFn call advances "now" by the
    // requested poll interval, matching production semantics without delay.
    let virtualNow = 0;
    const sleepFn = vi.fn(async (ms: number) => {
      virtualNow += ms;
    });
    const nowFn = () => virtualNow;

    const adapter = createDarwinAdapter({
      binPath: BIN,
      daemonEntryPath: DAEMON_ENTRY,
      home: HOME,
      configDir: CONFIG,
      uid: 501,
      execPath: NODE,
      fs,
      spawn,
      log: vi.fn(),
      daemonPidFile,
      killProcess,
      waitFn: vi.fn().mockResolvedValue(undefined),
      sleepFn,
      nowFn,
    });

    await adapter.restart({ all: true });

    expect(killCalls.some((c) => c.signal === "SIGTERM")).toBe(true);
    expect(killCalls.some((c) => c.signal === "SIGKILL")).toBe(true);
  });
});

describe("createDarwinAdapter status", () => {
  it("reports pty-host before server", async () => {
    const log = vi.fn();
    const { adapter, fs } = mkAdapter({ log });
    fs.writes.set(SERVER_PLIST, "server");
    fs.writes.set(DAEMON_PLIST, "daemon");
    await adapter.status();
    const lines = log.mock.calls.map((c) => c[0] as string);
    const ptyHostIdx = lines.findIndex((l) => l.startsWith("pty-host:"));
    const serverIdx = lines.findIndex((l) => l.startsWith("server:"));
    expect(ptyHostIdx).toBeGreaterThanOrEqual(0);
    expect(serverIdx).toBeGreaterThan(ptyHostIdx);
  });
});

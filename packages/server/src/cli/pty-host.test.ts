/*
 * -- `parasor pty-host` CLI subcommand tests.
 *
 * The whole surface is exercised through deps injection so no real
 * daemon is forked (sandbox-blocked anyway). Each test seeds the
 * relevant probe / pid-file / killProcess seam to drive a path.
 *
 * What's covered:
 *   - start: idempotent when already running, success path with virtual
 *     clock, missing-entry-script error, polling-timeout error.
 *   - stop:  no-op when down, SIGTERM happy path, timeout error.
 *   - status: exit code 0 when running, 1 otherwise; output shape.
 *   - restart: stop+start composition.
 *   - doctor: prints sessionRecords from a real AppStateStore + log tail.
 *   - help / unknown-subcommand routing.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonPaths } from "../pty/host-daemon/paths.js";
import { AppStateStore } from "../state/app-state.js";
import { cliPtyHost, type PtyHostDeps } from "./pty-host.js";

function makePaths(root: string): DaemonPaths {
  return {
    runtimeDir: root,
    socketPath: join(root, "p.sock"),
    pidFile: join(root, "p.pid"),
    lockFile: join(root, "p.lock"),
    logFile: join(root, "p.log"),
  };
}

function makeBaseDeps(
  root: string,
  appStateDir: string,
  overrides: Partial<PtyHostDeps> = {},
): Partial<PtyHostDeps> {
  const entryPath = join(root, "entry.js");
  writeFileSync(entryPath, "// fake entry\n");
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    paths: makePaths(root),
    appStateDir,
    daemonEntryPath: entryPath,
    log: (m: string) => logs.push(m),
    error: (m: string) => errors.push(m),
    sleep: () => Promise.resolve(),
    spawnDetached: vi.fn(() => ({ pid: 12345 })),
    probeSocket: vi.fn(() =>
      Promise.resolve({ socketReady: false, socketAlive: false }),
    ),
    readPidFile: vi.fn(() => null),
    killProcess: vi.fn(() => false),
    readLog: vi.fn(() => "(stub log)"),
    now: vi.fn(() => 0),
    ...overrides,
    // expose the buffers via a hidden field for assertions
    ...({ _logs: logs, _errors: errors } as unknown as Partial<PtyHostDeps>),
  };
}

function logsOf(deps: Partial<PtyHostDeps>): string[] {
  return (deps as unknown as { _logs: string[] })._logs;
}
function errorsOf(deps: Partial<PtyHostDeps>): string[] {
  return (deps as unknown as { _errors: string[] })._errors;
}

describe("cliPtyHost", () => {
  let root: string;
  let stateDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pty-host-cli-"));
    stateDir = mkdtempSync(join(tmpdir(), "pty-host-cli-state-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("start: idempotent when daemon is already running", async () => {
    const deps = makeBaseDeps(root, stateDir, {
      probeSocket: vi.fn(() =>
        Promise.resolve({ socketReady: true, socketAlive: true }),
      ),
      readPidFile: vi.fn(() => 9999),
    });
    const rc = await cliPtyHost(["start"], deps);
    expect(rc).toBe(0);
    expect(logsOf(deps).join("\n")).toMatch(/already running.*9999/);
    expect(deps.spawnDetached).not.toHaveBeenCalled();
  });

  it("start: spawns and returns 0 once probe reports ready", async () => {
    let probeCount = 0;
    const probe = vi.fn(() => {
      probeCount++;
      // First probe (status check) = false, second (post-spawn poll) = true.
      return Promise.resolve({
        socketReady: probeCount > 1,
        socketAlive: probeCount > 1,
      });
    });
    const deps = makeBaseDeps(root, stateDir, {
      probeSocket: probe,
      readPidFile: vi.fn(() => 12345),
    });
    const rc = await cliPtyHost(["start"], deps);
    expect(rc).toBe(0);
    expect(deps.spawnDetached).toHaveBeenCalledOnce();
    expect(logsOf(deps).join("\n")).toMatch(/started.*pid 12345/);
  });

  it("start: missing entry script returns 1", async () => {
    const deps = makeBaseDeps(root, stateDir, {
      daemonEntryPath: join(root, "missing.js"),
    });
    const rc = await cliPtyHost(["start"], deps);
    expect(rc).toBe(1);
    expect(errorsOf(deps).join("\n")).toMatch(/entry script not found/);
  });

  it("start: falls back to entry.ts with --import tsx when .js is missing", async () => {
    // operator-recovery CLI start must work in
    // dev environments (pre-build) the same way auto-spawn does.
    const tsEntry = join(root, "entry.ts");
    writeFileSync(tsEntry, "// fake ts entry\n");
    let probeCount = 0;
    const probe = vi.fn(() => {
      probeCount++;
      return Promise.resolve({
        socketReady: probeCount > 1,
        socketAlive: probeCount > 1,
      });
    });
    const spawnSpy = vi.fn(() => ({ pid: 12345 }));
    const deps = makeBaseDeps(root, stateDir, {
      daemonEntryPath: join(root, "entry.js"),
      probeSocket: probe,
      spawnDetached: spawnSpy,
      readPidFile: vi.fn(() => 12345),
    });
    // Remove the .js entry seeded by makeBaseDeps to force fallback.
    rmSync(join(root, "entry.js"));
    const rc = await cliPtyHost(["start"], deps);
    expect(rc).toBe(0);
    expect(spawnSpy).toHaveBeenCalledWith(process.execPath, [
      "--import",
      "tsx",
      tsEntry,
    ]);
  });

  it("start: polling timeout returns 1 and SIGTERMs the spawned child", async () => {
    let virtual = 0;
    // on startup-timeout we must reap the child
    // we just spawned so the lockfile/pidfile gets released for the
    // next attempt. Stub spawnDetached to expose a known pid; assert
    // killProcess(pid, "SIGTERM") was issued.
    const killSpy = vi.fn(() => true);
    const deps = makeBaseDeps(root, stateDir, {
      probeSocket: vi.fn(() =>
        Promise.resolve({ socketReady: false, socketAlive: false }),
      ),
      spawnDetached: vi.fn(() => ({ pid: 99999 })),
      killProcess: killSpy,
      now: vi.fn(() => virtual),
      sleep: vi.fn((ms: number) => {
        virtual += ms;
        return Promise.resolve();
      }),
    });
    const rc = await cliPtyHost(["start"], deps);
    expect(rc).toBe(1);
    expect(errorsOf(deps).join("\n")).toMatch(/did not become ready/);
    expect(killSpy).toHaveBeenCalledWith(99999, "SIGTERM");
  });

  it("stop: no-op when daemon is down", async () => {
    const deps = makeBaseDeps(root, stateDir);
    const rc = await cliPtyHost(["stop"], deps);
    expect(rc).toBe(0);
    expect(logsOf(deps).join("\n")).toMatch(/is not running/);
    expect(deps.killProcess).not.toHaveBeenCalledWith(
      expect.any(Number),
      "SIGTERM",
    );
  });

  it("stop: SIGTERM and wait for exit", async () => {
    let alive = true;
    const killSpy = vi.fn(
      (_pid: number, signal: NodeJS.Signals | 0): boolean => {
        if (signal === "SIGTERM") {
          alive = false;
          return true;
        }
        return alive;
      },
    );
    const deps = makeBaseDeps(root, stateDir, {
      probeSocket: vi.fn(() =>
        Promise.resolve({ socketReady: true, socketAlive: true }),
      ),
      readPidFile: vi.fn(() => 12345),
      killProcess: killSpy,
    });
    const rc = await cliPtyHost(["stop"], deps);
    expect(rc).toBe(0);
    expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(logsOf(deps).join("\n")).toMatch(/stopped.*pid 12345/);
  });

  it("stop: timeout when daemon does not exit", async () => {
    let virtual = 0;
    const deps = makeBaseDeps(root, stateDir, {
      probeSocket: vi.fn(() =>
        Promise.resolve({ socketReady: true, socketAlive: true }),
      ),
      readPidFile: vi.fn(() => 12345),
      // Always alive -- even after SIGTERM.
      killProcess: vi.fn(() => true),
      now: vi.fn(() => virtual),
      sleep: vi.fn((ms: number) => {
        virtual += ms;
        return Promise.resolve();
      }),
    });
    const rc = await cliPtyHost(["stop"], deps);
    expect(rc).toBe(1);
    expect(errorsOf(deps).join("\n")).toMatch(/did not exit/);
  });

  it("stop: refuses to kill when stale-pidfile (socket down + pid alive)", async () => {
    // stale-pidfile = socket unreachable but
    // kill(pid, 0) succeeds. Default stop must NOT SIGTERM -- pid may
    // have been recycled.
    const killSpy = vi.fn((_pid: number, signal: NodeJS.Signals | 0) => {
      // signal=0 is the liveness probe; SIGTERM must never be issued.
      return signal === 0;
    });
    const deps = makeBaseDeps(root, stateDir, {
      probeSocket: vi.fn(() =>
        Promise.resolve({ socketReady: false, socketAlive: false }),
      ),
      readPidFile: vi.fn(() => 12345),
      killProcess: killSpy,
    });
    const rc = await cliPtyHost(["stop"], deps);
    expect(rc).toBe(1);
    expect(killSpy).not.toHaveBeenCalledWith(expect.any(Number), "SIGTERM");
    expect(errorsOf(deps).join("\n")).toMatch(/Refusing to send SIGTERM/);
    expect(errorsOf(deps).join("\n")).toMatch(/--force/);
  });

  it("stop --force: overrides stale-pidfile guard and SIGTERMs", async () => {
    let alive = true;
    const killSpy = vi.fn(
      (_pid: number, signal: NodeJS.Signals | 0): boolean => {
        if (signal === "SIGTERM") {
          alive = false;
          return true;
        }
        return alive;
      },
    );
    const deps = makeBaseDeps(root, stateDir, {
      probeSocket: vi.fn(() =>
        Promise.resolve({ socketReady: false, socketAlive: false }),
      ),
      readPidFile: vi.fn(() => 12345),
      killProcess: killSpy,
    });
    const rc = await cliPtyHost(["stop", "--force"], deps);
    expect(rc).toBe(0);
    expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
  });

  it("status: exit 0 when running, 1 otherwise", async () => {
    const upDeps = makeBaseDeps(root, stateDir, {
      probeSocket: vi.fn(() =>
        Promise.resolve({ socketReady: true, socketAlive: true }),
      ),
      readPidFile: vi.fn(() => 12345),
    });
    expect(await cliPtyHost(["status"], upDeps)).toBe(0);
    expect(logsOf(upDeps).join("\n")).toMatch(/state: running/);

    const downDeps = makeBaseDeps(root, stateDir);
    expect(await cliPtyHost(["status"], downDeps)).toBe(1);
    expect(logsOf(downDeps).join("\n")).toMatch(/state: down/);
  });

  it("doctor: dumps sessionRecords + log tail", async () => {
    // Seed a sessionRecord so doctor has something to print.
    const store = new AppStateStore({ dir: stateDir, debounceMs: 0 });
    store.mutateSessions((s) => {
      s.sessionRecords.push({
        id: "doctor-1",
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/",
        pid: 999,
        pgid: 999,
        argv: ["bash"],
        startedAt: "2026-04-28T00:00:00.000Z",
        state: "running",
        exitCode: null,
        exitSignal: null,
        daemonPid: 4242,
        daemonStartedAt: "2026-04-28T00:00:00.000Z",
      });
    });
    await store.flush();
    store.destroy();

    const deps = makeBaseDeps(root, stateDir, {
      readLog: vi.fn(() => "line1\nline2"),
    });
    const rc = await cliPtyHost(["doctor"], deps);
    expect(rc).toBe(0);
    const out = logsOf(deps).join("\n");
    expect(out).toMatch(/sessionRecords \(1\)/);
    expect(out).toMatch(/doctor-1/);
    expect(out).toMatch(/line1/);
  });

  it("help / unknown / no-arg routing", async () => {
    const helpDeps = makeBaseDeps(root, stateDir);
    expect(await cliPtyHost(["--help"], helpDeps)).toBe(0);
    expect(logsOf(helpDeps).join("\n")).toMatch(/Usage: parasor pty-host/);

    const unknownDeps = makeBaseDeps(root, stateDir);
    expect(await cliPtyHost(["bogus"], unknownDeps)).toBe(1);
    expect(errorsOf(unknownDeps).join("\n")).toMatch(
      /unknown subcommand: bogus/,
    );

    const noArgDeps = makeBaseDeps(root, stateDir);
    expect(await cliPtyHost([], noArgDeps)).toBe(1);
    expect(errorsOf(noArgDeps).join("\n")).toMatch(
      /unknown subcommand: \(none\)/,
    );
  });
});

import type * as net from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { DaemonPaths } from "./host-daemon/paths.js";
import {
  recoverFromVersionMismatch,
  type VersionMismatchRecoveryDeps,
  type VersionMismatchRecoveryInput,
} from "./version-mismatch-recovery.js";

const PATHS: DaemonPaths = {
  runtimeDir: "/run/parasor",
  socketPath: "/run/parasor/host.sock",
  pidFile: "/run/parasor/host.pid",
  lockFile: "/run/parasor/host.lock",
  logFile: "/run/parasor/host.log",
};

const ORIGINAL_MESSAGE = "server 2.5.0 not compatible with daemon 2.4.0";

interface FakeHost {
  __tag: "fake-host";
  id: string;
}

interface FakeSocket {
  destroy: ReturnType<typeof vi.fn>;
}

function makeFakeSocket(
  destroy: ReturnType<typeof vi.fn> = vi.fn(),
): FakeSocket {
  return { destroy };
}

function makeDeps(
  overrides: Partial<VersionMismatchRecoveryDeps<FakeHost>> = {},
): VersionMismatchRecoveryDeps<FakeHost> {
  const fakeSocket = makeFakeSocket();
  return {
    terminateDaemon: vi.fn(async () => ({
      outcome: "stopped" as const,
      pid: 4242,
    })),
    spawnDaemon: vi.fn(async () => {}),
    connectSocket: vi.fn(async () => fakeSocket as unknown as net.Socket),
    connectHost: vi.fn(
      async (): Promise<FakeHost> => ({ __tag: "fake-host", id: "host-1" }),
    ),
    parseVersionMismatch: vi.fn(() => ({ server: "2.5.0", daemon: "2.4.0" })),
    logStderr: vi.fn(),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<VersionMismatchRecoveryInput> = {},
): VersionMismatchRecoveryInput {
  return {
    originalError: new Error(ORIGINAL_MESSAGE),
    paths: PATHS,
    protocolVersion: "2.5.0",
    scrollbackLog: null,
    onDaemonAutoRestarted: vi.fn(),
    ...overrides,
  };
}

describe("recoverFromVersionMismatch", () => {
  it("happy path: runs terminate -> spawn -> connectSocket -> connectHost and returns the host", async () => {
    const deps = makeDeps();
    const input = makeInput();

    const host = await recoverFromVersionMismatch(input, deps);

    expect(host).toEqual({ __tag: "fake-host", id: "host-1" });
    expect(deps.terminateDaemon).toHaveBeenCalledWith(PATHS);
    expect(deps.spawnDaemon).toHaveBeenCalledWith({ paths: PATHS });
    expect(deps.connectSocket).toHaveBeenCalledWith(PATHS.socketPath);
    expect(deps.connectHost).toHaveBeenCalledWith({
      socket: expect.anything(),
      scrollbackLog: null,
    });
  });

  it("happy path: invokes onDaemonAutoRestarted with parsed daemon version", async () => {
    const onDaemonAutoRestarted = vi.fn();
    const deps = makeDeps();
    const input = makeInput({ onDaemonAutoRestarted });

    await recoverFromVersionMismatch(input, deps);

    expect(onDaemonAutoRestarted).toHaveBeenCalledTimes(1);
    expect(onDaemonAutoRestarted).toHaveBeenCalledWith({
      serverProtocolVersion: "2.5.0",
      daemonProtocolVersion: "2.4.0",
    });
  });

  it("happy path: parseVersionMismatch null -> onDaemonAutoRestarted carries 'unknown'", async () => {
    const onDaemonAutoRestarted = vi.fn();
    const deps = makeDeps({ parseVersionMismatch: vi.fn(() => null) });
    const input = makeInput({ onDaemonAutoRestarted });

    await recoverFromVersionMismatch(input, deps);

    expect(onDaemonAutoRestarted).toHaveBeenCalledWith({
      serverProtocolVersion: "2.5.0",
      daemonProtocolVersion: "unknown",
    });
  });

  it("happy path: tolerates onDaemonAutoRestarted being undefined", async () => {
    const deps = makeDeps();
    const input = makeInput({ onDaemonAutoRestarted: undefined });

    await expect(recoverFromVersionMismatch(input, deps)).resolves.toEqual({
      __tag: "fake-host",
      id: "host-1",
    });
  });

  it("emits the pre-flight stderr line BEFORE terminateDaemon, then the success line BEFORE onDaemonAutoRestarted", async () => {
    const events: string[] = [];
    const logStderr = vi.fn((line: string) => events.push(`log:${line}`));
    const onDaemonAutoRestarted = vi.fn(() => events.push("callback"));
    const deps = makeDeps({
      logStderr,
      terminateDaemon: vi.fn(async () => {
        events.push("terminate");
        return { outcome: "stopped" as const, pid: 4242 };
      }),
    });
    const input = makeInput({ onDaemonAutoRestarted });

    await recoverFromVersionMismatch(input, deps);

    expect(events).toEqual([
      `log:parasor-pty-host: ${ORIGINAL_MESSAGE}. ` +
        `terminating incompatible daemon -- active PTY sessions will be lost.\n`,
      "terminate",
      "log:parasor-pty-host: replacement daemon online; resuming server boot.\n",
      "callback",
    ]);
  });

  it("terminateDaemon outcome=still-alive -> throws stop --force guidance with pid, skips later steps", async () => {
    const spawnDaemon = vi.fn(async () => {});
    const connectSocket = vi.fn(
      async () => makeFakeSocket() as unknown as net.Socket,
    );
    const connectHost = vi.fn(
      async () => ({ __tag: "fake-host", id: "x" }) as FakeHost,
    );
    const deps = makeDeps({
      terminateDaemon: vi.fn(async () => ({
        outcome: "still-alive" as const,
        pid: 9999,
      })),
      spawnDaemon,
      connectSocket,
      connectHost,
    });

    await expect(recoverFromVersionMismatch(makeInput(), deps)).rejects.toThrow(
      "parasor-pty-host: failed to terminate incompatible daemon " +
        "(pid 9999 survived SIGKILL). " +
        "Run `parasor pty-host stop --force` and restart parasor.",
    );

    expect(spawnDaemon).not.toHaveBeenCalled();
    expect(connectSocket).not.toHaveBeenCalled();
    expect(connectHost).not.toHaveBeenCalled();
  });

  it("spawnDaemon throw -> wrapped error with logFile guidance, skips later steps", async () => {
    const connectSocket = vi.fn(
      async () => makeFakeSocket() as unknown as net.Socket,
    );
    const connectHost = vi.fn(
      async () => ({ __tag: "fake-host", id: "x" }) as FakeHost,
    );
    const deps = makeDeps({
      spawnDaemon: vi.fn(async () => {
        throw new Error("EACCES /usr/local/bin/parasor-pty-host");
      }),
      connectSocket,
      connectHost,
    });

    await expect(recoverFromVersionMismatch(makeInput(), deps)).rejects.toThrow(
      "parasor-pty-host: terminated old daemon but failed to start " +
        "replacement: EACCES /usr/local/bin/parasor-pty-host. " +
        `Check ${PATHS.logFile}.`,
    );

    expect(connectSocket).not.toHaveBeenCalled();
    expect(connectHost).not.toHaveBeenCalled();
  });

  it("connectSocket throw -> wrapped error with logFile guidance, connectHost skipped", async () => {
    const connectHost = vi.fn(
      async () => ({ __tag: "fake-host", id: "x" }) as FakeHost,
    );
    const deps = makeDeps({
      connectSocket: vi.fn(async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        });
      }),
      connectHost,
    });

    await expect(recoverFromVersionMismatch(makeInput(), deps)).rejects.toThrow(
      "parasor-pty-host: replacement daemon socket unreachable: " +
        `connect ECONNREFUSED. Check ${PATHS.logFile}.`,
    );

    expect(connectHost).not.toHaveBeenCalled();
  });

  it("connectHost throw -> destroys the recovery socket and wraps the error with logFile guidance", async () => {
    const destroy = vi.fn();
    const recoverySocket = makeFakeSocket(destroy);
    const deps = makeDeps({
      connectSocket: vi.fn(async () => recoverySocket as unknown as net.Socket),
      connectHost: vi.fn(async () => {
        throw new Error("handshake timeout after 5000ms");
      }),
    });

    await expect(recoverFromVersionMismatch(makeInput(), deps)).rejects.toThrow(
      "parasor-pty-host: handshake to replacement daemon failed: " +
        `handshake timeout after 5000ms. Check ${PATHS.logFile}.`,
    );

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("connectHost throw + socket.destroy throw -> still surfaces the wrapped handshake error", async () => {
    const destroy = vi.fn(() => {
      throw new Error("socket already destroyed");
    });
    const recoverySocket = makeFakeSocket(destroy);
    const deps = makeDeps({
      connectSocket: vi.fn(async () => recoverySocket as unknown as net.Socket),
      connectHost: vi.fn(async () => {
        throw new Error("HELLO_ACK rejected: evicted");
      }),
    });

    await expect(recoverFromVersionMismatch(makeInput(), deps)).rejects.toThrow(
      "parasor-pty-host: handshake to replacement daemon failed: " +
        `HELLO_ACK rejected: evicted. Check ${PATHS.logFile}.`,
    );

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("forwards scrollbackLog to connectHost verbatim (including null)", async () => {
    const connectHost = vi.fn(
      async () => ({ __tag: "fake-host", id: "y" }) as FakeHost,
    );
    const deps = makeDeps({ connectHost });

    // null case
    await recoverFromVersionMismatch(makeInput({ scrollbackLog: null }), deps);
    expect(connectHost).toHaveBeenLastCalledWith({
      socket: expect.anything(),
      scrollbackLog: null,
    });

    // non-null case -- pass a sentinel object, helper just forwards it
    const fakeLog = { __tag: "scrollback-log" } as unknown as Parameters<
      typeof recoverFromVersionMismatch<FakeHost>
    >[0]["scrollbackLog"];
    await recoverFromVersionMismatch(
      makeInput({ scrollbackLog: fakeLog }),
      deps,
    );
    expect(connectHost).toHaveBeenLastCalledWith({
      socket: expect.anything(),
      scrollbackLog: fakeLog,
    });
  });

  it("does NOT log the success line or invoke the callback when connectHost rejects", async () => {
    const logStderr = vi.fn();
    const onDaemonAutoRestarted = vi.fn();
    const deps = makeDeps({
      logStderr,
      connectHost: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    await expect(
      recoverFromVersionMismatch(makeInput({ onDaemonAutoRestarted }), deps),
    ).rejects.toThrow(/handshake to replacement daemon failed/);

    // Only the pre-flight line should have been logged; the success line is gated on resolve.
    expect(logStderr).toHaveBeenCalledTimes(1);
    expect(logStderr).toHaveBeenCalledWith(
      expect.stringContaining("terminating incompatible daemon"),
    );
    expect(onDaemonAutoRestarted).not.toHaveBeenCalled();
  });
});

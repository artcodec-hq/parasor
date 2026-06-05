import { mkdtempSync, rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import { createPtyHost, type PtyHost, resolvePtyHostMode } from "./host.js";
import { PtyHostDaemon } from "./host-daemon/daemon.js";
import { InProcessPtyHost } from "./in-process-host.js";
import { RemotePtyHost } from "./remote-host.js";

/*
 * Contract tests for the `PtyHost` interface.
 *
 * Purpose: anything that calls itself a `PtyHost` MUST satisfy these
 * assertions. Today the only impl exercised here is `InProcessPtyHost`;
 * once `RemotePtyHost` lands (remote PTY host) it is added to the
 * `IMPLEMENTATIONS` array and the same suite runs against it.
 *
 * The matrix in `host.ts` allows Remote impls to surface state via
 * SESSION_LIST broadcast that may *trail* the create() ack. The contract
 * therefore uses the `eventually()` helper for visibility checks so an
 * InProcessPtyHost (sync emit) and a future Remote impl (commit < ack <
 * broadcast) can both satisfy the same suite. In-process resolves on the
 * first check; Remote polls until the timeout fires.
 *
 * Spawn-dependent behavior (`testEagerSpawn`, write/resize, real PTY
 * exit signals) is exercised per-implementation in the impl-specific
 * suites -- not at the contract layer -- since `RemotePtyHost` cannot
 * spawn locally and `InProcessPtyHost` cannot run under a sandboxed
 * test environment that blocks `posix_openpt`.
 */

async function eventually<T>(
  fn: () => T | undefined,
  timeoutMs = 500,
  intervalMs = 5,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = fn();
    if (result !== undefined) return result;
    if (Date.now() >= deadline) {
      throw new Error(`eventually() timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

interface HostFactory {
  name: string;
  make(): Promise<{ host: PtyHost; cleanup: () => Promise<void> | void }>;
}

const CWD = process.env.HOME ?? "/";

const IMPLEMENTATIONS: HostFactory[] = [
  {
    name: "InProcessPtyHost (direct construction)",
    make: async () => {
      const dir = mkdtempSync(join(tmpdir(), "pty-host-contract-"));
      const store = new AppStateStore({ dir, debounceMs: 0 });
      const host = new InProcessPtyHost(store);
      return {
        host,
        cleanup: async () => {
          await host.disposeAll();
          store.destroy();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
  {
    name: "InProcessPtyHost (createPtyHost factory)",
    make: async () => {
      const dir = mkdtempSync(join(tmpdir(), "pty-host-contract-factory-"));
      const store = new AppStateStore({ dir, debounceMs: 0 });
      const host = await createPtyHost({ store, mode: "in-process" });
      return {
        host,
        cleanup: async () => {
          await host.disposeAll();
          store.destroy();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
  {
    /*
     * RemotePtyHost paired with PtyHostDaemon over a real loopback TCP
     * socket -- same wire protocol, same fence semantics -- wrapping a
     * real InProcessPtyHost on the daemon side. The contract suite only
     * touches non-spawn behavior (create() returns spawning; initClient
     * with a missing id returns false; etc.), which works inside the
     * sandbox because InProcessPtyHost.create() does not spawn until
     * testEagerSpawn / initClient triggers it.
     */
    name: "RemotePtyHost (over PtyHostDaemon + InProcessPtyHost)",
    make: async () => {
      const dir = mkdtempSync(join(tmpdir(), "pty-host-contract-remote-"));
      const store = new AppStateStore({ dir, debounceMs: 0 });
      const inProcess = new InProcessPtyHost(store);
      const server = net.createServer();
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const port = (server.address() as net.AddressInfo).port;
      const accepted = new Promise<net.Socket>((resolve) =>
        server.once("connection", resolve),
      );
      const clientSocket = net.connect(port, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        clientSocket.once("connect", resolve);
        clientSocket.once("error", reject);
      });
      const daemonSocket = await accepted;
      const daemon = new PtyHostDaemon({ host: inProcess });
      daemon.acceptConnection(daemonSocket);
      const remote = await RemotePtyHost.connect({
        socket: clientSocket,
        requestTimeoutMs: 2000,
      });
      return {
        host: remote,
        cleanup: async () => {
          daemon.dispose();
          clientSocket.destroy();
          daemonSocket.destroy();
          await new Promise<void>((resolve) => server.close(() => resolve()));
          await inProcess.disposeAll();
          store.destroy();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
];

for (const impl of IMPLEMENTATIONS) {
  describe(`PtyHost contract -- ${impl.name}`, () => {
    let host: PtyHost;
    let cleanup: () => Promise<void> | void;

    beforeEach(async () => {
      const made = await impl.make();
      host = made.host;
      cleanup = made.cleanup;
    });

    afterEach(async () => {
      await cleanup();
    });

    it("create() resolves with a Session in `spawning` state with no pid", async () => {
      const session = await host.create({
        projectId: "proj-1",
        command: { type: "shell" },
        cwd: CWD,
      });
      expect(session.projectId).toBe("proj-1");
      expect(session.state).toBe("spawning");
      expect(session.pid).toBeNull();
      expect(session.generation).toBeGreaterThanOrEqual(1);
    });

    it("get()/list() eventually reflect a freshly-created session", async () => {
      const a = await host.create({
        projectId: "proj-1",
        command: { type: "shell" },
        cwd: CWD,
      });
      const fetched = await eventually(() => host.get(a.id));
      expect(fetched.id).toBe(a.id);
      await eventually(() =>
        host.list().some((s) => s.id === a.id) ? true : undefined,
      );
    });

    it("get() returns undefined for unknown ids", () => {
      expect(host.get("does-not-exist")).toBeUndefined();
    });

    it("listByProject() filters by projectId", async () => {
      await host.create({
        projectId: "proj-a",
        command: { type: "shell" },
        cwd: CWD,
      });
      await host.create({
        projectId: "proj-b",
        command: { type: "shell" },
        cwd: CWD,
      });
      const a = await eventually(() => {
        const list = host.listByProject("proj-a");
        return list.length === 1 ? list : undefined;
      });
      const b = await eventually(() => {
        const list = host.listByProject("proj-b");
        return list.length === 1 ? list : undefined;
      });
      expect(a[0].projectId).toBe("proj-a");
      expect(b[0].projectId).toBe("proj-b");
    });

    it("setTitle() returns true for known sessions and updates get()", async () => {
      const session = await host.create({
        projectId: "proj-1",
        command: { type: "shell" },
        cwd: CWD,
      });
      expect(host.setTitle(session.id, "renamed")).toBe(true);
      expect(host.get(session.id)?.title).toBe("renamed");
    });

    it("setTitle() returns false for unknown sessions", () => {
      expect(host.setTitle("nope", "x")).toBe(false);
    });

    it("setPinned() toggles the pinned flag", async () => {
      const session = await host.create({
        projectId: "proj-1",
        command: { type: "shell" },
        cwd: CWD,
      });
      expect(host.setPinned(session.id, true)).toBe(true);
      expect(host.get(session.id)?.pinned).toBe(true);
      expect(host.setPinned(session.id, false)).toBe(true);
      expect(host.get(session.id)?.pinned).toBeUndefined();
    });

    it("dispose() removes the session from get()/list() synchronously after await", async () => {
      const session = await host.create({
        projectId: "proj-1",
        command: { type: "shell" },
        cwd: CWD,
      });
      await host.dispose(session.id);
      expect(host.get(session.id)).toBeUndefined();
      expect(host.list().some((s) => s.id === session.id)).toBe(false);
    });

    it("disposeAll() empties the host", async () => {
      await host.create({
        projectId: "proj-1",
        command: { type: "shell" },
        cwd: CWD,
      });
      await host.create({
        projectId: "proj-2",
        command: { type: "shell" },
        cwd: CWD,
      });
      await host.disposeAll();
      expect(host.list()).toEqual([]);
    });

    it("getScrollback() returns null for unknown ids", () => {
      expect(host.getScrollback("missing")).toBeNull();
    });

    it("getForegroundProcess() returns null for unknown ids", () => {
      expect(host.getForegroundProcess("missing")).toBeNull();
    });

    it("initClient() resolves ok:false for an unknown session id", async () => {
      const result = await host.initClient(
        "missing",
        "client-1",
        80,
        24,
        () => {},
      );
      expect(result).toEqual({ ok: false });
    });

    it("detachClient() is a no-op for an unknown session id", () => {
      expect(() => host.detachClient("missing", "client-1")).not.toThrow();
    });

    it("onSessionInput()/onSessionData() accept listeners without throwing", () => {
      expect(() => host.onSessionInput(() => {})).not.toThrow();
      expect(() => host.onSessionData(() => {})).not.toThrow();
    });

    it("onSessionExit can be set and read back", () => {
      const handler = vi.fn();
      host.onSessionExit = handler;
      expect(host.onSessionExit).toBe(handler);
      host.onSessionExit = null;
      expect(host.onSessionExit).toBeNull();
    });

    it("shutdownAll() resolves on an empty host", async () => {
      await expect(host.shutdownAll()).resolves.toBeUndefined();
    });

    it("dispose() of an unknown session does not throw", async () => {
      await expect(host.dispose("missing")).resolves.toBeUndefined();
    });
  });
}

describe("resolvePtyHostMode()", () => {
  it("returns 'remote' when PARASOR_PTY_DAEMON=1", () => {
    expect(resolvePtyHostMode({ PARASOR_PTY_DAEMON: "1" })).toBe("remote");
  });

  it("returns 'in-process' only when PARASOR_PTY_DAEMON=0 (explicit opt-out)", () => {
    expect(resolvePtyHostMode({ PARASOR_PTY_DAEMON: "0" })).toBe("in-process");
  });

  it("defaults to 'remote' for any unset / non-zero value (daemon-mode default)", () => {
    expect(resolvePtyHostMode({})).toBe("remote");
    expect(resolvePtyHostMode({ PARASOR_PTY_DAEMON: "true" })).toBe("remote");
  });
});

describe("createPtyHost() factory", () => {
  it("returns an in-process host for mode='in-process'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-"));
    const store = new AppStateStore({ dir, debounceMs: 0 });
    try {
      const host = await createPtyHost({ store, mode: "in-process" });
      expect(typeof host.list).toBe("function");
      await host.disposeAll();
    } finally {
      store.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mode='remote' fails fast when no daemon socket exists", async () => {
    process.env.PARASOR_PTY_SOCK = "/tmp/parasor-pty-no-such-sock.sock";
    process.env.PARASOR_PTY_AUTOSTART = "0";
    try {
      await expect(
        createPtyHost({ store: {} as never, mode: "remote" }),
      ).rejects.toThrow(/cannot connect/);
    } finally {
      delete process.env.PARASOR_PTY_SOCK;
      delete process.env.PARASOR_PTY_AUTOSTART;
    }
  });
});

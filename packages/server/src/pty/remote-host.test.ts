import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AppState,
  Project,
  Session,
  SessionEndReason,
} from "@parasor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import type { CreateSessionInput, PtyHost } from "./host.js";
import { PtyHostDaemon } from "./host-daemon/daemon.js";
import { encodeFrame, FrameType } from "./host-protocol/frames.js";
import {
  encodeJsonPayload,
  type HelloAckPayload,
  type NackPayload,
  PROTOCOL_VERSION,
  type SessionListPayload,
  type SessionUpdatePayload,
} from "./host-protocol/messages.js";
import { RemotePtyHost, RemotePtyHostError } from "./remote-host.js";

/*
 * RemotePtyHost integration tests. We pair RemotePtyHost with a real
 * PtyHostDaemon over a TCP loopback socket -- same wire protocol, same
 * frame parser, same fence semantics -- so round-trip encode/decode is
 * exercised end-to-end. The daemon wraps a FakeHost so we don't need a
 * real PTY (sandbox-incompatible).
 *
 * For tests that need to drive bytes the daemon would never produce
 * (malformed HELLO_ACK, simulated NACK, broadcast frames the FakeHost
 * doesn't synthesise), we bypass the daemon and write frames directly
 * onto the wire from a "naked" loopback peer.
 */

class FakeHost implements PtyHost {
  sessions = new Map<string, Session>();
  writes: { id: string; data: string }[] = [];
  resizes: { id: string; cols: number; rows: number }[] = [];
  refreshes: string[] = [];
  pauses: { id: string; clientId: string }[] = [];
  resumes: { id: string; clientId: string }[] = [];
  detaches: { id: string; clientId: string; expectedToken?: number }[] = [];
  envCalls: Record<string, string>[] = [];
  createCalls: CreateSessionInput[] = [];
  initClients: { id: string; clientId: string; cols: number; rows: number }[] =
    [];
  disposed: string[] = [];
  disposeAllCalls = 0;
  shutdownAllCalls = 0;
  nextCreateResult: { ok: true; session: Session } | { ok: false; err: Error } =
    { ok: true, session: makeSession("default-session") };
  nextRestartResult:
    | { ok: true; session: Session }
    | { ok: false; err: Error } = { ok: true, session: makeSession("default") };
  initClientResult: boolean | Error = true;
  onInitClient?: (id: string, clientId: string) => void;

  private dataListeners: ((
    sessionId: string,
    data: string,
    generation: number,
  ) => void)[] = [];
  private inputListeners: ((sessionId: string, data: string) => void)[] = [];
  onSessionExit:
    | ((id: string, generation: number, reason: SessionEndReason) => void)
    | null = null;

  setPtyEnv(env: Record<string, string>): void {
    this.envCalls.push({ ...env });
  }
  list(): Session[] {
    return Array.from(this.sessions.values());
  }
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }
  listByProject(projectId: string): Session[] {
    return this.list().filter((s) => s.projectId === projectId);
  }
  getScrollback(): string | null {
    return null;
  }
  getForegroundProcess(): string | null {
    return null;
  }

  async create(input: CreateSessionInput): Promise<Session> {
    this.createCalls.push({ ...input });
    if (this.nextCreateResult.ok) {
      const session: Session = {
        ...this.nextCreateResult.session,
        projectId: input.projectId,
        cwd: input.cwd,
      };
      this.sessions.set(session.id, session);
      return session;
    }
    throw this.nextCreateResult.err;
  }
  async restart(id: string): Promise<Session> {
    if (this.nextRestartResult.ok) {
      const session: Session = { ...this.nextRestartResult.session, id };
      this.sessions.set(id, session);
      return session;
    }
    throw this.nextRestartResult.err;
  }

  setTitle(id: string, title: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.title = title;
    return true;
  }
  setPinned(id: string, pinned: boolean): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.pinned = pinned;
    return true;
  }

  write(id: string, data: string): void {
    this.writes.push({ id, data });
    for (const l of this.inputListeners) l(id, data);
  }
  resize(id: string, cols: number, rows: number): void {
    this.resizes.push({ id, cols, rows });
  }
  refresh(id: string): void {
    this.refreshes.push(id);
  }
  pauseOutput(id: string, clientId: string): void {
    this.pauses.push({ id, clientId });
  }
  resumeOutput(id: string, clientId: string): void {
    this.resumes.push({ id, clientId });
  }

  async initClient(
    id: string,
    clientId: string,
    cols: number,
    rows: number,
    _listener: (data: string) => void,
    attachToken?: number,
  ): Promise<{ ok: true; attachToken: number } | { ok: false }> {
    this.initClients.push({ id, clientId, cols, rows });
    if (this.initClientResult instanceof Error) throw this.initClientResult;
    if (!this.initClientResult) return { ok: false };
    this.onInitClient?.(id, clientId);
    return { ok: true, attachToken: attachToken ?? 1 };
  }
  async attachClient(): Promise<{ ok: false }> {
    return { ok: false };
  }
  detachClient(id: string, clientId: string, expectedToken?: number): void {
    this.detaches.push({ id, clientId, expectedToken });
  }

  async dispose(id: string): Promise<void> {
    this.disposed.push(id);
    this.sessions.delete(id);
  }
  async disposeAll(): Promise<void> {
    this.disposeAllCalls++;
    this.sessions.clear();
  }
  async shutdownAll(): Promise<void> {
    this.shutdownAllCalls++;
  }

  loadPersistedSession(): void {}

  onSessionInput(listener: (sessionId: string, data: string) => void): void {
    this.inputListeners.push(listener);
  }
  onSessionData(
    listener: (sessionId: string, data: string, generation: number) => void,
  ): void {
    this.dataListeners.push(listener);
  }

  emitData(sessionId: string, data: string, generation = 1): void {
    for (const l of this.dataListeners) l(sessionId, data, generation);
  }
}

function makeSession(id: string): Session {
  return {
    id,
    projectId: "p1",
    pid: null,
    state: "spawning",
    generation: 1,
    title: id,
    command: { type: "shell" },
    cwd: "/",
    shell: "/bin/zsh",
    createdAt: 0,
    pinned: false,
  };
}

interface DaemonHarness {
  remote: RemotePtyHost;
  daemon: PtyHostDaemon;
  host: FakeHost;
  cleanup: () => Promise<void>;
}

async function makeLoopback(): Promise<{
  serverSocket: net.Socket;
  clientSocket: net.Socket;
  cleanup: () => Promise<void>;
}> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  const acceptedPromise = new Promise<net.Socket>((resolve) =>
    server.once("connection", resolve),
  );
  const clientSocket = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    clientSocket.once("connect", resolve);
    clientSocket.once("error", reject);
  });
  const serverSocket = await acceptedPromise;

  return {
    serverSocket,
    clientSocket,
    cleanup: async () => {
      clientSocket.destroy();
      serverSocket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function makeHarness(opts?: {
  scrollbackLog?: import("./scrollback-log.js").ScrollbackLog;
  daemonLegacyReplayMaxBytes?: number;
}): Promise<DaemonHarness> {
  const { serverSocket, clientSocket, cleanup } = await makeLoopback();
  const host = new FakeHost();
  const daemon = new PtyHostDaemon({ host });
  daemon.acceptConnection(serverSocket);
  const remote = await RemotePtyHost.connect({
    socket: clientSocket,
    serverPid: 4242,
    requestTimeoutMs: 1000,
    scrollbackLog: opts?.scrollbackLog ?? null,
    daemonLegacyReplayMaxBytes: opts?.daemonLegacyReplayMaxBytes,
  });
  return {
    remote,
    daemon,
    host,
    cleanup: async () => {
      daemon.dispose();
      await cleanup();
    },
  };
}

function restoreEnvSnapshot(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function snapshotHeadlessReplayEnv(): Record<string, string | undefined> {
  return {
    PARASOR_HEADLESS_REPLAY: process.env.PARASOR_HEADLESS_REPLAY,
    PARASOR_EXPERIMENT_HEADLESS_REPLAY:
      process.env.PARASOR_EXPERIMENT_HEADLESS_REPLAY,
    PARASOR_HEADLESS_REPLAY_SCROLLBACK_LINES:
      process.env.PARASOR_HEADLESS_REPLAY_SCROLLBACK_LINES,
    PARASOR_HEADLESS_REPLAY_MAX_BYTES:
      process.env.PARASOR_HEADLESS_REPLAY_MAX_BYTES,
  };
}

describe("RemotePtyHost handshake", () => {
  it("connects, completes HELLO/HELLO_ACK + first SESSION_LIST, and lifts to ready", async () => {
    const h = await makeHarness();
    expect(h.remote.list()).toEqual([]);
    await h.cleanup();
  });

  it("connect() does NOT resolve on HELLO_ACK alone -- defers to first SESSION_LIST", async () => {
    /*
     * HELLO_ACK alone is not "ready".
     * If we resolved on HELLO_ACK, list() would return [] for one tick
     * after `await connect()` until SESSION_LIST arrived, and any caller
     * acting on that empty mirror would see a phantom-empty world.
     *
     * Drive the daemon side by hand: send HELLO_ACK, withhold
     * SESSION_LIST, then assert connect() is still pending. Once we
     * release SESSION_LIST, connect() resolves and the mirror reflects
     * the snapshot.
     */
    const { serverSocket, clientSocket, cleanup } = await makeLoopback();
    serverSocket.once("data", () => {
      serverSocket.write(
        encodeFrame({
          type: FrameType.HELLO_ACK,
          connectionId: 1,
          generation: 1n,
          requestId: 1,
          payload: encodeJsonPayload({
            protocolVersion: PROTOCOL_VERSION,
            connectionId: 1,
            generation: "1",
            daemonPid: 1,
            daemonStartedAt: "x",
          } satisfies HelloAckPayload),
        }),
      );
    });
    const connectPromise = RemotePtyHost.connect({
      socket: clientSocket,
      requestTimeoutMs: 5000,
    });
    let resolved = false;
    void connectPromise.then(() => {
      resolved = true;
    });
    // Give Node enough ticks to unwind HELLO_ACK fully -- handshake must
    // still be pending because SESSION_LIST hasn't arrived.
    await new Promise((r) => setTimeout(r, 30));
    expect(resolved).toBe(false);

    // Now deliver the snapshot with a pre-stamped session.
    const stamped: Session = makeSession("snapshot-seed");
    serverSocket.write(
      encodeFrame({
        type: FrameType.SESSION_LIST,
        connectionId: 0,
        generation: 0n,
        requestId: 0,
        payload: encodeJsonPayload({
          sessions: [stamped],
        } satisfies SessionListPayload),
      }),
    );

    const remote = await connectPromise;
    expect(remote.list().map((s) => s.id)).toEqual(["snapshot-seed"]);
    await cleanup();
  });

  it("rejects connect() when daemon advertises an incompatible major", async () => {
    const { serverSocket, clientSocket, cleanup } = await makeLoopback();
    // hand-rolled "daemon" that responds to HELLO with HELLO_ACK 3.0.0
    serverSocket.once("data", () => {
      serverSocket.write(
        encodeFrame({
          type: FrameType.HELLO_ACK,
          connectionId: 1,
          generation: 1n,
          requestId: 1,
          payload: encodeJsonPayload({
            protocolVersion: "3.0.0",
            connectionId: 1,
            generation: "1",
            daemonPid: 1,
            daemonStartedAt: "x",
          } satisfies HelloAckPayload),
        }),
      );
    });
    await expect(
      RemotePtyHost.connect({ socket: clientSocket, requestTimeoutMs: 500 }),
    ).rejects.toBeInstanceOf(RemotePtyHostError);
    await cleanup();
  });

  it("rejects connect() if the socket closes before HELLO_ACK", async () => {
    const { serverSocket, clientSocket, cleanup } = await makeLoopback();
    serverSocket.once("data", () => serverSocket.destroy());
    await expect(
      RemotePtyHost.connect({ socket: clientSocket, requestTimeoutMs: 500 }),
    ).rejects.toMatchObject({ code: "connection-dropped" });
    await cleanup();
  });
});

describe("RemotePtyHost -- async PtyHost methods", () => {
  let h: DaemonHarness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("create() resolves with the session and updates the mirror", async () => {
    h.host.nextCreateResult = { ok: true, session: makeSession("s-new") };
    const session = await h.remote.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: "/tmp",
    });
    expect(session.id).toBe("s-new");
    expect(h.remote.get("s-new")?.id).toBe("s-new");
  });

  it("create() forwards bootstrap input over daemon IPC", async () => {
    h.host.nextCreateResult = { ok: true, session: makeSession("s-new") };
    await h.remote.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: "/tmp",
      bootstrapInput: "pnpm dev\r",
    });
    expect(h.host.createCalls[0]).toEqual(
      expect.objectContaining({ bootstrapInput: "pnpm dev\r" }),
    );
  });

  it("create() rejects with create-failed on host failure", async () => {
    h.host.nextCreateResult = { ok: false, err: new Error("boom") };
    await expect(
      h.remote.create({
        projectId: "p",
        command: { type: "shell" },
        cwd: "/",
      }),
    ).rejects.toMatchObject({ code: "create-failed" });
  });

  it("restart() resolves and updates the mirror", async () => {
    h.host.sessions.set("s1", makeSession("s1"));
    h.host.nextRestartResult = { ok: true, session: makeSession("s1") };
    const session = await h.remote.restart("s1");
    expect(session.id).toBe("s1");
    expect(h.remote.get("s1")?.id).toBe("s1");
  });

  it("dispose() removes the session from the mirror", async () => {
    h.host.sessions.set("s1", makeSession("s1"));
    // Seed the mirror via SESSION_UPDATE-equivalent: create() round-trips.
    h.host.nextCreateResult = { ok: true, session: makeSession("s1") };
    await h.remote.create({
      projectId: "p",
      command: { type: "shell" },
      cwd: "/",
    });
    await h.remote.dispose("s1");
    expect(h.remote.get("s1")).toBeUndefined();
    expect(h.host.disposed).toContain("s1");
  });

  it("disposeAll() empties the mirror", async () => {
    h.host.nextCreateResult = { ok: true, session: makeSession("a") };
    await h.remote.create({
      projectId: "p",
      command: { type: "shell" },
      cwd: "/",
    });
    h.host.nextCreateResult = { ok: true, session: makeSession("b") };
    await h.remote.create({
      projectId: "p",
      command: { type: "shell" },
      cwd: "/",
    });
    await h.remote.disposeAll();
    expect(h.remote.list()).toEqual([]);
    expect(h.host.disposeAllCalls).toBe(1);
  });

  it("initClient() returns ok:true when host accepts and registers a per-client listener", async () => {
    const received: string[] = [];
    const result = await h.remote.initClient("s1", "client-A", 80, 24, (data) =>
      received.push(data),
    );
    expect(result.ok).toBe(true);
    expect(h.host.initClients).toEqual([
      { id: "s1", clientId: "client-A", cols: 80, rows: 24 },
    ]);
    h.host.emitData("s1", "hello");
    await vi.waitFor(() => expect(received).toEqual(["hello"]));
  });

  it("initClient() refreshes the mirror when attach spawns the PTY", async () => {
    h.host.nextCreateResult = { ok: true, session: makeSession("s1") };
    await h.remote.create({
      projectId: "p",
      command: { type: "shell" },
      cwd: "/",
    });
    expect(h.remote.get("s1")?.state).toBe("spawning");

    h.host.onInitClient = (id) => {
      const session = h.host.sessions.get(id);
      if (!session) return;
      h.host.sessions.set(id, { ...session, pid: 4321, state: "running" });
    };

    const result = await h.remote.initClient(
      "s1",
      "client-A",
      80,
      24,
      () => {},
    );

    expect(result.ok).toBe(true);
    await vi.waitFor(() =>
      expect(h.remote.get("s1")).toMatchObject({
        id: "s1",
        pid: 4321,
        state: "running",
      }),
    );
  });

  it("initClient() returns ok:false when host rejects", async () => {
    h.host.initClientResult = false;
    const result = await h.remote.initClient("nope", "c", 80, 24, () => {});
    expect(result).toEqual({ ok: false });
  });

  it("attachClient() forwards daemon DATA through sink.onChunk tagged with the per-session generation (PTY generation gate)", async () => {
    const chunks: { generation: number; seq: bigint; data: string }[] = [];
    const sink = {
      onChunk: (generation: number, seq: bigint, data: Buffer) => {
        chunks.push({ generation, seq, data: data.toString("utf8") });
      },
    };
    const result = await h.remote.attachClient(
      "s1",
      "client-A",
      80,
      24,
      { binary: true, chunkedReplay: true },
      sink,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // chunkedReplay is suppressed because the daemon's STREAM_DATA frame
    // does not yet carry chunk headers.
    expect(result.capabilities).toEqual({
      binary: false,
      chunkedReplay: false,
    });
    // Initial seed = whatever generation has been observed so far (0 = unseen).
    expect(result.serverState).toEqual({
      generation: 0,
      lastDeliveredSeq: null,
      oldestSeq: null,
    });
    expect(result.replay).toBe("none");
    expect(h.host.initClients).toEqual([
      { id: "s1", clientId: "client-A", cols: 80, rows: 24 },
    ]);
    expect(h.host.resizes).toEqual([]);

    // FakeHost.emitData defaults to generation=1 -- the daemon now carries
    // that generation across IPC and tags each chunk with it (PTY generation gate).
    h.host.emitData("s1", "abc");
    h.host.emitData("s1", "def");
    await vi.waitFor(() =>
      expect(chunks).toEqual([
        { generation: 1, seq: 0n, data: "abc" },
        { generation: 1, seq: 1n, data: "def" },
      ]),
    );
  });

  it("isolates per-session generations and drops stale-gen DATA from the chunk fanout (PTY generation gate)", async () => {
    // Three things must hold on the daemon-mode receive path:
    // (1) the per-session generation latch is keyed by sessionId -- a bump
    //     on s1 must not contaminate s2's tagging.
    // (2) per-client `onChunk` carries the data's emit-time generation, NOT
    //     the latch read at delivery time -- otherwise stale-gen bytes get
    //     re-tagged with the current gen and sneak past the input gate.
    // (3) DATA whose generation is strictly less than the latched max is
    //     dropped from the per-client fanout entirely. The
    //     in-process side already does this via `generationStillCurrent`;
    //     the daemon side must mirror it so old-PTY bytes never reach a
    //     client xterm in either mode.
    h.host.sessions.set("s1", makeSession("s1"));
    h.host.sessions.set("s2", makeSession("s2"));
    const s1Chunks: { generation: number; data: string }[] = [];
    const s2Chunks: { generation: number; data: string }[] = [];
    const ok1 = await h.remote.attachClient(
      "s1",
      "client-1",
      80,
      24,
      { binary: true, chunkedReplay: true },
      {
        onChunk: (g, _seq, d) =>
          s1Chunks.push({ generation: g, data: d.toString("utf8") }),
      },
    );
    expect(ok1.ok).toBe(true);
    const ok2 = await h.remote.attachClient(
      "s2",
      "client-2",
      80,
      24,
      { binary: true, chunkedReplay: true },
      {
        onChunk: (g, _seq, d) =>
          s2Chunks.push({ generation: g, data: d.toString("utf8") }),
      },
    );
    expect(ok2.ok).toBe(true);

    // Interleaved fresh-gen progression on both sessions, then a STALE
    // s1 emit at gen=1 arriving AFTER the latch already advanced to 2.
    h.host.emitData("s1", "a1", 1);
    h.host.emitData("s2", "b1", 5);
    h.host.emitData("s1", "a2", 2);
    h.host.emitData("s2", "b2", 5);
    h.host.emitData("s1", "STALE", 1); // post-bump leak from old PTY
    h.host.emitData("s1", "a3", 2);

    await vi.waitFor(() => {
      // (3) STALE never reaches the client -- only fresh-gen bytes survive.
      expect(s1Chunks.map((c) => c.data).join("")).toBe("a1a2a3");
      expect(s2Chunks.map((c) => c.data).join("")).toBe("b1b2");
    });

    // (2) Each delivered chunk carries its own emit-time generation,
    // not whatever the latch was at delivery -- so the WS layer can stamp
    // OUTPUT correctly and the input gate can match an INPUT echo.
    // (1) s2 unaffected by s1's bump -- latch is per-session.
    expect(s1Chunks).toEqual([
      { generation: 1, data: "a1" },
      { generation: 2, data: "a2" },
      { generation: 2, data: "a3" },
    ]);
    expect(s2Chunks).toEqual([
      { generation: 5, data: "b1" },
      { generation: 5, data: "b2" },
    ]);
  });

  it("attachClient() returns ok:false when host rejects", async () => {
    h.host.initClientResult = false;
    const result = await h.remote.attachClient(
      "nope",
      "c",
      80,
      24,
      { binary: true, chunkedReplay: true },
      { onChunk: () => {} },
    );
    expect(result).toEqual({ ok: false });
  });

  it("shutdownAll() resolves on detach (daemon evicts post-ACK)", async () => {
    await expect(h.remote.shutdownAll()).resolves.toBeUndefined();
    // Second call is a no-op now that the connection is dropped.
    await expect(h.remote.shutdownAll()).resolves.toBeUndefined();
  });
});

describe("RemotePtyHost -- fire-and-forget mutators", () => {
  let h: DaemonHarness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("write() forwards as a stream-payload WRITE frame", async () => {
    h.remote.write("s1", "ls\r");
    await vi.waitFor(() =>
      expect(h.host.writes).toEqual([{ id: "s1", data: "ls\r" }]),
    );
  });

  it("resize() forwards", async () => {
    h.remote.resize("s1", 100, 30);
    await vi.waitFor(() =>
      expect(h.host.resizes).toEqual([{ id: "s1", cols: 100, rows: 30 }]),
    );
  });

  it("refresh() forwards", async () => {
    h.remote.refresh("s1");
    await vi.waitFor(() => expect(h.host.refreshes).toEqual(["s1"]));
  });

  it("pauseOutput() and resumeOutput() forward", async () => {
    h.remote.pauseOutput("s1", "client-A");
    h.remote.resumeOutput("s1", "client-A");
    await vi.waitFor(() =>
      expect(h.host.pauses).toEqual([{ id: "s1", clientId: "client-A" }]),
    );
    expect(h.host.resumes).toEqual([{ id: "s1", clientId: "client-A" }]);
  });

  it("detachClient() forwards and clears the attached entry", async () => {
    await h.remote.initClient("s1", "client-A", 80, 24, () => {});
    h.remote.detachClient("s1", "client-A");
    await vi.waitFor(() =>
      expect(h.host.detaches).toEqual([
        { id: "s1", clientId: "client-A", expectedToken: undefined },
      ]),
    );
  });

  // Attach fencing -- server-side fencing token. A stale onClose for the old
  // WS (carrying the OLD token) must NOT replace the live entry's
  // listener locally NOR forward a DETACH_CLIENT to the daemon.
  it("detachClient() with stale token is a no-op (no IPC, no local delete)", async () => {
    const oldChunks: string[] = [];
    const newChunks: string[] = [];

    const first = await h.remote.initClient("s1", "client-A", 80, 24, (d) =>
      oldChunks.push(d),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const staleToken = first.attachToken;

    const second = await h.remote.initClient("s1", "client-A", 80, 24, (d) =>
      newChunks.push(d),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.attachToken).not.toBe(staleToken);

    // Stale onClose firing after the new attach.
    h.remote.detachClient("s1", "client-A", staleToken);

    // Live data must still flow to the new listener -- entry preserved.
    h.host.emitData("s1", "live");
    await vi.waitFor(() => expect(newChunks).toEqual(["live"]));

    // No DETACH_CLIENT IPC was forwarded for the stale call.
    // (initClient creates the entry; subsequent stale detach must NOT push.)
    expect(h.host.detaches).toEqual([]);
  });

  // The matching-token detach DOES forward and clear, propagating the
  // expectedToken across the IPC so the daemon performs the same fence.
  it("detachClient() with matching token forwards expectedToken", async () => {
    const result = await h.remote.initClient(
      "s1",
      "client-A",
      80,
      24,
      () => {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    h.remote.detachClient("s1", "client-A", result.attachToken);
    await vi.waitFor(() =>
      expect(h.host.detaches).toEqual([
        { id: "s1", clientId: "client-A", expectedToken: result.attachToken },
      ]),
    );
  });

  it("setPtyEnv() forwards", async () => {
    h.remote.setPtyEnv({ FOO: "bar" });
    await vi.waitFor(() => expect(h.host.envCalls).toEqual([{ FOO: "bar" }]));
  });

  it("setTitle() updates the mirror optimistically and forwards", async () => {
    // Seed the mirror by creating first.
    h.host.nextCreateResult = { ok: true, session: makeSession("s1") };
    await h.remote.create({
      projectId: "p",
      command: { type: "shell" },
      cwd: "/",
    });
    expect(h.remote.setTitle("s1", "renamed")).toBe(true);
    expect(h.remote.get("s1")?.title).toBe("renamed");
    // The wire round-trip should cause host to also see the change.
    await vi.waitFor(() =>
      expect(h.host.sessions.get("s1")?.title).toBe("renamed"),
    );
  });

  it("setTitle() returns false for unknown ids without writing", async () => {
    expect(h.remote.setTitle("missing", "x")).toBe(false);
  });

  it("setPinned() updates the mirror optimistically", async () => {
    h.host.nextCreateResult = { ok: true, session: makeSession("s1") };
    await h.remote.create({
      projectId: "p",
      command: { type: "shell" },
      cwd: "/",
    });
    expect(h.remote.setPinned("s1", true)).toBe(true);
    expect(h.remote.get("s1")?.pinned).toBe(true);
    await vi.waitFor(() =>
      expect(h.host.sessions.get("s1")?.pinned).toBe(true),
    );
  });
});

describe("RemotePtyHost -- daemon broadcasts", () => {
  let h: DaemonHarness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("SESSION_UPDATE writes through to the mirror", async () => {
    h.host.nextCreateResult = { ok: true, session: makeSession("s1") };
    await h.remote.create({
      projectId: "p",
      command: { type: "shell" },
      cwd: "/",
    });
    // setTitle on the host triggers SESSION_UPDATE via maybeBroadcast.
    h.remote.setTitle("s1", "v2");
    await vi.waitFor(() => expect(h.remote.get("s1")?.title).toBe("v2"));
  });

  it("SESSION_EXIT marks the session ended and fires onSessionExit", async () => {
    h.host.nextCreateResult = { ok: true, session: makeSession("s1") };
    await h.remote.create({
      projectId: "p",
      command: { type: "shell" },
      cwd: "/",
    });
    const exitSpy = vi.fn();
    h.remote.onSessionExit = exitSpy;
    h.host.onSessionExit?.("s1", 1, { type: "exit", code: 0 });
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledTimes(1));
    expect(h.remote.get("s1")?.state).toBe("ended");
  });

  it("DATA fans out to per-client listeners and onSessionData", async () => {
    const perClient: string[] = [];
    const global: { id: string; data: string }[] = [];
    h.remote.onSessionData((id, data) => global.push({ id, data }));
    await h.remote.initClient("s1", "client-A", 80, 24, (d) =>
      perClient.push(d),
    );
    h.host.emitData("s1", "abc");
    await vi.waitFor(() => {
      expect(perClient).toEqual(["abc"]);
      expect(global).toEqual([{ id: "s1", data: "abc" }]);
    });
  });

  it("SESSION_INPUT fans out to onSessionInput listeners", async () => {
    const inputs: { id: string; data: string }[] = [];
    h.remote.onSessionInput((id, data) => inputs.push({ id, data }));
    h.remote.write("s1", "echo\r");
    // FakeHost.write triggers the onSessionInput on the daemon side, which
    // broadcasts SESSION_INPUT back to the server.
    await vi.waitFor(() =>
      expect(inputs).toEqual([{ id: "s1", data: "echo\r" }]),
    );
  });
});

describe("RemotePtyHost -- sync read accessors and stubs", () => {
  let h: DaemonHarness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("listByProject() filters the mirror by projectId", async () => {
    h.host.nextCreateResult = { ok: true, session: makeSession("a") };
    await h.remote.create({
      projectId: "proj-A",
      command: { type: "shell" },
      cwd: "/",
    });
    h.host.nextCreateResult = { ok: true, session: makeSession("b") };
    await h.remote.create({
      projectId: "proj-B",
      command: { type: "shell" },
      cwd: "/",
    });
    expect(h.remote.listByProject("proj-A").map((s) => s.id)).toEqual(["a"]);
    expect(h.remote.listByProject("proj-B").map((s) => s.id)).toEqual(["b"]);
  });

  it("getScrollback() returns null when no scrollbackLog is wired; getForegroundProcess() always null in remote mode", () => {
    expect(h.remote.getScrollback("s1")).toBeNull();
    expect(h.remote.getForegroundProcess("s1")).toBeNull();
  });

  it("loadPersistedSession() is a no-op", () => {
    expect(() =>
      h.remote.loadPersistedSession(makeSession("s"), false),
    ).not.toThrow();
  });
});

describe("RemotePtyHost -- scrollback wiring", () => {
  /*
   * Daemon mode previously returned `replay:"none"` from attachClient and
   * had no scrollback persistence at all ( cited it as
   * "out of scope"). That left the WS terminal blank whenever the xterm
   * re-mounted (tab switch, dev-server reload while the daemon survived).
   *
   * The fix wires the existing per-session `ScrollbackLog` into
   * RemotePtyHost so every DATA frame is appended to disk and re-attaches
   * receive `replay:"full"` with the disk tail. These tests exercise that
   * end-to-end through a real PtyHostDaemon over a loopback socket.
   */
  let tmpDir: string;
  let scrollbackLog: import("./scrollback-log.js").ScrollbackLog;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "remote-host-scrollback-"));
    const { ScrollbackLog } = await import("./scrollback-log.js");
    scrollbackLog = new ScrollbackLog(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends every DATA frame to ScrollbackLog and serves the tail via getScrollback()", async () => {
    const h = await makeHarness({ scrollbackLog });
    h.host.sessions.set("s1", makeSession("s1"));
    h.host.emitData("s1", "hello ");
    h.host.emitData("s1", "world\n");
    // ScrollbackLog buffers writes; flushAll forces them to disk before readTail.
    await vi.waitFor(() => {
      scrollbackLog.flushAll();
      expect(h.remote.getScrollback("s1")).toBe("hello world\n");
    });
    await h.cleanup();
  });

  it("attachClient() returns replay:'full' with the disk tail when scrollback is non-empty", async () => {
    const envSnapshot = snapshotHeadlessReplayEnv();
    process.env.PARASOR_HEADLESS_REPLAY = "0";
    const h = await makeHarness({ scrollbackLog });
    try {
      h.host.sessions.set("s1", makeSession("s1"));
      h.host.emitData("s1", "prior output\n");
      await vi.waitFor(() => {
        scrollbackLog.flushAll();
        expect(scrollbackLog.readTail("s1")).toBe("prior output\n");
      });
      const result = await h.remote.attachClient(
        "s1",
        "client-A",
        80,
        24,
        { binary: true, chunkedReplay: true },
        { onChunk: () => {} },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.replay).toBe("full");
      expect(result.fullReplay).toBe("prior output\n");
    } finally {
      await h.cleanup();
      restoreEnvSnapshot(envSnapshot);
    }
  });

  it("attachClient() caps oversized daemon legacy full replay to the latest tail bytes", async () => {
    const envSnapshot = snapshotHeadlessReplayEnv();
    process.env.PARASOR_HEADLESS_REPLAY = "0";
    const h = await makeHarness({
      scrollbackLog,
      daemonLegacyReplayMaxBytes: 16,
    });
    try {
      h.host.sessions.set("s1", makeSession("s1"));
      h.host.emitData("s1", `${"old-output\n".repeat(20)}latest prompt\n`);
      await vi.waitFor(() => {
        scrollbackLog.flushAll();
        expect(scrollbackLog.readTail("s1")).toContain("old-output\n");
      });
      const result = await h.remote.attachClient(
        "s1",
        "client-A",
        80,
        24,
        { binary: true, chunkedReplay: true },
        { onChunk: () => {} },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.replay).toBe("full");
      expect(
        Buffer.byteLength(result.fullReplay ?? "", "utf8"),
      ).toBeLessThanOrEqual(16);
      expect(result.fullReplay).toMatch(/latest prompt\n$/);
      expect(result.fullReplay).not.toContain("old-output");
    } finally {
      await h.cleanup();
      restoreEnvSnapshot(envSnapshot);
    }
  });

  it("attachClient() caps daemon legacy full replay to 256 KiB by default", async () => {
    const envSnapshot = snapshotHeadlessReplayEnv();
    process.env.PARASOR_HEADLESS_REPLAY = "0";
    const h = await makeHarness({ scrollbackLog });
    try {
      h.host.sessions.set("s1", makeSession("s1"));
      h.host.emitData("s1", `${"old-output\n".repeat(30_000)}latest prompt\n`);
      await vi.waitFor(() => {
        scrollbackLog.flushAll();
        expect(scrollbackLog.readTail("s1")).toContain("old-output\n");
      });
      const result = await h.remote.attachClient(
        "s1",
        "client-A",
        80,
        24,
        { binary: true, chunkedReplay: true },
        { onChunk: () => {} },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.replay).toBe("full");
      expect(
        Buffer.byteLength(result.fullReplay ?? "", "utf8"),
      ).toBeLessThanOrEqual(256 * 1024);
      expect(result.fullReplay).toMatch(/latest prompt\n$/);
    } finally {
      await h.cleanup();
      restoreEnvSnapshot(envSnapshot);
    }
  });

  it("attachClient() uses the headless replay snapshot by default", async () => {
    const envSnapshot = snapshotHeadlessReplayEnv();
    let h: Awaited<ReturnType<typeof makeHarness>> | null = null;
    try {
      delete process.env.PARASOR_HEADLESS_REPLAY;
      delete process.env.PARASOR_EXPERIMENT_HEADLESS_REPLAY;
      process.env.PARASOR_HEADLESS_REPLAY_SCROLLBACK_LINES = "20";
      h = await makeHarness({ scrollbackLog });
      h.host.sessions.set("s1", makeSession("s1"));
      h.host.emitData("s1", "plain \x1b[31mred\x1b[0m\r\nlatest prompt\n");
      await vi.waitFor(() => {
        scrollbackLog.flushAll();
        expect(scrollbackLog.readTail("s1")).toContain("\x1b[31mred");
      });
      const result = await h.remote.attachClient(
        "s1",
        "client-A",
        80,
        24,
        { binary: true, chunkedReplay: true },
        { onChunk: () => {} },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.replay).toBe("full");
      expect(result.fullReplay).toContain("plain \x1b[31mred\x1b[0m");
      expect(result.fullReplay).toContain("latest prompt");
      expect(result.replayDiagnostics).toMatchObject({
        source: "headless-rebuild",
        rawBytes: Buffer.byteLength(
          "plain \x1b[31mred\x1b[0m\r\nlatest prompt\n",
          "utf8",
        ),
        replayBytes: Buffer.byteLength(result.fullReplay ?? "", "utf8"),
        scrollbackLines: 20,
      });
      expect(
        result.replayDiagnostics?.headlessDurationMs,
      ).toBeGreaterThanOrEqual(0);
    } finally {
      await h?.cleanup();
      restoreEnvSnapshot(envSnapshot);
    }
  });

  it("attachClient() can disable headless replay explicitly", async () => {
    const envSnapshot = snapshotHeadlessReplayEnv();
    let h: Awaited<ReturnType<typeof makeHarness>> | null = null;
    try {
      process.env.PARASOR_HEADLESS_REPLAY = "0";
      delete process.env.PARASOR_EXPERIMENT_HEADLESS_REPLAY;
      h = await makeHarness({ scrollbackLog });
      h.host.sessions.set("s1", makeSession("s1"));
      h.host.emitData("s1", "plain \x1b[31mred\x1b[0m\r\nlatest prompt\n");
      await vi.waitFor(() => {
        scrollbackLog.flushAll();
        expect(scrollbackLog.readTail("s1")).toContain("\x1b[31mred");
      });

      const result = await h.remote.attachClient(
        "s1",
        "client-A",
        80,
        24,
        { binary: true, chunkedReplay: true },
        { onChunk: () => {} },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.replayDiagnostics?.source).toBe("raw-tail");
      expect(result.fullReplay).toContain("\x1b[31mred");
    } finally {
      await h?.cleanup();
      restoreEnvSnapshot(envSnapshot);
    }
  });

  it("attachClient() caps headless replay to 256 KiB by default", async () => {
    const envSnapshot = snapshotHeadlessReplayEnv();
    let h: Awaited<ReturnType<typeof makeHarness>> | null = null;
    try {
      delete process.env.PARASOR_HEADLESS_REPLAY;
      delete process.env.PARASOR_EXPERIMENT_HEADLESS_REPLAY;
      process.env.PARASOR_HEADLESS_REPLAY_SCROLLBACK_LINES = "20000";
      delete process.env.PARASOR_HEADLESS_REPLAY_MAX_BYTES;
      h = await makeHarness({ scrollbackLog });
      h.host.sessions.set("s1", makeSession("s1"));
      h.host.emitData(
        "s1",
        `${"old-output-with-padding-0000000000000000000000\r\n".repeat(12_000)}latest prompt\n`,
      );
      await vi.waitFor(() => {
        scrollbackLog.flushAll();
        expect(scrollbackLog.readTail("s1")).toContain("latest prompt");
      });

      const result = await h.remote.attachClient(
        "s1",
        "client-A",
        80,
        24,
        { binary: true, chunkedReplay: true },
        { onChunk: () => {} },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.replayDiagnostics?.source).toBe("headless-rebuild");
      expect(result.replayDiagnostics?.maxBytes).toBe(256 * 1024);
      expect(
        Buffer.byteLength(result.fullReplay ?? "", "utf8"),
      ).toBeLessThanOrEqual(256 * 1024);
      expect(result.fullReplay).toContain("latest prompt");
    } finally {
      await h?.cleanup();
      restoreEnvSnapshot(envSnapshot);
    }
  });

  it("attachClient() honors explicit headless replay byte cap", async () => {
    const envSnapshot = snapshotHeadlessReplayEnv();
    let h: Awaited<ReturnType<typeof makeHarness>> | null = null;
    try {
      delete process.env.PARASOR_HEADLESS_REPLAY;
      delete process.env.PARASOR_EXPERIMENT_HEADLESS_REPLAY;
      process.env.PARASOR_HEADLESS_REPLAY_SCROLLBACK_LINES = "20000";
      process.env.PARASOR_HEADLESS_REPLAY_MAX_BYTES = "65536";
      h = await makeHarness({ scrollbackLog });
      h.host.sessions.set("s1", makeSession("s1"));
      h.host.emitData(
        "s1",
        `${"old-output-with-padding-0000000000000000000000\r\n".repeat(12_000)}latest prompt\n`,
      );
      await vi.waitFor(() => {
        scrollbackLog.flushAll();
        expect(scrollbackLog.readTail("s1")).toContain("latest prompt");
      });

      const result = await h.remote.attachClient(
        "s1",
        "client-A",
        80,
        24,
        { binary: true, chunkedReplay: true },
        { onChunk: () => {} },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.replayDiagnostics?.source).toBe("headless-rebuild");
      expect(result.replayDiagnostics?.maxBytes).toBe(65_536);
      expect(
        Buffer.byteLength(result.fullReplay ?? "", "utf8"),
      ).toBeLessThanOrEqual(65_536);
      expect(result.fullReplay).toContain("latest prompt");
    } finally {
      await h?.cleanup();
      restoreEnvSnapshot(envSnapshot);
    }
  });

  it("attachClient() reuses warm headless state after lazy rebuild", async () => {
    const envSnapshot = snapshotHeadlessReplayEnv();
    let h: Awaited<ReturnType<typeof makeHarness>> | null = null;
    try {
      delete process.env.PARASOR_HEADLESS_REPLAY;
      delete process.env.PARASOR_EXPERIMENT_HEADLESS_REPLAY;
      process.env.PARASOR_HEADLESS_REPLAY_SCROLLBACK_LINES = "20";
      h = await makeHarness({ scrollbackLog });
      h.host.sessions.set("s1", makeSession("s1"));
      h.host.emitData("s1", "initial\r\n");
      await vi.waitFor(() => {
        scrollbackLog.flushAll();
        expect(scrollbackLog.readTail("s1")).toContain("initial");
      });

      const first = await h.remote.attachClient(
        "s1",
        "client-A",
        80,
        24,
        { binary: true, chunkedReplay: true },
        { onChunk: () => {} },
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.replayDiagnostics?.source).toBe("headless-rebuild");

      h.host.emitData("s1", "live \x1b[31mred\x1b[0m\r\n");
      const second = await h.remote.attachClient(
        "s1",
        "client-B",
        80,
        24,
        { binary: true, chunkedReplay: true },
        { onChunk: () => {} },
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.replayDiagnostics?.source).toBe("headless-state");
      expect(second.fullReplay).toContain("live \x1b[31mred\x1b[0m");
    } finally {
      await h?.cleanup();
      restoreEnvSnapshot(envSnapshot);
    }
  });

  it("attachClient() returns replay:'none' when the disk tail is empty", async () => {
    const h = await makeHarness({ scrollbackLog });
    h.host.sessions.set("s1", makeSession("s1"));
    const result = await h.remote.attachClient(
      "s1",
      "client-A",
      80,
      24,
      { binary: true, chunkedReplay: true },
      { onChunk: () => {} },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replay).toBe("none");
    expect(result.fullReplay).toBeUndefined();
    await h.cleanup();
  });

  it("dispose() removes the session's scrollback log", async () => {
    const h = await makeHarness({ scrollbackLog });
    h.host.sessions.set("s1", makeSession("s1"));
    h.host.emitData("s1", "to be deleted\n");
    await vi.waitFor(() => {
      scrollbackLog.flushAll();
      expect(scrollbackLog.readTail("s1")).toBe("to be deleted\n");
    });
    await h.remote.dispose("s1");
    expect(scrollbackLog.readTail("s1")).toBe("");
    await h.cleanup();
  });

  it("disposeAll() removes scrollback logs for every mirrored session", async () => {
    const h = await makeHarness({ scrollbackLog });
    h.host.sessions.set("a", makeSession("a"));
    h.host.sessions.set("b", makeSession("b"));
    // Drive a SESSION_LIST broadcast so the mirror picks up "a" and "b".
    await h.remote.create({
      projectId: "p1",
      command: { type: "shell" },
      cwd: "/",
    });
    h.host.emitData("a", "A");
    h.host.emitData("b", "B");
    await vi.waitFor(() => {
      scrollbackLog.flushAll();
      expect(scrollbackLog.readTail("a")).toBe("A");
      expect(scrollbackLog.readTail("b")).toBe("B");
    });
    await h.remote.disposeAll();
    expect(scrollbackLog.readTail("a")).toBe("");
    expect(scrollbackLog.readTail("b")).toBe("");
    await h.cleanup();
  });
});

describe("RemotePtyHost -- failure modes", () => {
  /*
   * Hand-rolled "daemon" stubs in this file must emit BOTH HELLO_ACK and
   * an initial SESSION_LIST (even if empty) by protocol -- RemotePtyHost
   * defers handshake resolution until the first SESSION_LIST applies, so
   * an HELLO_ACK-only stub now hangs `connect()` indefinitely.
   */
  const writeHandshake = (s: net.Socket): void => {
    s.write(
      encodeFrame({
        type: FrameType.HELLO_ACK,
        connectionId: 1,
        generation: 1n,
        requestId: 1,
        payload: encodeJsonPayload({
          protocolVersion: PROTOCOL_VERSION,
          connectionId: 1,
          generation: "1",
          daemonPid: 1,
          daemonStartedAt: "x",
        } satisfies HelloAckPayload),
      }),
    );
    s.write(
      encodeFrame({
        type: FrameType.SESSION_LIST,
        connectionId: 1,
        generation: 1n,
        requestId: 0,
        payload: encodeJsonPayload({
          sessions: [],
        } satisfies SessionListPayload),
      }),
    );
  };

  it("rejects pending requests with ipc-timeout if no ack arrives", async () => {
    const { serverSocket, clientSocket, cleanup } = await makeLoopback();
    // Stand-in daemon that ACKs HELLO but ignores everything else.
    serverSocket.on("data", () => {
      // First chunk is HELLO; reply once to lift handshake, then drop input.
      if (!(serverSocket as { _hello?: boolean })._hello) {
        (serverSocket as { _hello?: boolean })._hello = true;
        writeHandshake(serverSocket);
      }
    });
    const remote = await RemotePtyHost.connect({
      socket: clientSocket,
      requestTimeoutMs: 100,
    });
    await expect(
      remote.create({
        projectId: "p",
        command: { type: "shell" },
        cwd: "/",
      }),
    ).rejects.toMatchObject({ code: "ipc-timeout" });
    await cleanup();
  });

  it("rejects pending requests with connection-dropped on socket close", async () => {
    const { serverSocket, clientSocket, cleanup } = await makeLoopback();
    serverSocket.on("data", () => {
      if (!(serverSocket as { _hello?: boolean })._hello) {
        (serverSocket as { _hello?: boolean })._hello = true;
        writeHandshake(serverSocket);
      } else {
        // Server side drops mid-request -- expected to surface as connection-dropped.
        serverSocket.destroy();
      }
    });
    const remote = await RemotePtyHost.connect({
      socket: clientSocket,
      requestTimeoutMs: 1000,
    });
    await expect(
      remote.create({
        projectId: "p",
        command: { type: "shell" },
        cwd: "/",
      }),
    ).rejects.toMatchObject({ code: "connection-dropped" });
    await cleanup();
  });

  it("rejects pending requests with the daemon's NACK code", async () => {
    const { serverSocket, clientSocket, cleanup } = await makeLoopback();
    serverSocket.on("data", (chunk: Buffer) => {
      if (!(serverSocket as { _hello?: boolean })._hello) {
        (serverSocket as { _hello?: boolean })._hello = true;
        writeHandshake(serverSocket);
        return;
      }
      // Anything past HELLO is a request -- read the requestId at offset
      // 4 (type) + 4 (conn) + 8 (gen) = 16, then 4 bytes requestId BE.
      const requestId = chunk.readUInt32BE(4 + 4 + 8 + 1); // header layout per frames.ts
      serverSocket.write(
        encodeFrame({
          type: FrameType.NACK,
          connectionId: 1,
          generation: 1n,
          requestId,
          payload: encodeJsonPayload({
            code: "session-not-found",
            message: "no such session",
          } satisfies NackPayload),
        }),
      );
    });
    const remote = await RemotePtyHost.connect({
      socket: clientSocket,
      requestTimeoutMs: 1000,
    });
    await expect(remote.dispose("missing")).rejects.toMatchObject({
      code: "session-not-found",
    });
    await cleanup();
  });

  it("persist() ships project-domain snapshot to the daemon and ACKs", async () => {
    /*
     * state persistence delegate -- end-to-end test that proves the wire-up (persist() ->
     * PERSIST_PROJECT_DOMAINS_REQ -> daemon.handlePersistProjectDomains
     * -> store.internalMutate -> flush). If ACK_FRAME_TYPES forgets the
     * new ACK type, request() never resolves and this hangs (vitest
     * default timeout catches it). If the payload encoding drifts, the
     * daemon NACKs and the assertion below fails.
     */
    const stateDir = mkdtempSync(join(tmpdir(), "remote-persist-"));
    const daemonStore = new AppStateStore({
      dir: stateDir,
      debounceMs: 0,
    });
    const { serverSocket, clientSocket, cleanup } = await makeLoopback();
    const host = new FakeHost();
    const daemon = new PtyHostDaemon({ host, store: daemonStore });
    daemon.acceptConnection(serverSocket);
    const remote = await RemotePtyHost.connect({
      socket: clientSocket,
      requestTimeoutMs: 1000,
    });

    const project: Project = {
      id: "p-new",
      name: "demo",
      path: "/tmp/demo",
      createdAt: 1,
      lastAccessedAt: 1,
    };
    const snapshot: AppState = {
      ...daemonStore.get(),
      projects: [project],
      workItems: {
        [project.id]: [
          {
            id: "work-1",
            projectId: project.id,
            title: "Persist through daemon",
            status: "todo",
            acceptanceCriteria: [],
            attachments: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      paneCommands: [{ id: "cmd:dev", label: "Dev", initialInput: "pnpm dev" }],
      ideCommands: [
        { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
      ],
    };
    await remote.persist(snapshot);

    const after = daemonStore.get();
    expect(after.projects).toEqual([project]);
    expect(after.workItems[project.id]).toEqual([
      expect.objectContaining({
        id: "work-1",
        title: "Persist through daemon",
      }),
    ]);
    expect(after.paneCommands).toEqual([
      { id: "cmd:dev", label: "Dev", initialInput: "pnpm dev" },
    ]);
    expect(after.ideCommands).toEqual([
      { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
    ]);

    daemon.dispose();
    daemonStore.destroy();
    await cleanup();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("persist() rejects with persist-failed when daemon has no store", async () => {
    /*
     * Defensive test -- production wiring always passes a store, but if
     * a misconfiguration ever drops it, the daemon NACKs with
     * `persist-failed` and the server's `onPersistError` hook surfaces
     * it. Verifies the NACK code reaches the caller intact.
     */
    const { serverSocket, clientSocket, cleanup } = await makeLoopback();
    const host = new FakeHost();
    const daemon = new PtyHostDaemon({ host });
    daemon.acceptConnection(serverSocket);
    const remote = await RemotePtyHost.connect({
      socket: clientSocket,
      requestTimeoutMs: 1000,
    });

    const snapshot: AppState = {
      version: 1,
      projects: [],
      projectStates: {},
      workItems: {},
      sessions: [],
      sessionRecords: [],
      paneCommands: [],
      ideCommands: [],
      serviceConfig: {
        preventIdleSleep: false,
        portDetection: "all-interfaces",
        dropSizeMaxBytes: 1,
        dropSizeHardMaxBytes: 1,
      },
    };
    await expect(remote.persist(snapshot)).rejects.toMatchObject({
      code: "persist-failed",
    });

    daemon.dispose();
    await cleanup();
  });

  it("SESSION_LIST replaces the mirror in one shot", async () => {
    const { serverSocket, clientSocket, cleanup } = await makeLoopback();
    serverSocket.once("data", () => {
      writeHandshake(serverSocket);
    });
    const remote = await RemotePtyHost.connect({
      socket: clientSocket,
      requestTimeoutMs: 1000,
    });
    // Seed mirror with one session.
    serverSocket.write(
      encodeFrame({
        type: FrameType.SESSION_UPDATE,
        connectionId: 1,
        generation: 1n,
        requestId: 0,
        payload: encodeJsonPayload({
          session: makeSession("a"),
        } satisfies SessionUpdatePayload),
      }),
    );
    await vi.waitFor(() =>
      expect(remote.list().map((s) => s.id)).toEqual(["a"]),
    );
    // Replace via SESSION_LIST.
    serverSocket.write(
      encodeFrame({
        type: FrameType.SESSION_LIST,
        connectionId: 1,
        generation: 1n,
        requestId: 0,
        payload: encodeJsonPayload({
          sessions: [makeSession("b"), makeSession("c")],
        } satisfies SessionListPayload),
      }),
    );
    await vi.waitFor(() =>
      expect(
        remote
          .list()
          .map((s) => s.id)
          .sort(),
      ).toEqual(["b", "c"]),
    );
    await cleanup();
  });
});

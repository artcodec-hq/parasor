import { Buffer } from "node:buffer";
import * as net from "node:net";
import type { Session, SessionEndReason } from "@parasor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSessionInput, PtyHost } from "../host.js";
import {
  decodeGenerationStreamPayload,
  encodeFrame,
  encodeGenerationStreamPayload,
  type Frame,
  FrameParser,
  FrameType,
} from "../host-protocol/frames.js";
import {
  type CreateAckPayload,
  decodeJsonPayload,
  encodeJsonPayload,
  type HelloAckPayload,
  type HelloPayload,
  type InitClientAckPayload,
  type NackPayload,
  PROTOCOL_VERSION,
  type SessionUpdatePayload,
} from "../host-protocol/messages.js";
import { PtyHostDaemon } from "./daemon.js";

/*
 * PtyHostDaemon integration tests.
 *
 * Each test stands up a real loopback TCP server, hands the daemon-side
 * socket to PtyHostDaemon.acceptConnection, and drives the client side
 * by writing encoded frames and parsing replies. We use TCP rather than
 * Unix domain sockets because port 0 is sandbox-portable; the daemon
 * itself only sees `Duplex` so the wire transport is irrelevant.
 *
 * The PtyHost is faked -- see `FakeHost` below. Real `InProcessPtyHost`
 * spawns node-pty which posix_openpt-fails inside the sandbox; the fake
 * lets us assert the daemon's frame routing without a real PTY. Parity
 * tests against `InProcessPtyHost` live in the contract suite.
 */

class FakeHost implements PtyHost {
  sessions = new Map<string, Session>();
  writes: { id: string; data: string; generation?: number }[] = [];
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
  /** controls what create() resolves with; mutate per test */
  nextCreateResult: { ok: true; session: Session } | { ok: false; err: Error } =
    {
      ok: true,
      session: makeSession("default-session"),
    };
  /** controls restart() */
  nextRestartResult:
    | { ok: true; session: Session }
    | { ok: false; err: Error } = {
    ok: true,
    session: makeSession("default-session"),
  };
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

  write(id: string, data: string, generation?: number): void {
    this.writes.push({ id, data, generation });
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

  loadPersistedSession(): void {
    /* unused */
  }

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

interface SocketPair {
  server: net.Server;
  daemonSide: net.Socket;
  clientSide: net.Socket;
  clientFrames: Frame[];
  /** resolves once at least N frames are buffered */
  awaitFrames: (count: number, timeoutMs?: number) => Promise<Frame[]>;
  cleanup: () => Promise<void>;
}

async function makeSocketPair(): Promise<SocketPair> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  const acceptedPromise = new Promise<net.Socket>((resolve) =>
    server.once("connection", resolve),
  );
  const clientSide = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    clientSide.once("connect", resolve);
    clientSide.once("error", reject);
  });
  const daemonSide = await acceptedPromise;

  const parser = new FrameParser();
  const clientFrames: Frame[] = [];
  let waiters: {
    resolve: () => void;
    reject: (e: Error) => void;
    need: number;
  }[] = [];
  clientSide.on("data", (chunk: Buffer) => {
    const got = parser.push(chunk);
    clientFrames.push(...got);
    waiters = waiters.filter((w) => {
      if (clientFrames.length >= w.need) {
        w.resolve();
        return false;
      }
      return true;
    });
  });

  return {
    server,
    daemonSide,
    clientSide,
    clientFrames,
    awaitFrames: async (count, timeoutMs = 1000) => {
      if (clientFrames.length >= count) return clientFrames.slice();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `awaitFrames timeout (need ${count}, got ${clientFrames.length})`,
            ),
          );
        }, timeoutMs);
        waiters.push({
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
          need: count,
        });
      });
      return clientFrames.slice();
    },
    cleanup: async () => {
      clientSide.destroy();
      daemonSide.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected test value");
  return value;
}

function send(
  client: net.Socket,
  type: number,
  connectionId: number,
  generation: bigint,
  requestId: number,
  payload: Buffer,
): void {
  client.write(
    encodeFrame({ type, connectionId, generation, requestId, payload }),
  );
}

function helloPayload(version = PROTOCOL_VERSION, serverPid = 1234): Buffer {
  return encodeJsonPayload({
    protocolVersion: version,
    serverPid,
  } satisfies HelloPayload);
}

describe("PtyHostDaemon handshake", () => {
  let pair: SocketPair;
  let host: FakeHost;
  let daemon: PtyHostDaemon;

  beforeEach(async () => {
    pair = await makeSocketPair();
    host = new FakeHost();
    daemon = new PtyHostDaemon({
      host,
      daemonPid: 9999,
      daemonStartedAt: "2026-04-28T00:00:00.000Z",
    });
    daemon.acceptConnection(pair.daemonSide);
  });

  afterEach(async () => {
    daemon.dispose();
    await pair.cleanup();
  });

  it("HELLO -> HELLO_ACK with assigned (connectionId, generation)", async () => {
    send(pair.clientSide, FrameType.HELLO, 0, 0n, 1, helloPayload());
    const frames = await pair.awaitFrames(2);
    const ack = frames.find((f) => f.type === FrameType.HELLO_ACK);
    expect(ack).toBeDefined();
    expect(must(ack).requestId).toBe(1);
    const body = decodeJsonPayload<HelloAckPayload>(must(ack).payload);
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(body.daemonPid).toBe(9999);
    expect(body.connectionId).toBe(must(ack).connectionId);
    expect(BigInt(body.generation)).toBe(must(ack).generation);
  });

  it("HELLO_ACK is followed by SESSION_LIST snapshot of host.list()", async () => {
    host.sessions.set("s-pre-1", makeSession("s-pre-1"));
    host.sessions.set("s-pre-2", makeSession("s-pre-2"));
    send(pair.clientSide, FrameType.HELLO, 0, 0n, 1, helloPayload());
    const frames = await pair.awaitFrames(2);
    const list = frames.find((f) => f.type === FrameType.SESSION_LIST);
    expect(list).toBeDefined();
    const body = decodeJsonPayload<{ sessions: Session[] }>(must(list).payload);
    expect(body.sessions.map((s) => s.id).sort()).toEqual([
      "s-pre-1",
      "s-pre-2",
    ]);
  });

  it("rejects MAJOR-mismatch HELLO with version-mismatch NACK and ends the socket", async () => {
    send(pair.clientSide, FrameType.HELLO, 0, 0n, 1, helloPayload("3.0.0"));
    const [nack] = await pair.awaitFrames(1);
    expect(nack.type).toBe(FrameType.NACK);
    const body = decodeJsonPayload<NackPayload>(nack.payload);
    expect(body.code).toBe("version-mismatch");
  });

  it("evicts pre-HELLO frames with handshake-required", async () => {
    send(pair.clientSide, FrameType.WRITE, 0, 0n, 0, Buffer.alloc(0));
    const [nack] = await pair.awaitFrames(1);
    expect(nack.type).toBe(FrameType.NACK);
    const body = decodeJsonPayload<NackPayload>(nack.payload);
    expect(body.code).toBe("handshake-required");
  });
});

describe("PtyHostDaemon eviction (single-current invariant)", () => {
  it("evicts the prior current on a second HELLO from a fresh connection", async () => {
    const a = await makeSocketPair();
    const host = new FakeHost();
    const daemon = new PtyHostDaemon({ host });
    daemon.acceptConnection(a.daemonSide);
    send(a.clientSide, FrameType.HELLO, 0, 0n, 1, helloPayload());
    await a.awaitFrames(2); // HELLO_ACK + SESSION_LIST

    const b = await makeSocketPair();
    daemon.acceptConnection(b.daemonSide);
    send(b.clientSide, FrameType.HELLO, 0, 0n, 1, helloPayload());

    // a should receive an eviction NACK after the initial 2 frames.
    const aFrames = await a.awaitFrames(3);
    const evicted = aFrames.find((f) => f.type === FrameType.NACK);
    expect(evicted).toBeDefined();
    const body = decodeJsonPayload<NackPayload>(must(evicted).payload);
    expect(body.code).toBe("evicted");

    daemon.dispose();
    await Promise.all([a.cleanup(), b.cleanup()]);
  });
});

describe("PtyHostDaemon CREATE/SET_TITLE/WRITE", () => {
  let pair: SocketPair;
  let host: FakeHost;
  let daemon: PtyHostDaemon;
  let conn: { id: number; gen: bigint };

  beforeEach(async () => {
    pair = await makeSocketPair();
    host = new FakeHost();
    daemon = new PtyHostDaemon({ host });
    daemon.acceptConnection(pair.daemonSide);
    send(pair.clientSide, FrameType.HELLO, 0, 0n, 1, helloPayload());
    // HELLO_ACK + SESSION_LIST snapshot -- drain both before the test runs.
    const initial = await pair.awaitFrames(2);
    const ack = initial.find((f) => f.type === FrameType.HELLO_ACK);
    const body = decodeJsonPayload<HelloAckPayload>(must(ack).payload);
    conn = { id: body.connectionId, gen: BigInt(body.generation) };
  });

  afterEach(async () => {
    daemon.dispose();
    await pair.cleanup();
  });

  it("CREATE_REQ -> CREATE_ACK + SESSION_UPDATE broadcast", async () => {
    host.nextCreateResult = { ok: true, session: makeSession("s-new") };
    send(
      pair.clientSide,
      FrameType.CREATE_REQ,
      conn.id,
      conn.gen,
      42,
      encodeJsonPayload({
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/tmp",
      }),
    );
    // expect 2 new frames: SESSION_UPDATE (broadcast) and CREATE_ACK
    // (req-bound). HELLO_ACK + SESSION_LIST already drained in beforeEach,
    // so the post-test buffer length is 4. Order can be either since both
    // are sent inside the same tick.
    const frames = await pair.awaitFrames(4);
    const ack = frames.find((f) => f.type === FrameType.CREATE_ACK);
    const upd = frames.find((f) => f.type === FrameType.SESSION_UPDATE);
    expect(ack).toBeDefined();
    expect(upd).toBeDefined();
    expect(ack?.requestId).toBe(42);
    expect(host.createCalls[0]).toEqual(
      expect.objectContaining({
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/tmp",
      }),
    );
  });

  it("CREATE_REQ forwards bootstrap input to the owned host", async () => {
    host.nextCreateResult = { ok: true, session: makeSession("s-new") };
    send(
      pair.clientSide,
      FrameType.CREATE_REQ,
      conn.id,
      conn.gen,
      43,
      encodeJsonPayload({
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/tmp",
        bootstrapInput: "pnpm dev\r",
      }),
    );
    await pair.awaitFrames(4);
    expect(host.createCalls[0]).toEqual(
      expect.objectContaining({ bootstrapInput: "pnpm dev\r" }),
    );
  });

  it("SET_TITLE fire-and-forget triggers SESSION_UPDATE broadcast", async () => {
    host.sessions.set("s1", makeSession("s1"));
    send(
      pair.clientSide,
      FrameType.SET_TITLE,
      conn.id,
      conn.gen,
      0,
      encodeJsonPayload({ sessionId: "s1", title: "renamed" }),
    );
    // beforeEach already buffered HELLO_ACK + SESSION_LIST -> expect 3 total.
    const frames = await pair.awaitFrames(3);
    const upd = frames.find((f) => f.type === FrameType.SESSION_UPDATE);
    expect(upd).toBeDefined();
    expect(host.sessions.get("s1")?.title).toBe("renamed");
  });

  it("INIT_CLIENT_REQ broadcasts SESSION_UPDATE after accepted attach", async () => {
    host.sessions.set("s1", makeSession("s1"));
    host.onInitClient = (id) => {
      const session = host.sessions.get(id);
      if (!session) return;
      host.sessions.set(id, { ...session, pid: 4321, state: "running" });
    };

    send(
      pair.clientSide,
      FrameType.INIT_CLIENT_REQ,
      conn.id,
      conn.gen,
      43,
      encodeJsonPayload({
        sessionId: "s1",
        clientId: "client-1",
        cols: 80,
        rows: 24,
      }),
    );

    const frames = await pair.awaitFrames(4);
    const ack = frames.find(
      (f) => f.type === FrameType.INIT_CLIENT_ACK && f.requestId === 43,
    );
    const update = frames.find((f) => f.type === FrameType.SESSION_UPDATE);

    expect(decodeJsonPayload<InitClientAckPayload>(must(ack).payload)).toEqual({
      accepted: true,
    });
    expect(
      decodeJsonPayload<SessionUpdatePayload>(must(update).payload).session,
    ).toMatchObject({ id: "s1", pid: 4321, state: "running" });
  });

  it("WRITE forwards binary stream payload to host.write", async () => {
    const sessionId = "s1";
    const data = "ls -la\r";
    // PTY generation gate: gen=0 is the "no gating" sentinel and reaches host.write as
    // `generation: undefined`.
    const payload = encodeGenerationStreamPayload(
      sessionId,
      Buffer.from(data, "utf8"),
      0,
    );
    send(pair.clientSide, FrameType.WRITE, conn.id, conn.gen, 0, payload);
    // Allow the daemon to drain; nothing is acked, so we poll host state.
    await vi.waitFor(() => expect(host.writes.length).toBe(1));
    expect(host.writes[0]).toEqual({
      id: sessionId,
      data,
      generation: undefined,
    });
  });

  it("WRITE forwards a non-zero generation tag through to host.write (PTY generation gate)", async () => {
    const sessionId = "s1";
    const data = "x";
    const payload = encodeGenerationStreamPayload(
      sessionId,
      Buffer.from(data, "utf8"),
      7,
    );
    send(pair.clientSide, FrameType.WRITE, conn.id, conn.gen, 0, payload);
    await vi.waitFor(() => expect(host.writes.length).toBe(1));
    expect(host.writes[0]).toEqual({ id: sessionId, data, generation: 7 });
  });

  it("PAUSE_OUTPUT and RESUME_OUTPUT forward to the host", async () => {
    const payload = encodeJsonPayload({
      sessionId: "s1",
      clientId: "client-A",
    });
    send(
      pair.clientSide,
      FrameType.PAUSE_OUTPUT,
      conn.id,
      conn.gen,
      0,
      payload,
    );
    send(
      pair.clientSide,
      FrameType.RESUME_OUTPUT,
      conn.id,
      conn.gen,
      0,
      payload,
    );

    await vi.waitFor(() =>
      expect(host.pauses).toEqual([{ id: "s1", clientId: "client-A" }]),
    );
    expect(host.resumes).toEqual([{ id: "s1", clientId: "client-A" }]);
  });

  it("rejects frames with mismatched (connectionId, generation)", async () => {
    send(
      pair.clientSide,
      FrameType.SET_TITLE,
      conn.id + 99,
      conn.gen,
      0,
      encodeJsonPayload({ sessionId: "s1", title: "x" }),
    );
    // 2 initial (HELLO_ACK + SESSION_LIST) + 1 NACK = 3.
    const frames = await pair.awaitFrames(3);
    const nack = frames.find((f) => f.type === FrameType.NACK);
    expect(nack).toBeDefined();
    const body = decodeJsonPayload<NackPayload>(must(nack).payload);
    expect(body.code).toBe("frame-invalid");
  });
});

describe("PtyHostDaemon broadcasts (DATA / SESSION_EXIT)", () => {
  let pair: SocketPair;
  let host: FakeHost;
  let daemon: PtyHostDaemon;

  beforeEach(async () => {
    pair = await makeSocketPair();
    host = new FakeHost();
    daemon = new PtyHostDaemon({ host });
    daemon.acceptConnection(pair.daemonSide);
    send(pair.clientSide, FrameType.HELLO, 0, 0n, 1, helloPayload());
    // HELLO_ACK + SESSION_LIST snapshot.
    await pair.awaitFrames(2);
  });

  afterEach(async () => {
    daemon.dispose();
    await pair.cleanup();
  });

  it("forwards onSessionData -> DATA frame with generation-tagged stream payload (PTY generation gate)", async () => {
    host.emitData("s1", "hello\n", 5);
    // 2 initial + 1 DATA = 3.
    const frames = await pair.awaitFrames(3);
    const data = frames.find((f) => f.type === FrameType.DATA);
    expect(data).toBeDefined();
    const decoded = decodeGenerationStreamPayload(must(data).payload);
    expect(decoded.sessionId).toBe("s1");
    expect(decoded.generation).toBe(5);
    expect(decoded.data.toString("utf8")).toBe("hello\n");
  });

  it("forwards onSessionExit -> SESSION_EXIT frame", async () => {
    host.onSessionExit?.("s1", 3, { type: "exit", code: 0 });
    const frames = await pair.awaitFrames(3);
    const exit = frames.find((f) => f.type === FrameType.SESSION_EXIT);
    expect(exit).toBeDefined();
    const body = decodeJsonPayload<{
      sessionId: string;
      sessionGeneration: number;
      endReason: SessionEndReason;
    }>(must(exit).payload);
    expect(body).toEqual({
      sessionId: "s1",
      sessionGeneration: 3,
      endReason: { type: "exit", code: 0 },
    });
  });
});

/*
 * -- multi-session concurrency.
 *
 * The daemon must keep CREATE/WRITE/DATA streams cleanly separated when
 * multiple sessions are live in the same connection. These tests pin
 * three failure modes specific to this scope:
 *   1. interleaved CREATE_REQs return ACKs bound to their own requestId
 *      regardless of host resolution order (no cross-talk in the ack map)
 *   2. DATA broadcasts from the host's onSessionData carry the right
 *      sessionId in their stream payload (no fan-out merging)
 *   3. WRITE frames target the right session on the host (no shared mutable
 *      state in the daemon's WRITE dispatch)
 *
 * Together these cover  "multiple sessions 並列" without needing a real
 * PTY (which posix_openpt-fails inside the sandbox).
 */
describe("PtyHostDaemon multi-session concurrency", () => {
  let pair: SocketPair;
  let host: FakeHost;
  let daemon: PtyHostDaemon;
  let conn: { id: number; gen: bigint };

  beforeEach(async () => {
    pair = await makeSocketPair();
    host = new FakeHost();
    daemon = new PtyHostDaemon({ host });
    daemon.acceptConnection(pair.daemonSide);
    send(pair.clientSide, FrameType.HELLO, 0, 0n, 1, helloPayload());
    const initial = await pair.awaitFrames(2);
    const ack = initial.find((f) => f.type === FrameType.HELLO_ACK);
    const body = decodeJsonPayload<HelloAckPayload>(must(ack).payload);
    conn = { id: body.connectionId, gen: BigInt(body.generation) };
  });

  afterEach(async () => {
    daemon.dispose();
    await pair.cleanup();
  });

  it("two interleaved CREATE_REQs each ACK to their own requestId (no cross-talk)", async () => {
    // Stash the original create() impl so we can reroute to a deterministic
    // queue. Pending host.create() calls are kept by-input so we can resolve
    // them in a controlled order independent of arrival order.
    const pending: Array<{
      input: CreateSessionInput;
      resolve: (s: Session) => void;
    }> = [];
    host.create = async (input) =>
      new Promise<Session>((resolve) => {
        pending.push({ input, resolve });
      });

    // Fire two CREATE_REQs back-to-back with distinct requestIds and
    // distinct projectIds (so we can match the ack to its originating req).
    send(
      pair.clientSide,
      FrameType.CREATE_REQ,
      conn.id,
      conn.gen,
      11,
      encodeJsonPayload({
        projectId: "p-A",
        command: { type: "shell" },
        cwd: "/a",
      }),
    );
    send(
      pair.clientSide,
      FrameType.CREATE_REQ,
      conn.id,
      conn.gen,
      22,
      encodeJsonPayload({
        projectId: "p-B",
        command: { type: "shell" },
        cwd: "/b",
      }),
    );
    await vi.waitFor(() => expect(pending.length).toBe(2));

    // Resolve in REVERSE order to prove ack routing isn't FIFO-bound.
    // Stamp host.sessions before resolving -- the daemon's commit-stage
    // broadcast pivot reads host.list() so the SESSION_UPDATE frame must
    // see the inserted session, mirroring what FakeHost.create() does
    // for the default code path.
    const sB = makeSession("s-B");
    sB.projectId = "p-B";
    host.sessions.set("s-B", sB);
    pending[1].resolve(sB);
    const sA = makeSession("s-A");
    sA.projectId = "p-A";
    host.sessions.set("s-A", sA);
    pending[0].resolve(sA);

    // beforeEach drained 2 frames (HELLO_ACK + SESSION_LIST). Now we expect
    // 2 SESSION_UPDATE broadcasts + 2 CREATE_ACK = 4 more, total 6.
    const frames = await pair.awaitFrames(6);
    const acks = frames.filter((f) => f.type === FrameType.CREATE_ACK);
    expect(acks).toHaveLength(2);
    const ackByReq = new Map<number, CreateAckPayload>();
    for (const f of acks) {
      ackByReq.set(f.requestId, decodeJsonPayload<CreateAckPayload>(f.payload));
    }
    expect(ackByReq.get(11)?.session.id).toBe("s-A");
    expect(ackByReq.get(22)?.session.id).toBe("s-B");

    // Both sessions are recorded on the host.
    expect(host.sessions.has("s-A")).toBe(true);
    expect(host.sessions.has("s-B")).toBe(true);
  });

  it("DATA broadcasts route per-session -- no payload bleed across sessions", async () => {
    host.sessions.set("s1", makeSession("s1"));
    host.sessions.set("s2", makeSession("s2"));

    host.emitData("s1", "AAA");
    host.emitData("s2", "BBB");
    host.emitData("s1", "CCC");

    // 2 initial drained + 3 DATA frames = 5.
    const frames = await pair.awaitFrames(5);
    const dataFrames = frames.filter((f) => f.type === FrameType.DATA);
    expect(dataFrames).toHaveLength(3);
    const decoded = dataFrames.map((f) => {
      // PTY generation gate: DATA frames carry generation-tagged stream payloads.
      const d = decodeGenerationStreamPayload(f.payload);
      return { id: d.sessionId, body: d.data.toString("utf8") };
    });
    expect(decoded).toEqual([
      { id: "s1", body: "AAA" },
      { id: "s2", body: "BBB" },
      { id: "s1", body: "CCC" },
    ]);
  });

  it("WRITE frames target the right session and do not contaminate siblings", async () => {
    host.sessions.set("s1", makeSession("s1"));
    host.sessions.set("s2", makeSession("s2"));

    const writeFor = (sessionId: string, data: string): Buffer =>
      // PTY generation gate WRITE format includes a uint32 BE generation between
      // sessionId and data; 0 = "no gating" sentinel.
      encodeGenerationStreamPayload(sessionId, Buffer.from(data, "utf8"), 0);
    send(
      pair.clientSide,
      FrameType.WRITE,
      conn.id,
      conn.gen,
      0,
      writeFor("s1", "alpha"),
    );
    send(
      pair.clientSide,
      FrameType.WRITE,
      conn.id,
      conn.gen,
      0,
      writeFor("s2", "beta"),
    );
    send(
      pair.clientSide,
      FrameType.WRITE,
      conn.id,
      conn.gen,
      0,
      writeFor("s1", "gamma"),
    );

    await vi.waitFor(() => expect(host.writes.length).toBe(3));
    expect(host.writes).toEqual([
      { id: "s1", data: "alpha", generation: undefined },
      { id: "s2", data: "beta", generation: undefined },
      { id: "s1", data: "gamma", generation: undefined },
    ]);
  });
});

/*
 * -- `drain()` must wait for in-flight CREATE/RESTART/
 * DISPOSE/INIT_CLIENT host-call chains before resolving so bootstrap can
 * sequence shutdownAll -> flushSync -> marker -> destroy without leaving an
 * orphan PTY behind a CREATE that won the race against SIGTERM. The test
 * stalls host.create() on a controllable Promise, asserts drain blocks
 * while it is unsettled, then unblocks the host call and expects drain to
 * resolve and the persisted side-effect to land before drain returns.
 */
class StallableHost extends FakeHost {
  pendingCreate: {
    resolve: (s: Session) => void;
    reject: (e: Error) => void;
  } | null = null;
  createSettled = false;

  override async create(input: CreateSessionInput): Promise<Session> {
    return new Promise<Session>((resolve, reject) => {
      this.pendingCreate = {
        resolve: (s) => {
          this.createSettled = true;
          this.sessions.set(s.id, {
            ...s,
            projectId: input.projectId,
            cwd: input.cwd,
          });
          resolve({ ...s, projectId: input.projectId, cwd: input.cwd });
        },
        reject,
      };
    });
  }
}

describe("PtyHostDaemon drain (HIGH 2 in-flight settle)", () => {
  let pair: SocketPair;
  let host: StallableHost;
  let daemon: PtyHostDaemon;
  let conn: { id: number; gen: bigint };

  beforeEach(async () => {
    pair = await makeSocketPair();
    host = new StallableHost();
    daemon = new PtyHostDaemon({ host });
    daemon.acceptConnection(pair.daemonSide);
    send(pair.clientSide, FrameType.HELLO, 0, 0n, 1, helloPayload());
    const initial = await pair.awaitFrames(2);
    const ack = initial.find((f) => f.type === FrameType.HELLO_ACK);
    const body = decodeJsonPayload<HelloAckPayload>(must(ack).payload);
    conn = { id: body.connectionId, gen: BigInt(body.generation) };
  });

  afterEach(async () => {
    await pair.cleanup();
  });

  it("drain() blocks until in-flight CREATE handler settles", async () => {
    send(
      pair.clientSide,
      FrameType.CREATE_REQ,
      conn.id,
      conn.gen,
      99,
      encodeJsonPayload({
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/tmp",
      }),
    );
    // Wait until handleCreate has registered the in-flight chain.
    await vi.waitFor(() => expect(host.pendingCreate).not.toBeNull());

    daemon.dispose();
    let drainResult: boolean | null = null;
    const drainPromise = daemon.drain().then((r) => {
      drainResult = r;
    });

    // drain must not resolve while host.create() is still pending. Yield
    // a few microtasks so any premature resolution would have surfaced.
    await Promise.resolve();
    await Promise.resolve();
    expect(drainResult).toBeNull();
    expect(host.createSettled).toBe(false);

    // Settle the host call. drain should now resolve with the side effect
    // (sessions map mutation) already committed.
    must(host.pendingCreate).resolve(makeSession("created-during-shutdown"));
    await drainPromise;
    expect(drainResult).toBe(true);
    expect(host.createSettled).toBe(true);
    expect(host.sessions.has("created-during-shutdown")).toBe(true);
  });

  it("drain() resolves immediately when no host-call chains are in flight", async () => {
    daemon.dispose();
    // Simply must not hang. A 50ms timeout guards against a regression
    // that adds a never-settling internal promise to inFlight.
    const drained = await Promise.race([
      daemon.drain(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("drain hung with empty inFlight")),
          50,
        ),
      ),
    ]);
    expect(drained).toBe(true);
  });

  it("drain() returns false when timeoutMs elapses with in-flight host calls ()", async () => {
    send(
      pair.clientSide,
      FrameType.CREATE_REQ,
      conn.id,
      conn.gen,
      100,
      encodeJsonPayload({
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/tmp",
      }),
    );
    await vi.waitFor(() => expect(host.pendingCreate).not.toBeNull());

    daemon.dispose();
    // 50ms timeout -- host.create stays pending, so drain should resolve
    // false after the deadline rather than hang.
    const start = Date.now();
    const drained = await daemon.drain(50);
    const elapsed = Date.now() - start;
    expect(drained).toBe(false);
    // Drain must not block beyond the configured timeout (small slack
    // for scheduler jitter).
    expect(elapsed).toBeLessThan(500);
    // After timeout the chain is still pending -- settle it so afterEach
    // does not leak unhandled rejection state.
    must(host.pendingCreate).resolve(makeSession("post-timeout-settle"));
  });
});

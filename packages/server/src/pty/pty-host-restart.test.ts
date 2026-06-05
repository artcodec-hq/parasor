import * as net from "node:net";
import type { Session, SessionEndReason } from "@parasor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSessionInput, PtyHost } from "./host.js";
import { PtyHostDaemon } from "./host-daemon/daemon.js";
import {
  encodeFrame,
  type Frame,
  FrameParser,
  FrameType,
} from "./host-protocol/frames.js";
import {
  decodeJsonPayload,
  encodeJsonPayload,
  type HelloAckPayload,
  type HelloPayload,
  type NackPayload,
  PROTOCOL_VERSION,
} from "./host-protocol/messages.js";
import { RemotePtyHost, RemotePtyHostError } from "./remote-host.js";

/*
 * Epoch-fence race harness .  / .
 *
 * Goal: prove that if server-A is evicted while one of its commands
 * is still mid-flight inside the daemon, the post-eviction commit
 * (a) does NOT deliver an ACK to A's now-defunct connection, and
 * (b) DOES broadcast the resulting state change to the new current
 *     server B so daemon-host and B-mirror stay in sync.
 *
 * The contract is "ACK gate + broadcast pivot": side effects in async-await
 * cannot be aborted without serializing the request queue, and silently
 * un-creating a session that B is about to inherit forces B to wait for the
 * next snapshot to learn it ever existed.
 *
 * To make the timing deterministic we use a `ControllableHost` whose
 * `create()` returns a promise we resolve manually inside the test --
 * this lets us interleave A's request, A's eviction, and the host
 * resolution in a known order.
 */

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected test value");
  return value;
}

class ControllableHost implements PtyHost {
  sessions = new Map<string, Session>();
  pendingCreates: {
    resolve: (s: Session) => void;
    reject: (e: Error) => void;
    input: CreateSessionInput;
  }[] = [];
  /*
   * Direct counter for `host.write()` invocations -- tests that need to
   * prove a stale-generation WRITE was dropped at the daemon's epoch
   * fence assert against this rather than the unrelated `pendingCreates`
   * proxy. the proxy never moves whether or not
   * write() was called, so the original assertion was vacuous.
   */
  writes: { id: string; data: string }[] = [];
  private dataListeners: ((
    sessionId: string,
    data: string,
    generation: number,
  ) => void)[] = [];
  private inputListeners: ((sessionId: string, data: string) => void)[] = [];
  onSessionExit:
    | ((id: string, generation: number, reason: SessionEndReason) => void)
    | null = null;

  setPtyEnv(): void {}
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
    return new Promise<Session>((resolve, reject) => {
      this.pendingCreates.push({ resolve, reject, input });
    });
  }

  resolveLatestCreate(session: Session): void {
    const next = this.pendingCreates.shift();
    if (!next) throw new Error("no pending create");
    this.sessions.set(session.id, session);
    next.resolve(session);
  }

  async restart(id: string): Promise<Session> {
    const s = this.sessions.get(id);
    if (!s) throw new Error("not found");
    return s;
  }

  setTitle(): boolean {
    return false;
  }
  setPinned(): boolean {
    return false;
  }
  write(id: string, data: string): void {
    this.writes.push({ id, data });
    for (const l of this.inputListeners) l(id, data);
  }
  resize(): void {}
  refresh(): void {}
  pauseOutput(): void {}
  resumeOutput(): void {}
  async initClient(): Promise<{ ok: false }> {
    return { ok: false };
  }
  async attachClient(): Promise<{ ok: false }> {
    return { ok: false };
  }
  detachClient(): void {}
  async dispose(id: string): Promise<void> {
    this.sessions.delete(id);
  }
  async disposeAll(): Promise<void> {
    this.sessions.clear();
  }
  async shutdownAll(): Promise<void> {}
  loadPersistedSession(): void {}
  onSessionInput(l: (sessionId: string, data: string) => void): void {
    this.inputListeners.push(l);
  }
  onSessionData(
    l: (sessionId: string, data: string, generation: number) => void,
  ): void {
    this.dataListeners.push(l);
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
  daemonSocket: net.Socket;
  clientSocket: net.Socket;
  cleanup: () => Promise<void>;
}

async function makePair(server: net.Server, port: number): Promise<SocketPair> {
  const accepted = new Promise<net.Socket>((resolve) =>
    server.once("connection", resolve),
  );
  const clientSocket = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    clientSocket.once("connect", resolve);
    clientSocket.once("error", reject);
  });
  const daemonSocket = await accepted;
  return {
    daemonSocket,
    clientSocket,
    cleanup: async () => {
      clientSocket.destroy();
      daemonSocket.destroy();
    },
  };
}

interface RawClient {
  socket: net.Socket;
  parser: FrameParser;
  frames: Frame[];
  send: (
    type: number,
    connectionId: number,
    generation: bigint,
    requestId: number,
    payload: Buffer,
  ) => void;
  awaitFrames: (count: number, timeoutMs?: number) => Promise<Frame[]>;
}

function wrapRaw(socket: net.Socket): RawClient {
  const parser = new FrameParser();
  const frames: Frame[] = [];
  const waiters: {
    need: number;
    resolve: () => void;
    reject: (e: Error) => void;
  }[] = [];
  socket.on("data", (chunk: Buffer) => {
    const got = parser.push(chunk);
    frames.push(...got);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (frames.length >= waiters[i].need) {
        waiters[i].resolve();
        waiters.splice(i, 1);
      }
    }
  });
  return {
    socket,
    parser,
    frames,
    send(type, connectionId, generation, requestId, payload) {
      socket.write(
        encodeFrame({ type, connectionId, generation, requestId, payload }),
      );
    },
    awaitFrames(count, timeoutMs = 1000) {
      if (frames.length >= count) return Promise.resolve(frames.slice());
      return new Promise<Frame[]>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `awaitFrames timeout (need ${count}, got ${frames.length})`,
              ),
            ),
          timeoutMs,
        );
        waiters.push({
          need: count,
          resolve: () => {
            clearTimeout(timer);
            resolve(frames.slice());
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
      });
    },
  };
}

const helloPayload = (): Buffer =>
  encodeJsonPayload({
    protocolVersion: PROTOCOL_VERSION,
    serverPid: 1,
  } satisfies HelloPayload);

describe("epoch fence race -- server reconnect mid-create", () => {
  let server: net.Server;
  let port: number;
  let host: ControllableHost;
  let daemon: PtyHostDaemon;
  let pairs: SocketPair[] = [];

  beforeEach(async () => {
    server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as net.AddressInfo).port;
    host = new ControllableHost();
    daemon = new PtyHostDaemon({ host });
  });

  afterEach(async () => {
    daemon.dispose();
    for (const p of pairs) await p.cleanup();
    pairs = [];
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("A's in-flight create commits server-side; B sees the new session via SESSION_UPDATE pivot", async () => {
    // -- Server A: connect, complete handshake, send CREATE_REQ --
    const pairA = await makePair(server, port);
    pairs.push(pairA);
    daemon.acceptConnection(pairA.daemonSocket);
    const rawA = wrapRaw(pairA.clientSocket);
    rawA.send(FrameType.HELLO, 0, 0n, 1, helloPayload());
    const [helloAckA] = await rawA.awaitFrames(1);
    const ackA = decodeJsonPayload<HelloAckPayload>(helloAckA.payload);
    rawA.send(
      FrameType.CREATE_REQ,
      ackA.connectionId,
      BigInt(ackA.generation),
      77,
      encodeJsonPayload({
        projectId: "proj-a",
        command: { type: "shell" },
        cwd: "/",
      }),
    );
    // host.create is now stuck inside ControllableHost.pendingCreates.
    await vi.waitFor(() => expect(host.pendingCreates.length).toBe(1));

    // -- Server B: fresh connection, completes HELLO. A gets evicted. --
    const pairB = await makePair(server, port);
    pairs.push(pairB);
    daemon.acceptConnection(pairB.daemonSocket);
    const remoteB = await RemotePtyHost.connect({
      socket: pairB.clientSocket,
      requestTimeoutMs: 2000,
    });
    // A receives an `evicted` NACK after HELLO_ACK + SESSION_LIST land.
    const aFramesAfterEvict = await rawA.awaitFrames(3);
    const evictNack = aFramesAfterEvict.find((f) => f.type === FrameType.NACK);
    expect(evictNack).toBeDefined();
    const body = decodeJsonPayload<NackPayload>(must(evictNack).payload);
    expect(body.code).toBe("evicted");

    // -- Resolve A's host.create AFTER eviction.
    //    The side effect is irrevocable
    //    in an async-await world, so the daemon does NOT roll it back.
    //    The fence withholds the CREATE_ACK from A's defunct conn, but
    //    SESSION_UPDATE broadcast pivots to currentServer (= B). --
    host.resolveLatestCreate(makeSession("phantom-A"));
    // Wait until B's mirror reflects the broadcast -- `vi.waitFor` polls
    // so we don't race on broadcast timing.
    await vi.waitFor(() =>
      expect(remoteB.get("phantom-A")?.id).toBe("phantom-A"),
    );

    // -- Assert: A never received a CREATE_ACK for requestId 77.
    //    Eviction killed A's wire and fenceCommit short-circuits the ACK. --
    const ackForA = rawA.frames.find(
      (f) => f.type === FrameType.CREATE_ACK && f.requestId === 77,
    );
    expect(ackForA).toBeUndefined();

    // -- Assert: B's mirror reflects the new session via SESSION_UPDATE
    //    pivot, with the same id the daemon-host now holds. --
    expect(remoteB.list().map((s) => s.id)).toEqual(["phantom-A"]);

    // -- Assert: daemon-host and B-mirror agree on the world.
    //    "Phantom" was the previous wording when we tried (incorrectly) to
    //    un-create it; under the revised design the session is real on
    //    both sides and the name no longer applies. --
    expect(host.sessions.has("phantom-A")).toBe(true);
  });

  it("stale-generation frame: stale-generation frame from A is silently dropped after eviction", async () => {
    const pairA = await makePair(server, port);
    pairs.push(pairA);
    daemon.acceptConnection(pairA.daemonSocket);
    const rawA = wrapRaw(pairA.clientSocket);
    rawA.send(FrameType.HELLO, 0, 0n, 1, helloPayload());
    const [helloAckA] = await rawA.awaitFrames(1);
    const ackA = decodeJsonPayload<HelloAckPayload>(helloAckA.payload);

    // B takes over.
    const pairB = await makePair(server, port);
    pairs.push(pairB);
    daemon.acceptConnection(pairB.daemonSocket);
    const remoteB = await RemotePtyHost.connect({
      socket: pairB.clientSocket,
      requestTimeoutMs: 2000,
    });
    // A is evicted; wait until HELLO_ACK + SESSION_LIST + eviction-NACK
    // (3 frames total) land before continuing.
    await rawA.awaitFrames(3);

    // -- A sends a stale-gen WRITE after eviction. Should be silently dropped
    //    -- no host.write call, no NACK to A (A's socket has been .end()ed),
    //    nothing on B's side either. --
    const beforeWrites = host.writes.length;
    rawA.send(
      FrameType.WRITE,
      ackA.connectionId,
      BigInt(ackA.generation),
      0,
      Buffer.from([3, 65, 66, 67, 100]),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Direct assertion: the daemon must NOT have called host.write() for
    // a frame whose generation/connectionId no longer match currentServer.
    expect(host.writes.length).toBe(beforeWrites);
    expect(remoteB.list()).toEqual([]);
  });

  it("A's in-flight RESTART after eviction broadcasts SESSION_UPDATE to B", async () => {
    // Pre-existing session B will inherit. Stamp it on the host before A
    // connects so A's initial snapshot includes it.
    host.sessions.set("s-restart", {
      ...makeSession("s-restart"),
      generation: 1,
    });

    // -- Server A: connect, send RESTART_REQ which will resolve manually --
    const pairA = await makePair(server, port);
    pairs.push(pairA);
    daemon.acceptConnection(pairA.daemonSocket);
    const rawA = wrapRaw(pairA.clientSocket);
    rawA.send(FrameType.HELLO, 0, 0n, 1, helloPayload());
    const [helloAckA] = await rawA.awaitFrames(1);
    const ackA = decodeJsonPayload<HelloAckPayload>(helloAckA.payload);

    // Make restart() block until we say so. We override the shared host
    // method just for this test -- the rest of ControllableHost is reused.
    let releaseRestart: (s: Session) => void = () => {};
    host.restart = (id: string) =>
      new Promise<Session>((resolve) => {
        releaseRestart = (s: Session) => {
          host.sessions.set(id, s);
          resolve(s);
        };
      });

    rawA.send(
      FrameType.RESTART_REQ,
      ackA.connectionId,
      BigInt(ackA.generation),
      88,
      encodeJsonPayload({ sessionId: "s-restart" }),
    );

    // -- Server B takes over before restart resolves. --
    const pairB = await makePair(server, port);
    pairs.push(pairB);
    daemon.acceptConnection(pairB.daemonSocket);
    const remoteB = await RemotePtyHost.connect({
      socket: pairB.clientSocket,
      requestTimeoutMs: 2000,
    });
    await rawA.awaitFrames(3); // HELLO_ACK + SESSION_LIST + eviction NACK
    expect(remoteB.get("s-restart")?.generation).toBe(1);

    // -- Resolve restart with bumped generation (simulates new pid+gen). --
    releaseRestart({ ...makeSession("s-restart"), generation: 2 });

    // -- B's mirror should pick up the new generation via SESSION_UPDATE. --
    await vi.waitFor(() =>
      expect(remoteB.get("s-restart")?.generation).toBe(2),
    );
    // -- A never received a RESTART_ACK for requestId 88. --
    const ackForA = rawA.frames.find(
      (f) => f.type === FrameType.RESTART_ACK && f.requestId === 88,
    );
    expect(ackForA).toBeUndefined();
  });

  it("A's in-flight DISPOSE_ALL after eviction broadcasts SESSION_LIST snapshot to B", async () => {
    host.sessions.set("s1", makeSession("s1"));
    host.sessions.set("s2", makeSession("s2"));

    const pairA = await makePair(server, port);
    pairs.push(pairA);
    daemon.acceptConnection(pairA.daemonSocket);
    const rawA = wrapRaw(pairA.clientSocket);
    rawA.send(FrameType.HELLO, 0, 0n, 1, helloPayload());
    const [helloAckA] = await rawA.awaitFrames(1);
    const ackA = decodeJsonPayload<HelloAckPayload>(helloAckA.payload);

    // Block disposeAll until we let it through.
    let releaseDispose: () => void = () => {};
    host.disposeAll = () =>
      new Promise<void>((resolve) => {
        releaseDispose = () => {
          host.sessions.clear();
          resolve();
        };
      });

    rawA.send(
      FrameType.DISPOSE_ALL_REQ,
      ackA.connectionId,
      BigInt(ackA.generation),
      99,
      encodeJsonPayload({}),
    );

    // -- B takes over while disposeAll is pending. --
    const pairB = await makePair(server, port);
    pairs.push(pairB);
    daemon.acceptConnection(pairB.daemonSocket);
    const remoteB = await RemotePtyHost.connect({
      socket: pairB.clientSocket,
      requestTimeoutMs: 2000,
    });
    await rawA.awaitFrames(3);
    expect(
      remoteB
        .list()
        .map((s) => s.id)
        .sort(),
    ).toEqual(["s1", "s2"]);

    // -- Let disposeAll complete after eviction. --
    releaseDispose();

    // -- B should observe a SESSION_LIST snapshot reflecting the cleared host. --
    await vi.waitFor(() => expect(remoteB.list()).toEqual([]));
    const ackForA = rawA.frames.find(
      (f) => f.type === FrameType.DISPOSE_ALL_ACK && f.requestId === 99,
    );
    expect(ackForA).toBeUndefined();
  });
});

describe("epoch fence race -- server crash + immediate reconnect", () => {
  let server: net.Server;
  let port: number;
  let host: ControllableHost;
  let daemon: PtyHostDaemon;

  beforeEach(async () => {
    server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as net.AddressInfo).port;
    host = new ControllableHost();
    daemon = new PtyHostDaemon({ host });
  });

  afterEach(async () => {
    daemon.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("RemotePtyHost.create rejects with connection-dropped when server-A's socket closes mid-flight", async () => {
    const pairA = await makePair(server, port);
    daemon.acceptConnection(pairA.daemonSocket);
    const remoteA = await RemotePtyHost.connect({
      socket: pairA.clientSocket,
      requestTimeoutMs: 5000,
    });
    const inflight = remoteA.create({
      projectId: "p",
      command: { type: "shell" },
      cwd: "/",
    });
    // Wait until daemon enqueues the create (waiting on our test seam).
    await vi.waitFor(() => expect(host.pendingCreates.length).toBe(1));

    // A's socket dies (simulate server crash).
    pairA.clientSocket.destroy();
    pairA.daemonSocket.destroy();

    await expect(inflight).rejects.toBeInstanceOf(RemotePtyHostError);
    await expect(inflight).rejects.toMatchObject({
      code: "connection-dropped",
    });
  });
});

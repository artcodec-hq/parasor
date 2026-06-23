import type { Session } from "@parasor/shared";
import {
  encodeFlowPauseFrame,
  encodeFlowResumeFrame,
  encodeInputFrame,
  encodeResizeFrame,
  MALFORMED_FRAME_CLOSE_THRESHOLD,
} from "@parasor/shared";
import type { WSMessageReceive } from "hono/ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";
import type {
  AttachClientCapabilities,
  AttachClientResult,
  AttachClientSink,
  CreateSessionInput,
  PtyHost,
} from "../pty/host.js";
import { TerminalPresenceManager } from "../pty/terminal-presence-manager.js";
import {
  cleanupTerminalRelay,
  handleTerminalMessage,
  setupTerminalRelay,
} from "./terminal.js";

class FakeWs {
  readyState = 1;
  raw = { bufferedAmount: 0 };
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  sent: Array<string | Uint8Array | ArrayBuffer> = [];
  send = (data: string | ArrayBuffer | Uint8Array<ArrayBuffer>) => {
    this.sent.push(data);
  };
  close = (code?: number, reason?: string) => {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  };
}

class FakePtyHost implements PtyHost {
  attachCalls: Array<{
    id: string;
    clientId: string;
    cols: number;
    rows: number;
    capabilities: AttachClientCapabilities;
  }> = [];
  attachResult: AttachClientResult = {
    ok: true,
    attachToken: 1,
    capabilities: { binary: true, chunkedReplay: true },
    serverState: { generation: 1, lastDeliveredSeq: null, oldestSeq: null },
    replay: "none",
  };
  writes: Array<{ id: string; data: string; generation?: number }> = [];
  resizes: Array<{ id: string; cols: number; rows: number }> = [];
  refreshes: string[] = [];
  pauses: Array<{ id: string; clientId: string }> = [];
  resumes: Array<{ id: string; clientId: string }> = [];
  onRefresh: ((id: string) => void) | null = null;
  capturedSink: AttachClientSink | null = null;
  capturedLegacyListener: ((data: string) => void) | null = null;
  sessionPresent = true;

  setPtyEnv(): void {}
  list() {
    return [];
  }
  get(id: string) {
    if (!this.sessionPresent) return undefined;
    // Minimal stub session -- only `get` presence is checked by the relay.
    return {
      id,
      projectId: "p",
      title: "t",
      command: { kind: "shell" },
      cwd: "/",
      pinned: false,
      createdAt: 0,
      updatedAt: 0,
      generation: 1,
      state: "running",
    } as unknown as ReturnType<PtyHost["get"]>;
  }
  listByProject() {
    return [];
  }
  getScrollback() {
    return null;
  }
  getForegroundProcess() {
    return null;
  }
  async create(_: CreateSessionInput): Promise<Session> {
    throw new Error("not used");
  }
  async restart(): Promise<Session> {
    throw new Error("not used");
  }
  setTitle() {
    return true;
  }
  setPinned() {
    return true;
  }
  write(id: string, data: string, generation?: number): void {
    this.writes.push({ id, data, generation });
  }
  resize(id: string, cols: number, rows: number): void {
    this.resizes.push({ id, cols, rows });
  }
  refresh(id: string): void {
    this.refreshes.push(id);
    this.onRefresh?.(id);
  }
  pauseOutput(id: string, clientId: string): void {
    this.pauses.push({ id, clientId });
  }
  resumeOutput(id: string, clientId: string): void {
    this.resumes.push({ id, clientId });
  }
  async initClient(
    _id?: string,
    _clientId?: string,
    _cols?: number,
    _rows?: number,
    listener?: (data: string) => void,
  ): Promise<{ ok: true; attachToken: number } | { ok: false }> {
    this.capturedLegacyListener = listener ?? null;
    return { ok: true, attachToken: 1 };
  }
  async attachClient(
    id: string,
    clientId: string,
    cols: number,
    rows: number,
    capabilities: AttachClientCapabilities,
    sink: AttachClientSink,
  ): Promise<AttachClientResult> {
    this.attachCalls.push({ id, clientId, cols, rows, capabilities });
    this.capturedSink = sink;
    return this.attachResult;
  }
  detachClient(): void {}
  async dispose(): Promise<void> {}
  async disposeAll(): Promise<void> {}
  async shutdownAll(): Promise<void> {}
  loadPersistedSession(): void {}
  onSessionInput(): void {}
  onSessionData(): void {}
  onSessionExit = null;
}

function strEvent(data: string): MessageEvent<WSMessageReceive> {
  return { data } as unknown as MessageEvent<WSMessageReceive>;
}
function binEvent(buf: Uint8Array): MessageEvent<WSMessageReceive> {
  return { data: buf } as unknown as MessageEvent<WSMessageReceive>;
}

describe("ws/terminal -- capability negotiation", () => {
  let ws: FakeWs;
  let host: FakePtyHost;

  beforeEach(() => {
    ws = new FakeWs();
    host = new FakePtyHost();
    setupTerminalRelay(ws, "sess", "client", host);
  });

  it("rejects WS upgrade for missing session", () => {
    const ws2 = new FakeWs();
    const host2 = new FakePtyHost();
    host2.sessionPresent = false;
    setupTerminalRelay(ws2, "missing", "c", host2);
    expect(ws2.closeCalls).toEqual([
      { code: 1008, reason: "Session not found" },
    ]);
  });

  it("first non-init frame closes the WS with 1008", async () => {
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(JSON.stringify({ type: "input", data: "x" })),
    );
    expect(ws.closeCalls).toEqual([{ code: 1008, reason: "init expected" }]);
  });

  it("init with capabilities.binary=true triggers attachClient + init-ack", async () => {
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );
    expect(host.attachCalls).toHaveLength(1);
    expect(host.attachCalls[0]).toMatchObject({
      id: "sess",
      cols: 80,
      rows: 24,
      capabilities: { binary: true, chunkedReplay: true },
    });
    expect(ws.sent).toHaveLength(1);
    const ack = JSON.parse(ws.sent[0] as string);
    expect(ack.type).toBe("init-ack");
    expect(ack.capabilities).toEqual({ binary: true, chunkedReplay: true });
    expect(ack.replay).toBe("none");
    expect(host.refreshes).toHaveLength(0);
  });

  it("init without capabilities falls back to legacy initClient (no init-ack)", async () => {
    const initSpy = vi.spyOn(host, "initClient");
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(JSON.stringify({ type: "init", cols: 80, rows: 24 })),
    );
    expect(initSpy).toHaveBeenCalledOnce();
    expect(host.attachCalls).toHaveLength(0);
    expect(ws.sent).toHaveLength(0);
    expect(host.refreshes).toHaveLength(0);
  });

  it("emits replay envelope when attachClient returns kind=full", async () => {
    const events: string[] = [];
    const originalSend = ws.send;
    ws.send = (data) => {
      originalSend(data);
      events.push(typeof data === "string" ? JSON.parse(data).type : "binary");
    };
    host.onRefresh = (id) => events.push(`refresh:${id}`);
    host.attachResult = {
      ok: true,
      attachToken: 1,
      capabilities: { binary: true, chunkedReplay: true },
      serverState: { generation: 1, lastDeliveredSeq: "5", oldestSeq: "0" },
      replay: "full",
      fullReplay: "snapshot-data",
    };
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );
    expect(ws.sent).toHaveLength(2);
    const replay = JSON.parse(ws.sent[1] as string);
    expect(replay).toEqual({ type: "replay", data: "snapshot-data" });
    expect(events).toEqual(["init-ack", "replay"]);
  });

  it("includes replay diagnostics in full replay trace events", async () => {
    const recorder = new TerminalTraceRecorder({
      enabled: true,
      now: () => 123,
    });
    const tracedWs = new FakeWs();
    const tracedHost = new FakePtyHost();
    tracedHost.attachResult = {
      ok: true,
      attachToken: 1,
      capabilities: { binary: false, chunkedReplay: false },
      serverState: { generation: 1, lastDeliveredSeq: null, oldestSeq: null },
      replay: "full",
      fullReplay: "snapshot-data",
      replayDiagnostics: {
        source: "headless-snapshot",
        rawBytes: 4096,
        replayBytes: 13,
        headlessDurationMs: 12.3,
        headlessBufferLines: 42,
        headlessEmittedLines: 24,
        scrollbackLines: 10000,
        maxBytes: 1048576,
      },
    };
    setupTerminalRelay(tracedWs, "sess", "client", tracedHost, recorder);

    await handleTerminalMessage(
      tracedWs,
      "sess",
      "client",
      tracedHost,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
      recorder,
    );

    expect(
      recorder.list().find((event) => event.type === "pty-attach-complete"),
    ).toMatchObject({
      payload: {
        replay: "full",
        replayDiagnostics: {
          source: "headless-snapshot",
          rawBytes: 4096,
          replayBytes: 13,
          headlessDurationMs: 12.3,
        },
      },
    });
    expect(
      recorder.list().find((event) => event.type === "ws-replay"),
    ).toMatchObject({
      payload: {
        replay: "full",
        dataLength: 13,
        replayDiagnostics: {
          source: "headless-snapshot",
          rawBytes: 4096,
          replayBytes: 13,
        },
      },
    });
  });

  it("emits binary OUTPUT chunks when attachClient returns kind=delta", async () => {
    const events: string[] = [];
    const originalSend = ws.send;
    ws.send = (data) => {
      originalSend(data);
      events.push(typeof data === "string" ? JSON.parse(data).type : "binary");
    };
    host.onRefresh = (id) => events.push(`refresh:${id}`);
    host.attachResult = {
      ok: true,
      attachToken: 1,
      capabilities: { binary: true, chunkedReplay: true },
      serverState: { generation: 2, lastDeliveredSeq: "3", oldestSeq: "1" },
      replay: "delta",
      chunks: [
        { generation: 2, seq: 2n, data: Buffer.from("ab") },
        { generation: 2, seq: 3n, data: Buffer.from("cd") },
      ],
    };
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );
    // 1 init-ack JSON + 2 binary OUTPUT
    expect(ws.sent).toHaveLength(3);
    expect(typeof ws.sent[0]).toBe("string");
    const out1 = ws.sent[1] as Uint8Array;
    expect(out1[0]).toBe(0x10);
    const dv1 = new DataView(out1.buffer, out1.byteOffset, out1.byteLength);
    expect(dv1.getUint32(1, false)).toBe(2);
    expect(dv1.getBigUint64(5, false)).toBe(2n);
    expect(events).toEqual(["init-ack", "binary", "binary"]);
  });

  it("attachClient returning ok:false closes the WS with 1008", async () => {
    host.attachResult = { ok: false };
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );
    expect(ws.closeCalls).toEqual([
      { code: 1008, reason: "Session unavailable" },
    ]);
    expect(host.refreshes).toHaveLength(0);
  });

  it("host attach failure closes the terminal WS without rejecting", async () => {
    host.attachClient = vi.fn(async () => {
      throw new Error("RemotePtyHost socket is dropped");
    });
    await expect(
      handleTerminalMessage(
        ws,
        "sess",
        "client",
        host,
        strEvent(
          JSON.stringify({
            type: "init",
            cols: 80,
            rows: 24,
            capabilities: { binary: true, chunkedReplay: true },
          }),
        ),
      ),
    ).resolves.toBeUndefined();
    expect(ws.closeCalls).toEqual([
      { code: 1012, reason: "PTY host unavailable" },
    ]);
  });

  it("dispatches binary INPUT/RESIZE/FLOW after binary attach", async () => {
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      binEvent(encodeInputFrame(1, new TextEncoder().encode("hi"))),
    );
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      binEvent(encodeResizeFrame(120, 40)),
    );
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      binEvent(encodeFlowPauseFrame()),
    );
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      binEvent(encodeFlowResumeFrame()),
    );
    expect(host.writes).toEqual([{ id: "sess", data: "hi", generation: 1 }]);
    expect(host.resizes).toEqual([{ id: "sess", cols: 120, rows: 40 }]);
    expect(host.pauses).toEqual([{ id: "sess", clientId: "client" }]);
    expect(host.resumes).toEqual([{ id: "sess", clientId: "client" }]);
  });

  it("blocks desktop input until a desktop resize claim reclaims the terminal", async () => {
    const manager = new TerminalPresenceManager({
      onEffects: (effects) => {
        for (const effect of effects) {
          if (effect.type === "resize") {
            host.resize(effect.sessionId, effect.cols, effect.rows);
          }
        }
      },
    });
    const phone = new FakeWs();
    const desktop = new FakeWs();
    setupTerminalRelay(phone, "sess", "phone", host);
    await handleTerminalMessage(
      phone,
      "sess",
      "phone",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 44,
          rows: 18,
          clientKind: "mobile",
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
      undefined,
      manager,
    );
    setupTerminalRelay(desktop, "sess", "desktop", host);
    await handleTerminalMessage(
      desktop,
      "sess",
      "desktop",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 100,
          rows: 30,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
      undefined,
      manager,
    );
    host.writes = [];
    host.resizes = [];

    await handleTerminalMessage(
      desktop,
      "sess",
      "desktop",
      host,
      binEvent(encodeInputFrame(1, new TextEncoder().encode("blocked"))),
      undefined,
      manager,
    );
    await handleTerminalMessage(
      desktop,
      "sess",
      "desktop",
      host,
      binEvent(encodeResizeFrame(120, 40)),
      undefined,
      manager,
    );

    expect(host.writes).toEqual([]);
    expect(host.resizes).toEqual([{ id: "sess", cols: 120, rows: 40 }]);
    expect(manager.get("sess").driver).toEqual({ kind: "desktop" });

    await handleTerminalMessage(
      desktop,
      "sess",
      "desktop",
      host,
      binEvent(encodeInputFrame(1, new TextEncoder().encode("allowed"))),
      undefined,
      manager,
    );

    expect(host.writes).toEqual([
      { id: "sess", data: "allowed", generation: 1 },
    ]);
  });

  it("uses desktop layout when a mobile client attaches passively", async () => {
    const manager = new TerminalPresenceManager();
    manager.recordDesktopGeometry("sess", { cols: 120, rows: 40 });
    const phone = new FakeWs();
    setupTerminalRelay(phone, "sess", "phone", host);

    await handleTerminalMessage(
      phone,
      "sess",
      "phone",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 44,
          rows: 18,
          clientKind: "mobile",
          mobileMode: "desktop",
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
      undefined,
      manager,
    );

    expect(host.attachCalls.at(-1)).toMatchObject({
      id: "sess",
      clientId: "phone",
      cols: 120,
      rows: 40,
    });
    expect(manager.get("sess").driver).toEqual({ kind: "idle" });
  });

  it("records sanitized terminal relay trace events when enabled", async () => {
    const recorder = new TerminalTraceRecorder({
      enabled: true,
      now: () => 123,
    });
    const tracedWs = new FakeWs();
    const tracedHost = new FakePtyHost();
    setupTerminalRelay(tracedWs, "sess", "client", tracedHost, recorder);

    await handleTerminalMessage(
      tracedWs,
      "sess",
      "client",
      tracedHost,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
      recorder,
    );
    await handleTerminalMessage(
      tracedWs,
      "sess",
      "client",
      tracedHost,
      binEvent(encodeInputFrame(1, new TextEncoder().encode("secret input"))),
      recorder,
    );

    const events = recorder.list();
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "ws-setup",
        "ws-message",
        "ws-init",
        "pty-attach-start",
        "pty-attach-complete",
        "ws-init-ack",
        "pty-write",
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("secret input");
    expect(events.find((event) => event.type === "pty-write")).toMatchObject({
      sessionId: "sess",
      clientId: "client",
      payload: { wire: "binary", dataLength: 12, generation: 1 },
    });
  });

  it("samples high-volume terminal output trace without evicting init events", async () => {
    const recorder = new TerminalTraceRecorder({
      enabled: true,
      maxEvents: 20,
      now: () => 123,
    });
    const tracedWs = new FakeWs();
    const tracedHost = new FakePtyHost();
    setupTerminalRelay(tracedWs, "sess", "client", tracedHost, recorder);

    await handleTerminalMessage(
      tracedWs,
      "sess",
      "client",
      tracedHost,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
      recorder,
    );

    for (let seq = 1; seq <= 1000; seq += 1) {
      tracedHost.capturedSink?.onChunk(1, BigInt(seq), Buffer.alloc(3));
    }

    const events = recorder.list();
    const outputEvents = events.filter((event) => event.type === "ws-output");
    expect(outputEvents.length).toBeLessThanOrEqual(10);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "ws-init",
        "pty-attach-start",
        "pty-attach-complete",
        "ws-init-ack",
      ]),
    );
    expect(outputEvents[0]).toMatchObject({
      type: "ws-output",
      sessionId: "sess",
      clientId: "client",
      payload: {
        wire: "binary",
        chunks: 1,
        byteLength: 3,
        firstGeneration: 1,
        lastGeneration: 1,
        firstSeq: "1",
        lastSeq: "1",
      },
    });
    expect(outputEvents.at(-1)).toMatchObject({
      payload: {
        wire: "binary",
        chunks: 100,
        byteLength: 300,
        firstSeq: "802",
        lastSeq: "901",
      },
    });
  });

  it("dispatches JSON flow control after init", async () => {
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(JSON.stringify({ type: "init", cols: 80, rows: 24 })),
    );
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(JSON.stringify({ type: "flow-pause" })),
    );
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(JSON.stringify({ type: "flow-resume" })),
    );
    expect(host.pauses).toEqual([{ id: "sess", clientId: "client" }]);
    expect(host.resumes).toEqual([{ id: "sess", clientId: "client" }]);
  });

  it("treats malformed flow-control binary frames as malformed without dispatching", async () => {
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );

    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      binEvent(new Uint8Array([0x03, 0x00])),
    );

    expect(host.pauses).toEqual([]);
    expect(ws.closeCalls).toEqual([]);
  });

  it("malformed binary frames accumulate; threshold-1 stays open, threshold closes", async () => {
    // Attach first.
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );
    // Below threshold -- WS stays open.
    for (let i = 0; i < MALFORMED_FRAME_CLOSE_THRESHOLD - 1; i++) {
      await handleTerminalMessage(
        ws,
        "sess",
        "client",
        host,
        binEvent(new Uint8Array([0xff, 0xff])),
      );
    }
    expect(ws.closeCalls).toHaveLength(0);
    // One more pushes us over the threshold.
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      binEvent(new Uint8Array([0xff, 0xff])),
    );
    expect(ws.closeCalls).toEqual([
      { code: 1008, reason: "binary frame validation" },
    ]);
  });

  /*
   * PTY generation gate: a JSON input frame with a generation field outside
   * the wire-uint32 range (negative, > 0xFFFFFFFF, NaN, non-integer) must be
   * rejected and counted toward the malformed-frame budget rather than
   * silently truncated by `>>> 0` or written through to the PTY.
   */
  it("rejects JSON input with out-of-range generation (PTY generation gate)", async () => {
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: false, chunkedReplay: false },
        }),
      ),
    );
    const before = host.writes.length;
    for (const bad of [-1, 0xff_ff_ff_ff + 1, 1.5, Number.NaN]) {
      await handleTerminalMessage(
        ws,
        "sess",
        "client",
        host,
        strEvent(JSON.stringify({ type: "input", data: "x", generation: bad })),
      );
    }
    expect(host.writes.length).toBe(before);
  });

  it("cleanupTerminalRelay is a no-op before init (no attachToken minted)", () => {
    // Attach fencing: a WS that closes before init must NOT call detachClient
    // at all -- host treats undefined token as unconditional delete and
    // would wipe a sibling WS that has already taken over this clientId.
    const detachSpy = vi.spyOn(host, "detachClient");
    cleanupTerminalRelay(ws, "sess", "client", host);
    expect(detachSpy).not.toHaveBeenCalled();
  });

  it("cleanupTerminalRelay forwards captured attachToken after binary attach", async () => {
    host.attachResult = {
      ok: true,
      attachToken: 42,
      capabilities: { binary: true, chunkedReplay: true },
      serverState: { generation: 1, lastDeliveredSeq: null, oldestSeq: null },
      replay: "none",
    };
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );
    const detachSpy = vi.spyOn(host, "detachClient");
    cleanupTerminalRelay(ws, "sess", "client", host);
    expect(detachSpy).toHaveBeenCalledWith("sess", "client", 42);
  });

  it("ws closed during attachClient await triggers immediate detach with minted token", async () => {
    // Attach fencing: if the WS closes while attachClient is awaiting, the
    // host has already minted an entry under our freshly-issued token.
    // We must release it inline rather than leak it -- otherwise a
    // future reconnect under the same clientId is blocked by ghost state.
    let resolveAttach: (r: AttachClientResult) => void = () => {};
    host.attachClient = vi.fn(
      (
        _id: string,
        _clientId: string,
        _cols: number,
        _rows: number,
        _caps: AttachClientCapabilities,
        _sink: AttachClientSink,
      ): Promise<AttachClientResult> =>
        new Promise<AttachClientResult>((resolve) => {
          resolveAttach = resolve;
        }),
    );
    const detachSpy = vi.spyOn(host, "detachClient");
    const promise = handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );
    // Simulate the WS closing while attachClient is still pending.
    ws.readyState = 3;
    resolveAttach({
      ok: true,
      attachToken: 7,
      capabilities: { binary: true, chunkedReplay: true },
      serverState: { generation: 1, lastDeliveredSeq: null, oldestSeq: null },
      replay: "none",
    });
    await promise;
    expect(detachSpy).toHaveBeenCalledWith("sess", "client", 7);
    expect(host.refreshes).toHaveLength(0);
  });
});

describe("ws/terminal -- server backpressure", () => {
  let ws: FakeWs;
  let host: FakePtyHost;

  const initBinary = async () => {
    setupTerminalRelay(ws, "sess", "client", host);
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(
        JSON.stringify({
          type: "init",
          cols: 80,
          rows: 24,
          capabilities: { binary: true, chunkedReplay: true },
        }),
      ),
    );
  };

  beforeEach(() => {
    ws = new FakeWs();
    host = new FakePtyHost();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pauses the PTY past the high-water mark and resumes once the buffer drains", async () => {
    vi.useFakeTimers();
    await initBinary();
    const sink = host.capturedSink;
    expect(sink).not.toBeNull();

    ws.raw.bufferedAmount = 2 * 1024 * 1024; // above the 1 MiB high-water
    sink?.onChunk(1, 1n, Buffer.from("x"));
    expect(host.pauses).toEqual([{ id: "sess", clientId: "client" }]);
    expect(host.resumes).toEqual([]);

    ws.raw.bufferedAmount = 0; // drained below the low-water
    vi.advanceTimersByTime(100);
    expect(host.resumes).toEqual([{ id: "sess", clientId: "client" }]);
  });

  it("does not pause below the high-water mark", async () => {
    await initBinary();
    ws.raw.bufferedAmount = 1024;
    host.capturedSink?.onChunk(1, 1n, Buffer.from("x"));
    expect(host.pauses).toEqual([]);
  });

  it("closes 1013 when the buffer blows past the hard ceiling", async () => {
    await initBinary();
    ws.raw.bufferedAmount = 9 * 1024 * 1024; // above the 8 MiB hard ceiling
    host.capturedSink?.onChunk(1, 1n, Buffer.from("x"));
    expect(ws.closeCalls).toContainEqual({
      code: 1013,
      reason: "backpressure",
    });
  });

  it("pauses once across congested chunks and runs a single drain poll", async () => {
    vi.useFakeTimers();
    await initBinary();
    ws.raw.bufferedAmount = 2 * 1024 * 1024;
    host.capturedSink?.onChunk(1, 1n, Buffer.from("a"));
    host.capturedSink?.onChunk(1, 2n, Buffer.from("b"));
    host.capturedSink?.onChunk(1, 3n, Buffer.from("c"));
    // serverPaused short-circuits later chunks; the AND guard keeps the PTY
    // paused without re-asserting, so a single pause suffices.
    expect(host.pauses).toHaveLength(1);

    ws.raw.bufferedAmount = 0;
    vi.advanceTimersByTime(100);
    expect(host.resumes).toEqual([{ id: "sess", clientId: "client" }]);
    // The poll cleared itself; later ticks do not resume again.
    vi.advanceTimersByTime(500);
    expect(host.resumes).toHaveLength(1);
  });

  it("server drain does not resume while the client is still flow-paused", async () => {
    vi.useFakeTimers();
    await initBinary();
    // Client asserts its own render backpressure first.
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(JSON.stringify({ type: "flow-pause" })),
    );
    expect(host.pauses).toHaveLength(1);

    // Server backpressure then kicks in and drains.
    ws.raw.bufferedAmount = 2 * 1024 * 1024;
    host.capturedSink?.onChunk(1, 1n, Buffer.from("x"));
    ws.raw.bufferedAmount = 0;
    vi.advanceTimersByTime(100);

    // The drain poll must NOT resume -- the client is still paused (finding #1).
    expect(host.resumes).toEqual([]);

    // Once the client also resumes, the PTY finally resumes.
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(JSON.stringify({ type: "flow-resume" })),
    );
    expect(host.resumes).toEqual([{ id: "sess", clientId: "client" }]);
  });

  it("client flow-resume does not resume while the server is still paused", async () => {
    vi.useFakeTimers();
    await initBinary();
    // Server backpressure pauses the PTY.
    ws.raw.bufferedAmount = 2 * 1024 * 1024;
    host.capturedSink?.onChunk(1, 1n, Buffer.from("x"));
    expect(host.pauses).toHaveLength(1);

    // A client flow-resume arrives while the send buffer is still congested.
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(JSON.stringify({ type: "flow-resume" })),
    );
    // syncPtyFlow keeps the PTY paused (serverPaused still true) -- no resume.
    expect(host.resumes).toEqual([]);

    // Buffer drains: now both reasons clear and the PTY resumes.
    ws.raw.bufferedAmount = 0;
    vi.advanceTimersByTime(100);
    expect(host.resumes).toEqual([{ id: "sess", clientId: "client" }]);
  });

  it("clears the drain poll on cleanup", async () => {
    vi.useFakeTimers();
    await initBinary();
    ws.raw.bufferedAmount = 2 * 1024 * 1024;
    host.capturedSink?.onChunk(1, 1n, Buffer.from("x"));
    expect(host.pauses).toHaveLength(1);

    cleanupTerminalRelay(ws, "sess", "client", host);
    ws.raw.bufferedAmount = 0;
    vi.advanceTimersByTime(500);
    // Timer was cleared by cleanup, so no resume fires post-detach.
    expect(host.resumes).toHaveLength(0);
  });

  it("applies backpressure on the legacy (non-binary) live-output path", async () => {
    vi.useFakeTimers();
    // Legacy init: no capabilities -> string-callback live output.
    setupTerminalRelay(ws, "sess", "client", host);
    await handleTerminalMessage(
      ws,
      "sess",
      "client",
      host,
      strEvent(JSON.stringify({ type: "init", cols: 80, rows: 24 })),
    );
    const emit = host.capturedLegacyListener;
    expect(emit).not.toBeNull();

    ws.raw.bufferedAmount = 2 * 1024 * 1024; // above the 1 MiB high-water
    emit?.("hello");
    expect(host.pauses).toEqual([{ id: "sess", clientId: "client" }]);
    expect(host.resumes).toEqual([]);

    ws.raw.bufferedAmount = 0; // drained below the low-water
    vi.advanceTimersByTime(100);
    expect(host.resumes).toEqual([{ id: "sess", clientId: "client" }]);
  });
});

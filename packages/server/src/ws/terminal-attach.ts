import {
  encodeExitFrame,
  encodeOutputFrame,
  type WsTerminalClientMessage,
  type WsTerminalServerMessage,
} from "@parasor/shared";
import type { RelayContext, TerminalWs } from "./terminal.js";
import { applyServerBackpressure } from "./terminal-flow.js";

type WsTerminalInitMessage = Extract<WsTerminalClientMessage, { type: "init" }>;
type DeclaredCapabilities = NonNullable<WsTerminalInitMessage["capabilities"]>;

const OUTPUT_TRACE_SAMPLE_CHUNKS = 100;
const OUTPUT_TRACE_SAMPLE_BYTES = 64 * 1024;
const OUTPUT_TRACE_SAMPLE_MS = 1000;

function sendJson(ws: TerminalWs, msg: WsTerminalServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

class OutputTraceSampler {
  private chunks = 0;
  private bytes = 0;
  private firstAt = 0;
  private firstGeneration: number | null = null;
  private lastGeneration: number | null = null;
  private firstSeq: string | null = null;
  private lastSeq: string | null = null;
  private emittedFirst = false;

  constructor(
    private readonly ctx: Pick<
      RelayContext,
      "traceRecorder" | "sessionId" | "clientId"
    >,
    private readonly wire: "binary" | "legacy",
  ) {}

  record(chunk: {
    byteLength: number;
    generation?: number;
    seq?: bigint | number | string;
  }): void {
    if (!this.ctx.traceRecorder?.isEnabled()) return;
    const now = performance.now();
    if (this.chunks === 0) {
      this.firstAt = now;
      this.firstGeneration = chunk.generation ?? null;
      this.firstSeq = chunk.seq === undefined ? null : String(chunk.seq);
    }
    this.chunks += 1;
    this.bytes += chunk.byteLength;
    this.lastGeneration = chunk.generation ?? this.lastGeneration;
    this.lastSeq = chunk.seq === undefined ? this.lastSeq : String(chunk.seq);

    if (
      !this.emittedFirst ||
      this.chunks >= OUTPUT_TRACE_SAMPLE_CHUNKS ||
      this.bytes >= OUTPUT_TRACE_SAMPLE_BYTES ||
      now - this.firstAt >= OUTPUT_TRACE_SAMPLE_MS
    ) {
      this.flush(now);
    }
  }

  private flush(now: number): void {
    if (this.chunks === 0) return;
    this.ctx.traceRecorder?.record(
      "ws-output",
      {
        wire: this.wire,
        chunks: this.chunks,
        byteLength: this.bytes,
        windowMs: Math.round((now - this.firstAt) * 10) / 10,
        firstGeneration: this.firstGeneration,
        lastGeneration: this.lastGeneration,
        firstSeq: this.firstSeq,
        lastSeq: this.lastSeq,
      },
      { sessionId: this.ctx.sessionId, clientId: this.ctx.clientId },
    );
    this.emittedFirst = true;
    this.chunks = 0;
    this.bytes = 0;
    this.firstAt = 0;
    this.firstGeneration = null;
    this.lastGeneration = null;
    this.firstSeq = null;
    this.lastSeq = null;
  }
}

/**
 * First-frame attach: choose the binary or legacy path from declared
 * capabilities. The caller ({@link handleInitFrame}) has already validated that
 * `msg` is the mandatory `init` and recorded the handshake.
 */
export async function attachClient(
  ctx: RelayContext,
  msg: WsTerminalInitMessage,
): Promise<void> {
  const declared = msg.capabilities;
  if (declared?.binary) {
    await attachBinaryClient(ctx, msg, declared);
    return;
  }
  await attachLegacyClient(ctx, msg);
}

/**
 * Binary capability path: atomically attach (replay decision + chunk listener
 * registered under the host mutex), ack, then flush full/delta replay. Honors
 * the attach fencing mid-await close race by releasing the freshly minted entry.
 */
async function attachBinaryClient(
  ctx: RelayContext,
  msg: WsTerminalInitMessage,
  declared: DeclaredCapabilities,
): Promise<void> {
  const { ws, state, sessionId, clientId, ptyManager, traceRecorder } = ctx;
  const outputTrace = new OutputTraceSampler(ctx, "binary");
  // -- the host method holds
  // its own mutex while computing the replay decision and registering
  // the chunk listener, so init-ack / replay / live OUTPUT cannot
  // interleave on the wire.
  traceRecorder?.record(
    "pty-attach-start",
    { mode: "binary", cols: msg.cols, rows: msg.rows },
    { sessionId, clientId },
  );
  const attachStart = performance.now();
  const result = await ptyManager.attachClient(
    sessionId,
    clientId,
    msg.cols,
    msg.rows,
    {
      binary: declared.binary,
      chunkedReplay: declared.chunkedReplay,
      lastSeen: declared.lastSeen,
    },
    {
      onChunk: (generation, seq, data) => {
        outputTrace.record({ byteLength: data.byteLength, generation, seq });
        if (ws.readyState === 1) {
          ws.send(encodeOutputFrame(generation, seq, data));
          applyServerBackpressure(ws, state, sessionId, clientId, ptyManager);
        }
      },
      onExit: (exitCode) => {
        if (ws.readyState === 1) {
          ws.send(encodeExitFrame(exitCode));
        }
      },
    },
  );

  if (!result.ok) {
    traceRecorder?.record(
      "pty-attach-failed",
      {
        mode: "binary",
        durationMs: Math.round((performance.now() - attachStart) * 10) / 10,
        reason: "unavailable",
      },
      { sessionId, clientId },
    );
    ws.close(1008, "Session unavailable");
    traceRecorder?.record(
      "ws-close",
      { code: 1008, reason: "Session unavailable" },
      { sessionId, clientId },
    );
    return;
  }

  state.attachToken = result.attachToken;
  traceRecorder?.record(
    "pty-attach-complete",
    {
      mode: "binary",
      durationMs: Math.round((performance.now() - attachStart) * 10) / 10,
      replay: result.replay,
      binary: result.capabilities.binary,
      chunkedReplay: result.capabilities.chunkedReplay,
      ...(result.replayDiagnostics
        ? { replayDiagnostics: result.replayDiagnostics }
        : {}),
    },
    { sessionId, clientId },
  );

  // Attach fencing: WS may have closed while attachClient() was awaiting.
  // The host has already minted a fresh entry under our token; if we
  // skip the cleanup detach (no init-ack will fire), the entry leaks
  // forever. Release it now using the just-captured token so a future
  // reconnect with the same clientId is not blocked by ghost state.
  if (ws.readyState !== 1) {
    ptyManager.detachClient(sessionId, clientId, result.attachToken);
    traceRecorder?.record(
      "pty-attach-abandoned",
      {
        mode: "binary",
        durationMs: Math.round((performance.now() - attachStart) * 10) / 10,
        attachToken: result.attachToken,
      },
      { sessionId, clientId },
    );
    return;
  }

  sendJson(ws, {
    type: "init-ack",
    capabilities: result.capabilities,
    serverState: result.serverState,
    replay: result.replay,
  });
  traceRecorder?.record(
    "ws-init-ack",
    {
      replay: result.replay,
      generation: result.serverState.generation,
      binary: result.capabilities.binary,
      chunkedReplay: result.capabilities.chunkedReplay,
    },
    { sessionId, clientId },
  );

  if (result.replay === "full" && result.fullReplay) {
    const fullReplay = result.fullReplay;
    traceRecorder?.recordLazy(
      "ws-replay",
      () => ({
        replay: "full",
        dataLength: fullReplay.length,
        ...(result.replayDiagnostics
          ? { replayDiagnostics: result.replayDiagnostics }
          : {}),
      }),
      { sessionId, clientId },
    );
    sendJson(ws, { type: "replay", data: fullReplay });
  } else if (result.replay === "delta" && result.chunks) {
    for (const chunk of result.chunks) {
      if (ws.readyState !== 1) break;
      traceRecorder?.recordLazy(
        "ws-replay",
        () => ({
          replay: "delta",
          byteLength: chunk.data.byteLength,
          generation: chunk.generation,
          seq: String(chunk.seq),
        }),
        { sessionId, clientId },
      );
      ws.send(encodeOutputFrame(chunk.generation, chunk.seq, chunk.data));
    }
  }

  // If the negotiated path turned out to be legacy (server doesn't
  // support binary, e.g. RemotePtyHost), `binaryAttached` stays
  // false so subsequent JSON input/resize/refresh keeps working.
  state.binaryAttached = result.capabilities.binary;
}

/**
 * Legacy path -- old client without capabilities. String OUTPUT is relayed
 * verbatim via the host's `initClient` listener. Honors the same attach fencing
 * mid-await close race as the binary path.
 */
async function attachLegacyClient(
  ctx: RelayContext,
  msg: WsTerminalInitMessage,
): Promise<void> {
  const { ws, state, sessionId, clientId, ptyManager, traceRecorder } = ctx;
  const outputTrace = new OutputTraceSampler(ctx, "legacy");
  traceRecorder?.record(
    "pty-attach-start",
    { mode: "legacy", cols: msg.cols, rows: msg.rows },
    { sessionId, clientId },
  );
  const legacyAttachStart = performance.now();
  const initResult = await ptyManager.initClient(
    sessionId,
    clientId,
    msg.cols,
    msg.rows,
    (data) => {
      outputTrace.record({ byteLength: Buffer.byteLength(data, "utf8") });
      if (ws.readyState === 1) {
        ws.send(data);
        applyServerBackpressure(ws, state, sessionId, clientId, ptyManager);
      }
    },
  );
  if (!initResult.ok) {
    traceRecorder?.record(
      "pty-attach-failed",
      {
        mode: "legacy",
        durationMs:
          Math.round((performance.now() - legacyAttachStart) * 10) / 10,
        reason: "unavailable",
      },
      { sessionId, clientId },
    );
    ws.close(1008, "Session unavailable");
    traceRecorder?.record(
      "ws-close",
      { code: 1008, reason: "Session unavailable" },
      { sessionId, clientId },
    );
    return;
  }
  state.attachToken = initResult.attachToken;
  traceRecorder?.record(
    "pty-attach-complete",
    {
      mode: "legacy",
      durationMs: Math.round((performance.now() - legacyAttachStart) * 10) / 10,
    },
    { sessionId, clientId },
  );
  // Attach fencing: same race as the binary path -- release the freshly-
  // minted entry if the WS closed mid-await so we do not leak a ghost
  // listener under this clientId.
  if (ws.readyState !== 1) {
    ptyManager.detachClient(sessionId, clientId, initResult.attachToken);
    traceRecorder?.record(
      "pty-attach-abandoned",
      {
        mode: "legacy",
        durationMs:
          Math.round((performance.now() - legacyAttachStart) * 10) / 10,
        attachToken: initResult.attachToken,
      },
      { sessionId, clientId },
    );
  }
}

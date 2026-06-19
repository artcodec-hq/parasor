import {
  decodeBinaryFrame,
  MALFORMED_FRAME_CLOSE_THRESHOLD,
  type TerminalClientKind,
  type WsTerminalClientMessage,
} from "@parasor/shared";
import type { WSMessageReceive } from "hono/ws";
import type { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";
import type { PtyHost } from "../pty/host.js";
import type { TerminalPresenceManager } from "../pty/terminal-presence-manager.js";
import { attachClient } from "./terminal-attach.js";
import { syncPtyFlow } from "./terminal-flow.js";

export interface TerminalWs {
  readyState: number;
  send: (data: string | ArrayBuffer | Uint8Array<ArrayBuffer>) => void;
  close: (code?: number, reason?: string) => void;
  /**
   * The underlying `ws` WebSocket (`@hono/node-ws` `WSContext.raw`), exposing
   * the per-socket send-buffer depth used for server-side backpressure. Optional
   * so transports that do not surface it degrade to no backpressure.
   */
  raw?: { bufferedAmount: number };
}

export interface TerminalRelayState {
  initialized: boolean;
  /** Set after a successful binary attach so input/resize/refresh
   *  arriving as JSON envelopes can still be handled (back-compat). */
  binaryAttached: boolean;
  malformedFrameCount: number;
  /**
   * Last `console.warn` for a malformed frame, monotonic ms. Throttles
   * R6 logging so a misbehaving client floods stderr at most once per
   * `MALFORMED_WARN_RATE_LIMIT_MS` while still tripping the cumulative
   * close at threshold (32).
   */
  lastMalformedWarnAt: number;
  /**
   * Attach fencing fence. Captured from the host's attach result and handed
   * back on detachClient so a stale onClose firing after a fresh attach
   * (same `clientId`) cannot wipe the new listener -- the host compares
   * this against its current entry's stamp and skips the delete on
   * mismatch.
   */
  attachToken?: number;
  /**
   * Two independent reasons the relay may want this client's PTY output paused:
   * the client's own render-buffer backpressure (`flow-pause`/`flow-resume`) and
   * the server's send-buffer backpressure. The host exposes a single
   * `flowPaused` bit per client, so the relay ANDs the two here (see
   * {@link syncPtyFlow}) -- the PTY resumes only when *neither* reason is active.
   * Tracking them separately stops one loop's resume from clobbering the other's
   * still-active pause.
   */
  clientPaused: boolean;
  serverPaused: boolean;
  clientKind: TerminalClientKind;
  /** Active drain poll while {@link serverPaused}; unref'd so it never holds the process. */
  drainTimer?: ReturnType<typeof setInterval>;
}

/** Minimum gap between malformed-frame warn emits (R6 rate-limit). */
const MALFORMED_WARN_RATE_LIMIT_MS = 5_000;

const wsState = new WeakMap<object, TerminalRelayState>();

/*
 * PTY generation gate: never trust a wire-supplied `generation: 0` once the server
 * knows the session has a real generation. The in-process / daemon write
 * gate treats 0 as a "no gating" sentinel for INTERNAL callers (pre-init
 * queued input that runs before any spawn has set a generation). A
 * malicious or buggy WS client could send `generation: 0` indefinitely
 * to bypass the auto-resume input gate and contaminate the new shell
 * with stale terminal-reply bytes. Translate wire 0 into the server's
 * authoritative current generation so the gate stays effective; only
 * fall back to `undefined` (the internal sentinel) when the session
 * itself has never been observed at any non-zero generation.
 *
 * PTY generation gate: validate the wire value before trusting it. The
 * binary frame parser writes the gen via `>>> 0` (uint32 truncation), so
 * a JSON client that sends `generation: 4294967296` lands as 0 and would
 * otherwise be coerced to the live gen -- silently bypassing the gate.
 * Reject anything that is not a uint32-shaped safe integer; the caller
 * treats the result as "drop frame" via `WIRE_GENERATION_REJECT`.
 */
const WIRE_GENERATION_REJECT = -1 as const;
type WireGenerationResult = number | undefined | typeof WIRE_GENERATION_REJECT;

function coerceWireGeneration(
  wire: number | undefined,
  ptyManager: PtyHost,
  sessionId: string,
): WireGenerationResult {
  if (wire !== undefined) {
    if (!Number.isSafeInteger(wire) || wire < 0 || wire > 0xff_ff_ff_ff) {
      return WIRE_GENERATION_REJECT;
    }
    if (wire > 0) return wire;
  }
  const known = ptyManager.get(sessionId)?.generation ?? 0;
  return known > 0 ? known : undefined;
}

export function setupTerminalRelay(
  ws: TerminalWs,
  sessionId: string,
  clientId: string,
  ptyManager: PtyHost,
  traceRecorder?: TerminalTraceRecorder,
): void {
  const session = ptyManager.get(sessionId);
  if (!session) {
    traceRecorder?.record(
      "ws-close",
      { code: 1008, reason: "Session not found", phase: "setup" },
      { sessionId, clientId },
    );
    ws.close(1008, "Session not found");
    return;
  }
  // Ended sessions are not rejected here -- initClient may auto-resume
  // them (shell/claude + graceful end). If auto-resume declines, the
  // init-frame handler below closes the socket with "Session unavailable".
  wsState.set(ws, {
    initialized: false,
    binaryAttached: false,
    malformedFrameCount: 0,
    lastMalformedWarnAt: 0,
    clientPaused: false,
    serverPaused: false,
    clientKind: "desktop",
  });
  traceRecorder?.record(
    "ws-setup",
    { state: session.state },
    { sessionId, clientId },
  );
}

export function cleanupTerminalRelay(
  ws: object,
  sessionId: string,
  clientId: string,
  ptyManager: PtyHost,
  traceRecorder?: TerminalTraceRecorder,
  terminalPresenceManager?: TerminalPresenceManager,
): void {
  const state = wsState.get(ws);
  if (state?.drainTimer) {
    clearInterval(state.drainTimer);
    state.drainTimer = undefined;
  }
  // Attach fencing: skip detach entirely when no attach has been minted for
  // this WS -- calling detachClient(..., undefined) degrades to an
  // unconditional delete on the host and would evict a sibling WS that
  // has already taken over the same `clientId`.
  if (state?.attachToken === undefined) {
    traceRecorder?.record(
      "ws-cleanup-skip",
      {
        hasState: !!state,
        initialized: !!state?.initialized,
        binaryAttached: !!state?.binaryAttached,
      },
      { sessionId, clientId },
    );
    return;
  }
  ptyManager.detachClient(sessionId, clientId, state.attachToken);
  if (state.clientKind === "mobile") {
    terminalPresenceManager?.unsubscribeMobile(sessionId, clientId);
  }
  traceRecorder?.record(
    "ws-cleanup",
    { attachToken: state.attachToken },
    { sessionId, clientId },
  );
}

/**
 * : malformed binary frames are dropped without
 * disconnecting on the first occurrence. Each WS accumulates a counter;
 * crossing `MALFORMED_FRAME_CLOSE_THRESHOLD` (32) closes the socket with
 * 1008 policy violation. This shapes the attack surface from "single
 * crafted frame crashes the server" into "abusive client gets cut off
 * after 32 strikes".
 *
 * Logging policy (by design): emit at most one `console.warn` per
 * `MALFORMED_WARN_RATE_LIMIT_MS` window per WS. Production-visible by
 * default -- silent dropping was the original failure mode that hid
 * malformed-frame attacks during the v1 review.
 */
function noteMalformedFrame(
  ws: TerminalWs,
  state: TerminalRelayState,
  reason: string,
  traceRecorder?: TerminalTraceRecorder,
  ids: { sessionId?: string; clientId?: string } = {},
): void {
  state.malformedFrameCount += 1;
  traceRecorder?.record(
    "malformed-frame",
    { reason, count: state.malformedFrameCount },
    ids,
  );
  const now = Date.now();
  if (now - state.lastMalformedWarnAt >= MALFORMED_WARN_RATE_LIMIT_MS) {
    state.lastMalformedWarnAt = now;
    // eslint-disable-next-line no-console
    console.warn(
      `[terminal] malformed binary frame (${state.malformedFrameCount}/${MALFORMED_FRAME_CLOSE_THRESHOLD}): ${reason}`,
    );
  }
  if (state.malformedFrameCount >= MALFORMED_FRAME_CLOSE_THRESHOLD) {
    ws.close(1008, "binary frame validation");
  }
}

export async function handleTerminalMessage(
  ws: TerminalWs,
  sessionId: string,
  clientId: string,
  ptyManager: PtyHost,
  event: MessageEvent<WSMessageReceive>,
  traceRecorder?: TerminalTraceRecorder,
  terminalPresenceManager?: TerminalPresenceManager,
): Promise<void> {
  try {
    await handleTerminalMessageUnsafe(
      ws,
      sessionId,
      clientId,
      ptyManager,
      event,
      traceRecorder,
      terminalPresenceManager,
    );
  } catch (err) {
    // A daemon-mode PTY host can disappear independently of the HTTP server.
    // Treat that as a terminal socket failure, not a process-level crash.
    // The browser will reconnect; the event socket remains available.
    // eslint-disable-next-line no-console
    console.warn(
      `[terminal] PTY host unavailable for session=${sessionId.slice(0, 8)}: ${(err as Error).message}`,
    );
    traceRecorder?.record(
      "ws-close",
      {
        code: 1012,
        reason: "PTY host unavailable",
        errorName: err instanceof Error ? err.name : "unknown",
        errorMessage: err instanceof Error ? err.message : undefined,
      },
      { sessionId, clientId },
    );
    if (ws.readyState === 1) ws.close(1012, "PTY host unavailable");
  }
}

/**
 * Per-message relay context. Bundles the fixed identifiers and collaborators a
 * handler needs so each handler stays within the params budget and reads as
 * `(ctx, payload)`. Built once per inbound message in
 * {@link handleTerminalMessageUnsafe}.
 */
export interface RelayContext {
  ws: TerminalWs;
  state: TerminalRelayState;
  sessionId: string;
  clientId: string;
  ptyManager: PtyHost;
  terminalPresenceManager?: TerminalPresenceManager;
  traceRecorder?: TerminalTraceRecorder;
}

/**
 * Thin dispatcher: classify the inbound frame (binary fast-path vs JSON
 * envelope, pre-init vs post-init) and hand off to the matching handler. No
 * relay logic lives here -- it only routes.
 */
async function handleTerminalMessageUnsafe(
  ws: TerminalWs,
  sessionId: string,
  clientId: string,
  ptyManager: PtyHost,
  event: MessageEvent<WSMessageReceive>,
  traceRecorder?: TerminalTraceRecorder,
  terminalPresenceManager?: TerminalPresenceManager,
): Promise<void> {
  const state = wsState.get(ws);
  if (!state) return;
  const ctx: RelayContext = {
    ws,
    state,
    sessionId,
    clientId,
    ptyManager,
    terminalPresenceManager,
    traceRecorder,
  };

  traceRecorder?.recordLazy(
    "ws-message",
    () => ({
      wire: typeof event.data === "string" ? "json" : "binary",
      byteLength:
        typeof event.data === "string"
          ? Buffer.byteLength(event.data, "utf8")
          : event.data instanceof Uint8Array
            ? event.data.byteLength
            : (event.data as ArrayBufferLike).byteLength,
      initialized: state.initialized,
    }),
    { sessionId, clientId },
  );

  // Binary frame fast-path. Once the client has attached with binary
  // capabilities, INPUT / RESIZE / REFRESH arrive as `[prefix][payload]`.
  // (`init` itself stays JSON because capability negotiation is JSON.)
  if (typeof event.data !== "string") {
    handleBinaryFrame(ctx, event.data);
    return;
  }

  let msg: WsTerminalClientMessage;
  try {
    msg = JSON.parse(event.data);
  } catch {
    // Ignore malformed messages -- never write raw data to PTY.
    return;
  }

  // The init frame MUST arrive first. It carries the viewport dims that
  // the PTY is spawned with (or resized to, for a reconnect). Any other
  // first frame closes the WS -- the client is buggy.
  if (!state.initialized) {
    await handleInitFrame(ctx, msg);
    return;
  }

  handleJsonCommand(ctx, msg);
}

/**
 * Binary fast-path dispatch: validate the framed `[prefix][payload]` and apply
 * INPUT / RESIZE / REFRESH / flow-control. Premature or malformed frames are
 * counted (and eventually close the socket) rather than throwing.
 */
function handleBinaryFrame(
  ctx: RelayContext,
  data: Exclude<WSMessageReceive, string>,
): void {
  const { ws, state, sessionId, clientId, ptyManager, traceRecorder } = ctx;
  if (!state.binaryAttached) {
    // Stray binary frame before init/attach -- count as malformed but
    // keep the WS open until the threshold trips.
    noteMalformedFrame(ws, state, "binary before init", traceRecorder, {
      sessionId,
      clientId,
    });
    return;
  }
  const buf =
    data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBufferLike);
  const decoded = decodeBinaryFrame(buf);
  if (!decoded.ok) {
    noteMalformedFrame(ws, state, decoded.reason, traceRecorder, {
      sessionId,
      clientId,
    });
    return;
  }
  const frame = decoded.frame;
  if (frame.kind === "input") {
    const gen = coerceWireGeneration(frame.generation, ptyManager, sessionId);
    if (gen === WIRE_GENERATION_REJECT) {
      noteMalformedFrame(ws, state, "input gen out of range", traceRecorder, {
        sessionId,
        clientId,
      });
      return;
    }
    traceRecorder?.recordLazy(
      "pty-write",
      () => ({
        wire: "binary",
        dataLength: frame.data.byteLength,
        generation: gen,
      }),
      { sessionId, clientId },
    );
    if (!allowPtyWrite(ctx)) return;
    ptyManager.write(sessionId, Buffer.from(frame.data).toString("utf8"), gen);
  } else if (frame.kind === "resize") {
    traceRecorder?.record(
      "pty-resize",
      { cols: frame.cols, rows: frame.rows },
      { sessionId, clientId },
    );
    if (!applyPresenceResize(ctx, frame.cols, frame.rows)) return;
    ptyManager.resize(sessionId, frame.cols, frame.rows);
  } else if (frame.kind === "refresh") {
    traceRecorder?.record("pty-refresh", {}, { sessionId, clientId });
    ptyManager.refresh(sessionId);
  } else if (frame.kind === "flow-pause") {
    traceRecorder?.record(
      "pty-flow",
      { state: "pause" },
      { sessionId, clientId },
    );
    state.clientPaused = true;
    syncPtyFlow(state, sessionId, clientId, ptyManager);
  } else if (frame.kind === "flow-resume") {
    traceRecorder?.record(
      "pty-flow",
      { state: "resume" },
      { sessionId, clientId },
    );
    state.clientPaused = false;
    syncPtyFlow(state, sessionId, clientId, ptyManager);
  } else {
    // server-only frame received from client -> malformed
    noteMalformedFrame(
      ws,
      state,
      `client sent prefix 0x${buf[0]?.toString(16)}`,
      traceRecorder,
      { sessionId, clientId },
    );
  }
}

/**
 * First-frame handler: enforce that `init` arrives first, then attach the
 * client via the binary or legacy path depending on declared capabilities.
 */
async function handleInitFrame(
  ctx: RelayContext,
  msg: WsTerminalClientMessage,
): Promise<void> {
  const { ws, state, sessionId, clientId, traceRecorder } = ctx;
  if (msg.type !== "init") {
    ws.close(1008, "init expected");
    traceRecorder?.record(
      "ws-close",
      { code: 1008, reason: "init expected" },
      { sessionId, clientId },
    );
    return;
  }
  state.initialized = true;
  state.clientKind = msg.clientKind === "mobile" ? "mobile" : "desktop";
  traceRecorder?.record(
    "ws-init",
    {
      cols: msg.cols,
      rows: msg.rows,
      binary: !!msg.capabilities?.binary,
      chunkedReplay: !!msg.capabilities?.chunkedReplay,
      hasLastSeen: !!msg.capabilities?.lastSeen,
      clientKind: state.clientKind,
    },
    { sessionId, clientId },
  );

  const presence = ctx.terminalPresenceManager?.get(sessionId);
  const attachLayout =
    state.clientKind === "mobile" && msg.mobileMode === "desktop"
      ? presence?.layout
      : null;
  const attachMsg =
    attachLayout && "cols" in attachLayout && "rows" in attachLayout
      ? { ...msg, cols: attachLayout.cols, rows: attachLayout.rows }
      : msg;

  await attachClient(ctx, attachMsg);
  if (state.attachToken === undefined || ws.readyState !== 1) return;
  if (state.clientKind === "mobile") {
    ctx.terminalPresenceManager?.subscribeMobile(
      sessionId,
      clientId,
      { cols: msg.cols, rows: msg.rows },
      msg.mobileMode ?? "auto",
    );
  } else {
    ctx.terminalPresenceManager?.recordDesktopGeometry(sessionId, {
      cols: msg.cols,
      rows: msg.rows,
    });
  }
}

/**
 * Post-init JSON command dispatch: INPUT / RESIZE / REFRESH / flow-control for
 * clients that did not negotiate the binary frame path.
 */
function handleJsonCommand(
  ctx: RelayContext,
  msg: WsTerminalClientMessage,
): void {
  const { ws, state, sessionId, clientId, ptyManager, traceRecorder } = ctx;
  if (msg.type === "input") {
    if (process.env.PARASOR_INPUT_DEBUG === "1") {
      if (msg.data.length <= 10) {
        // eslint-disable-next-line no-console
        console.error(
          `[input] session=${sessionId.slice(0, 8)} client=${clientId.slice(0, 8)} bytes=${JSON.stringify(msg.data)}`,
        );
      }
    }
    const gen = coerceWireGeneration(msg.generation, ptyManager, sessionId);
    if (gen === WIRE_GENERATION_REJECT) {
      // Out-of-range JSON gen is a malformed-frame signal even though the
      // envelope itself parsed; flag and drop instead of writing.
      noteMalformedFrame(ws, state, "input gen out of range", traceRecorder, {
        sessionId,
        clientId,
      });
      return;
    }
    traceRecorder?.recordLazy(
      "pty-write",
      () => ({
        wire: "json",
        dataLength: msg.data.length,
        byteLength: Buffer.byteLength(msg.data, "utf8"),
        generation: gen,
      }),
      { sessionId, clientId },
    );
    if (!allowPtyWrite(ctx)) return;
    ptyManager.write(sessionId, msg.data, gen);
  } else if (msg.type === "resize") {
    traceRecorder?.record(
      "pty-resize",
      { cols: msg.cols, rows: msg.rows },
      { sessionId, clientId },
    );
    if (!applyPresenceResize(ctx, msg.cols, msg.rows)) return;
    ptyManager.resize(sessionId, msg.cols, msg.rows);
  } else if (msg.type === "refresh") {
    traceRecorder?.record("pty-refresh", {}, { sessionId, clientId });
    ptyManager.refresh(sessionId);
  } else if (msg.type === "flow-pause") {
    traceRecorder?.record(
      "pty-flow",
      { state: "pause" },
      { sessionId, clientId },
    );
    state.clientPaused = true;
    syncPtyFlow(state, sessionId, clientId, ptyManager);
  } else if (msg.type === "flow-resume") {
    traceRecorder?.record(
      "pty-flow",
      { state: "resume" },
      { sessionId, clientId },
    );
    state.clientPaused = false;
    syncPtyFlow(state, sessionId, clientId, ptyManager);
  }
}

function allowPtyWrite(ctx: RelayContext): boolean {
  const { state, sessionId, clientId, terminalPresenceManager, traceRecorder } =
    ctx;
  if (!terminalPresenceManager) return true;
  if (state.clientKind === "mobile") {
    terminalPresenceManager.markMobileActed(sessionId, clientId);
  }
  const allowed = terminalPresenceManager.canWrite(sessionId, {
    kind: state.clientKind,
    clientId,
  });
  if (!allowed) {
    traceRecorder?.record(
      "pty-write",
      { blockedByPresence: true, clientKind: state.clientKind },
      { sessionId, clientId },
    );
  }
  return allowed;
}

function applyPresenceResize(
  ctx: RelayContext,
  cols: number,
  rows: number,
): boolean {
  const { state, sessionId, clientId, terminalPresenceManager, traceRecorder } =
    ctx;
  if (!terminalPresenceManager) return true;
  if (state.clientKind === "mobile") {
    terminalPresenceManager.updateMobileViewport(sessionId, clientId, {
      cols,
      rows,
    });
    return false;
  }
  terminalPresenceManager.recordDesktopGeometry(sessionId, { cols, rows });
  const allowed = terminalPresenceManager.canResize(sessionId, {
    kind: "desktop",
    clientId,
  });
  if (!allowed) {
    traceRecorder?.record(
      "pty-resize",
      { blockedByPresence: true, clientKind: state.clientKind, cols, rows },
      { sessionId, clientId },
    );
  }
  return allowed;
}

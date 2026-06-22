import {
  decodeBinaryFrame,
  type TerminalLastSeen,
  type WsTerminalClientMessage,
  type WsTerminalServerMessage,
} from "@parasor/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureAuthenticated } from "../lib/auth-fetch.js";
import { getClientId } from "../lib/client-id.js";
import { MIN_STABLE_MS, nextReconnectDelay } from "../lib/reconnect-backoff.js";
import { resolveLastSeenOnAck } from "../lib/terminal-cursor.js";
import {
  isTerminalTraceEnabled,
  type TerminalTraceEvent,
  traceTerminalEvent,
  traceTerminalEventLazy,
} from "../lib/terminal-trace.js";
import {
  encodeClientMessage,
  encodedByteLength,
  resolveFlushGeneration,
} from "../lib/terminal-wire.js";

/*
 * If the tab has been backgrounded longer than this, force a fresh socket
 * the moment it returns to the foreground. The server-side keepalive needs
 * up to (pingInterval + pongTimeout) ≈ 30s to terminate a half-open socket
 * frozen by an iOS Safari background -- sitting on a black/stale terminal
 * for that long is the dominant "mobile foreground feels broken" symptom.
 * 10s is well above any tab-switch flicker but below the typical mobile
 * carrier idle-close window where ws is most likely zombie-OPEN.
 */
const BACKGROUND_RECONNECT_THRESHOLD_MS = 10_000;
/*
 * Init->init-ack round trip is normally tens of ms. If the server doesn't
 * ack within this window the socket is wedged (proxy buffering, server
 * stuck mid auto-resume, etc.) and the queued sends will never flush
 * because flushQueue gates on initAckedRef. Close and reconnect rather
 * than parking the terminal in a transport-open but input-dead state.
 */
const INIT_ACK_TIMEOUT_MS = 10_000;
/*
 * Upper bound on frames retained while the socket is not OPEN + init-acked.
 * Prevents unbounded memory growth when the socket parks in `ended` on a
 * 1008 close but keystrokes keep arriving (the UI-side gate also clamps
 * disableStdin, but defense-in-depth: a caller that hangs on to `send`
 * must never be able to grow the queue forever).
 * 1000 frames at typical single-keystroke input = ~10 KB retained, more
 * than enough to cover a genuine reconnect blip without masking bugs.
 */
const MAX_SEND_QUEUE = 1000;

function detectTerminalClientKind(): "desktop" | "mobile" {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia?.("(pointer: coarse)").matches
    ? "mobile"
    : "desktop";
}

export type TerminalSocketStatus =
  | "connecting"
  // Browser WebSocket is OPEN, but init-ack has not attached the PTY yet.
  | "open"
  // init-ack received; queued PTY-dependent messages can flush.
  | "attached"
  | "reconnecting"
  | "ended";

interface UseTerminalSocketOptions {
  sessionId: string | null;
  onData: (data: string) => void;
  initialLastSeen?: TerminalLastSeen | null;
  resolveInitialLastSeen?: (dims: {
    cols: number;
    rows: number;
  }) => TerminalLastSeen | null;
  onFullReplay?: (lastSeen: TerminalLastSeen | null) => void;
}

function traceClientSend(
  eventType: string,
  sessionId: string,
  msg: WsTerminalClientMessage,
  fields: Partial<Omit<TerminalTraceEvent, "seq" | "t" | "type">> = {},
): void {
  if (!isTerminalTraceEnabled()) return;
  traceTerminalEvent(eventType, {
    sessionId,
    dataLength: msg.type === "input" ? msg.data.length : undefined,
    cols: msg.type === "init" || msg.type === "resize" ? msg.cols : undefined,
    rows: msg.type === "init" || msg.type === "resize" ? msg.rows : undefined,
    ...fields,
  });
}

export function useTerminalSocket({
  sessionId,
  onData,
  initialLastSeen,
  resolveInitialLastSeen,
  onFullReplay,
}: UseTerminalSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  /*
   * Messages produced before the WebSocket finishes its handshake OR
   * before init-ack seeds the authoritative PTY generation. Flushed in
   * order only after the current socket completes its init negotiation.
   * Preserved across transient reconnects so keystrokes typed during a
   * blip replay once the fresh socket is generation-aware. We hold the
   * original messages (not pre-encoded bytes) so flush time can pick the
   * binary or JSON encoding based on the negotiated capability of the
   * *current* socket.
   *
   * PTY generation gate: each entry captures the generation that was
   * current at *enqueue* time, NOT at flush time. If the user typed
   * against a now-stale PTY (auto-resume happened during a disconnect),
   * the captured gen is older than the live one and the server-side
   * gate drops the bytes. Capturing at flush time would always emit
   * the live gen, so xterm.js's mid-flight DECRPM auto-replies (queued
   * during the disconnect window) would slip into the new shell as
   * garbage at the prompt -- exactly the bug PTY generation gate set out to fix.
   */
  const sendQueueRef = useRef<
    Array<{ msg: WsTerminalClientMessage; generation: number }>
  >([]);
  const initSentRef = useRef(false);
  const initAckedRef = useRef(false);
  /**
   * Set when the current socket's init-ack returned `capabilities.binary
   * = true`. Stays false on legacy fallback (old servers, or remote-host
   * daemon mode where binary is not yet wired). Reset on every reconnect
   * because the new socket renegotiates from scratch.
   */
  const binaryAttachedRef = useRef(false);
  /**
   * Reconnect cursor -- the (generation, chunknum) of the last OUTPUT
   * chunk this mounted terminal instance successfully consumed. It is
   * intentionally memory-only: it may survive a transient WebSocket
   * reconnect while the xterm buffer is still present, but a remount or
   * page reload creates an empty xterm buffer and must request a full
   * replay instead of claiming previously displayed output.
   */
  const lastSeenRef = useRef<TerminalLastSeen | null>(null);
  /**
   * Current PTY generation as believed by the client (PTY generation gate). Seeded by
   * init-ack's `serverState.generation`, updated by every OUTPUT frame.
   * Stamped onto outgoing INPUT so the server can drop frames that were
   * produced under a previous PTY generation (auto-resume race fix).
   * `0` until init-ack arrives; queued pre-ack input is not flushed as
   * wire gen 0 once the server has given us a non-zero generation.
   */
  const currentGenerationRef = useRef(0);
  /**
   * UTF-8 decoder shared by all OUTPUT frames on the current socket.
   * `stream: true` lets it carry over a multibyte sequence that lands
   * across two chunks (CJK / emoji split at the byte boundary). Reset on
   * every reconnect.
   */
  const decoderRef = useRef<TextDecoder | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onFullReplayRef = useRef(onFullReplay);
  onFullReplayRef.current = onFullReplay;
  /*
   * `initialLastSeen` seeds the reconnect cursor at connect time only. It is
   * read through a ref so a post-replay change to its identity (the cache
   * store after a full replay produces a fresh lastSeen object) does NOT land
   * in the connect effect's dependency array. When it did, that re-render tore
   * down and recreated the socket; the teardown nulled `lastDimsRef`, and the
   * fresh socket then opened but could never send `init` (no dims) -- leaving
   * the terminal connected-but-input-dead until a full remount.
   */
  const initialLastSeenRef = useRef(initialLastSeen);
  initialLastSeenRef.current = initialLastSeen;
  const resolveInitialLastSeenRef = useRef(resolveInitialLastSeen);
  resolveInitialLastSeenRef.current = resolveInitialLastSeen;
  const initialLastSeenResolvedRef = useRef(false);
  const resetForReplayRef = useRef(false);
  /*
   * Captured from sendInit so the effect can re-send the init frame on
   * first connect AND on automatic reconnect without needing the caller
   * to fire sendInit again. Terminal.tsx's xterm-setup effect calls
   * sendInit synchronously on mount, but the connect() closure below
   * awaits ensureAuthenticated() first -- lastDimsRef bridges that gap.
   */
  const lastDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  /*
   * Effect-bound idempotent helper that owns the init-send + ack-arm step.
   * Both the connect() open handler and the public sendInit() funnel
   * through this single ref so there is exactly one entry point that can
   * flip initSentRef. Reset to null on effect cleanup so a stale sendInit
   * call after unmount is a no-op.
   */
  const nudgeInitRef = useRef<(() => void) | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedRef = useRef(false);
  /*
   * One-shot latch so the overflow warning is emitted at most once per
   * session. Without this a runaway caller could flood the console with
   * identical warnings on every `send()` past the cap.
   */
  const overflowWarnedRef = useRef(false);

  const [status, setStatus] = useState<TerminalSocketStatus>("connecting");
  const [endedReason, setEndedReason] = useState<string | null>(null);

  const sendOnSocket = useCallback(
    (msg: WsTerminalClientMessage) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      const payload = encodeClientMessage(
        msg,
        binaryAttachedRef.current,
        currentGenerationRef.current,
      );
      ws.send(payload);
      if (sessionId) {
        traceClientSend("socket-send", sessionId, msg, {
          byteLength: encodedByteLength(payload),
          readyState: ws.readyState,
          generation: currentGenerationRef.current,
        });
      }
      return true;
    },
    [sessionId],
  );

  const flushQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!initSentRef.current) return;
    if (!initAckedRef.current) return;
    const queue = sendQueueRef.current;
    if (queue.length === 0) return;
    const flushStart = performance.now();
    traceTerminalEvent("socket-flush-start", {
      sessionId,
      queueLength: queue.length,
      readyState: ws.readyState,
      generation: currentGenerationRef.current,
    });
    sendQueueRef.current = [];
    let flushed = 0;
    for (const item of queue) {
      const generation = resolveFlushGeneration(
        item.generation,
        currentGenerationRef.current,
      );
      const payload = encodeClientMessage(
        item.msg,
        binaryAttachedRef.current,
        generation,
      );
      ws.send(payload);
      if (sessionId) {
        traceClientSend("socket-flush-queued", sessionId, item.msg, {
          byteLength: encodedByteLength(payload),
          queueLength: queue.length,
          readyState: ws.readyState,
          generation,
        });
      }
      flushed += 1;
    }
    traceTerminalEvent("socket-flush-complete", {
      sessionId,
      flushed,
      durationMs: Math.round((performance.now() - flushStart) * 10) / 10,
      readyState: ws.readyState,
    });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setStatus("connecting");
      return;
    }

    let cancelled = false;
    endedRef.current = false;
    attemptRef.current = 0;
    overflowWarnedRef.current = false;
    setStatus("connecting");
    setEndedReason(null);

    // A fresh hook attach usually means a fresh xterm buffer. When the
    // caller already restored an in-memory replay snapshot, reuse its
    // cursor so the server can validate and send delta output instead.
    // Some callers can only validate that snapshot after xterm has fitted;
    // those pass resolveInitialLastSeen and we defer seeding until buildInit.
    initialLastSeenResolvedRef.current = false;
    lastSeenRef.current = resolveInitialLastSeenRef.current
      ? null
      : (initialLastSeenRef.current ?? null);

    const clientId = getClientId();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";

    /*
     * Shared across the connect/handleServerMessage/cleanup paths so
     * init-ack arrival (or its absence) can clear or fire from any of
     * them. Re-armed inside connect() on each new socket; if a server
     * never returns init-ack within INIT_ACK_TIMEOUT_MS the deadline
     * tears the socket down and we drop into the reconnect path.
     */
    let initAckDeadline: ReturnType<typeof setTimeout> | null = null;
    const clearInitAckDeadline = () => {
      if (initAckDeadline !== null) {
        clearTimeout(initAckDeadline);
        initAckDeadline = null;
      }
    };
    // Wall-clock ms of the most recent init-ack; 0 until established. Used by
    // the close handler to distinguish a stable drop from an immediate flap.
    let establishedAt = 0;
    let pendingFullReplayLastSeen: TerminalLastSeen | null = null;

    const scheduleReconnect = (established: boolean) => {
      if (cancelled || endedRef.current) return;
      const delay = established
        ? 0
        : nextReconnectDelay(attemptRef.current + 1);
      if (established) {
        attemptRef.current = 0;
      } else {
        attemptRef.current += 1;
      }
      setStatus("reconnecting");
      traceTerminalEvent("socket-reconnect-scheduled", {
        sessionId,
        established,
        delayMs: delay,
        attempt: attemptRef.current,
        queueLength: sendQueueRef.current.length,
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (cancelled || endedRef.current) return;
        void connect();
      }, delay);
    };

    const buildInit = (): WsTerminalClientMessage | null => {
      const dims = lastDimsRef.current;
      if (!dims) return null;
      if (!initialLastSeenResolvedRef.current) {
        initialLastSeenResolvedRef.current = true;
        lastSeenRef.current =
          resolveInitialLastSeenRef.current?.(dims) ??
          initialLastSeenRef.current ??
          null;
      }
      const clientKind = detectTerminalClientKind();
      const init: WsTerminalClientMessage = {
        type: "init",
        cols: dims.cols,
        rows: dims.rows,
        ...(clientKind === "mobile" && { clientKind }),
        capabilities: {
          binary: true,
          chunkedReplay: true,
          ...(lastSeenRef.current ? { lastSeen: lastSeenRef.current } : {}),
        },
      };
      return init;
    };

    /*
     * Single funnel for init send + ack-arm. Idempotent on initSentRef,
     * safe to call from both the open handler (dims may or may not be
     * ready) and sendInit (ws may or may not be OPEN). When either gate
     * fails the call is a no-op; whichever side fills in the missing
     * precondition next will retry through this same path.
     */
    const attemptInitSend = (): void => {
      if (initSentRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const init = buildInit();
      if (!init) return;
      ws.send(JSON.stringify(init));
      initSentRef.current = true;
      traceClientSend("socket-init-sent", sessionId, init, {
        readyState: ws.readyState,
      });
      if (!initAckedRef.current) {
        clearInitAckDeadline();
        initAckDeadline = setTimeout(() => {
          initAckDeadline = null;
          if (cancelled || endedRef.current) return;
          if (wsRef.current !== ws) return;
          if (initAckedRef.current) return;
          traceTerminalEvent("socket-init-timeout", {
            sessionId,
            timeoutMs: INIT_ACK_TIMEOUT_MS,
            readyState: ws.readyState,
            queueLength: sendQueueRef.current.length,
          });
          try {
            ws.close();
          } catch {
            // already closed
          }
        }, INIT_ACK_TIMEOUT_MS);
      }
    };
    nudgeInitRef.current = attemptInitSend;

    const handleServerMessage = (event: MessageEvent): void => {
      if (typeof event.data === "string") {
        let msg: WsTerminalServerMessage | null = null;
        try {
          msg = JSON.parse(event.data) as WsTerminalServerMessage;
        } catch {
          // Older servers send raw text on the data path. That code
          // path is gone server-side in this PR, but keep the fallback
          // so a stale build doesn't blank the terminal.
          onDataRef.current(event.data);
          return;
        }
        if (msg && msg.type === "init-ack") {
          clearInitAckDeadline();
          binaryAttachedRef.current = msg.capabilities.binary;
          // PTY generation gate: seed the generation tag from server-confirmed state.
          currentGenerationRef.current = msg.serverState.generation;
          initAckedRef.current = true;
          setStatus("attached");
          establishedAt = Date.now();
          traceTerminalEvent("socket-init-ack", {
            sessionId,
            replay: msg.replay,
            generation: msg.serverState.generation,
          });
          // After init-ack we know where the server's chunk ring stands;
          // resolveLastSeenOnAck folds replay kind + ring snapshot into the
          // reconnect cursor (anchor on full/none, untouched on delta).
          lastSeenRef.current = resolveLastSeenOnAck(
            msg.replay,
            msg.serverState,
            lastSeenRef.current,
          );
          if (msg.replay === "full") {
            pendingFullReplayLastSeen = resolveLastSeenOnAck(
              msg.replay,
              msg.serverState,
              null,
            );
            resetForReplayRef.current = true;
          } else {
            pendingFullReplayLastSeen = null;
            resetForReplayRef.current = false;
          }
          flushQueue();
          return;
        }
        if (msg && msg.type === "replay") {
          // Full snapshot -- server already decoded to UTF-8.
          onFullReplayRef.current?.(
            resetForReplayRef.current ? pendingFullReplayLastSeen : null,
          );
          pendingFullReplayLastSeen = null;
          resetForReplayRef.current = false;
          onDataRef.current(msg.data);
          return;
        }
        return;
      }

      // Binary frame. Capability-aware servers send INPUT/OUTPUT/EXIT
      // here; legacy servers never enter this branch.
      const buf =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : event.data instanceof Uint8Array
            ? event.data
            : null;
      if (!buf) return;
      const decoded = decodeBinaryFrame(buf);
      if (!decoded.ok) return;
      const frame = decoded.frame;
      if (frame.kind === "output") {
        // Server protocol: no OUTPUT before init-ack. If one slips through
        // (e.g. residual frame queued by the network stack between
        // init-ack timeout firing and the close event landing), drop it.
        // Otherwise we'd spin up a TextDecoder bound to this dying socket
        // and seed lastSeen/currentGeneration from an un-acknowledged
        // state, both of which would mis-anchor the next reconnect.
        if (!initAckedRef.current) return;
        if (!decoderRef.current) decoderRef.current = new TextDecoder();
        const decoder = decoderRef.current;
        const text = decoder.decode(frame.data, { stream: true });
        if (text) {
          traceTerminalEventLazy("socket-output", () => ({
            sessionId,
            dataLength: text.length,
            byteLength: frame.data.byteLength,
            generation: frame.generation,
          }));
          onDataRef.current(text);
        }
        // PTY generation gate: track the generation server-side has bumped to (e.g.
        // after auto-resume) so subsequent INPUT carries the new tag.
        currentGenerationRef.current = frame.generation;
        const next: TerminalLastSeen = {
          generation: frame.generation,
          seq: String(frame.seq),
        };
        lastSeenRef.current = next;
        return;
      }
      // EXIT / unexpected client-direction prefixes: server-side WS
      // close handler will follow shortly. No action here -- drop.
    };

    let backgroundedAt = 0;
    const onVisibilityOrFocus = () => {
      if (cancelled || endedRef.current) return;
      if (document.visibilityState !== "visible") {
        if (backgroundedAt === 0) backgroundedAt = Date.now();
        return;
      }
      const wasBackgroundedFor =
        backgroundedAt === 0 ? 0 : Date.now() - backgroundedAt;
      backgroundedAt = 0;
      if (wasBackgroundedFor < BACKGROUND_RECONNECT_THRESHOLD_MS) return;
      /*
       * A long-backgrounded socket may be zombie-OPEN: client thinks it's
       * healthy but the server already terminated it. Forcing a close
       * funnels into the existing reconnect path which will auto-resume
       * the PTY by lastSeen cursor, so the user sees one reconnect blip
       * instead of a 30s frozen terminal.
       */
      const active = wsRef.current;
      if (!active || active.readyState !== WebSocket.OPEN) return;
      traceTerminalEvent("socket-force-reconnect", {
        sessionId,
        backgroundedMs: wasBackgroundedFor,
        readyState: active.readyState,
        queueLength: sendQueueRef.current.length,
      });
      try {
        active.close();
      } catch {
        // already closed
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // BFCache restore: the socket survives the snapshot in a frozen
      // state that's almost always zombie-OPEN. Always force a reconnect.
      backgroundedAt = Date.now() - BACKGROUND_RECONNECT_THRESHOLD_MS - 1;
      onVisibilityOrFocus();
    };
    const onOnline = () => {
      // Network came back. Whatever the visibility state, the previous
      // socket is now stale; force the close->reconnect path.
      backgroundedAt = Date.now() - BACKGROUND_RECONNECT_THRESHOLD_MS - 1;
      onVisibilityOrFocus();
    };
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);

    const connect = async () => {
      traceTerminalEvent("socket-connect-start", {
        sessionId,
        attempt: attemptRef.current,
        queueLength: sendQueueRef.current.length,
        hasLastSeen: !!lastSeenRef.current,
      });
      /*
       * See useEventSocket for why we preflight. A 401 on a WS upgrade is
       * invisible to JS, so without this the terminal pane would silently
       * refuse to attach when the cookie has expired.
       */
      const authStart = performance.now();
      traceTerminalEvent("socket-auth-start", {
        sessionId,
        attempt: attemptRef.current,
      });
      const authed = await ensureAuthenticated({
        reuseRecentSuccess: true,
        source: "terminal-socket",
        trace: isTerminalTraceEnabled()
          ? (event) => {
              traceTerminalEvent("auth-preflight", {
                sessionId,
                ...event,
              });
            }
          : undefined,
      });
      const authDurationMs =
        Math.round((performance.now() - authStart) * 10) / 10;
      if (cancelled || endedRef.current) {
        traceTerminalEvent("socket-auth-complete", {
          sessionId,
          attempt: attemptRef.current,
          durationMs: authDurationMs,
          status: "cancelled",
        });
        return;
      }
      traceTerminalEvent("socket-auth-complete", {
        sessionId,
        attempt: attemptRef.current,
        durationMs: authDurationMs,
        status: authed ? "ok" : "failed",
      });
      if (!authed) {
        traceTerminalEvent("socket-auth-failed", {
          sessionId,
          attempt: attemptRef.current,
        });
        return;
      }

      const ws = new WebSocket(
        `${protocol}//${location.host}/ws/terminal/${sessionId}?clientId=${clientId}`,
      );
      traceTerminalEvent("socket-created", {
        sessionId,
        attempt: attemptRef.current,
        queueLength: sendQueueRef.current.length,
      });
      // Required for OUTPUT frames to arrive as ArrayBuffer rather than
      // the default Blob (which would force an async .arrayBuffer() round
      // trip per frame and reorder vs. JSON envelopes).
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      initSentRef.current = false;
      initAckedRef.current = false;
      establishedAt = 0;
      binaryAttachedRef.current = false;
      decoderRef.current = null;
      resetForReplayRef.current = false;
      clearInitAckDeadline();
      // PTY generation gate: do NOT reset currentGenerationRef here. The
      // session-side generation does not roll back across a transient WS
      // drop, so the last-known value remains the right tag for input
      // that was queued during the gap. init-ack will reseed
      // authoritatively in handleServerMessage. Resetting to 0 would
      // make every reconnect-flush land as wire=0, which the server
      // coerces to the live gen and thereby defeats the auto-resume
      // gate.

      ws.addEventListener("open", () => {
        if (cancelled || wsRef.current !== ws) return;
        attemptRef.current = 0;
        setStatus("open");
        traceTerminalEvent("socket-open", {
          sessionId,
          readyState: ws.readyState,
        });
        attemptInitSend();
      });

      ws.addEventListener("message", (event) => {
        if (cancelled || wsRef.current !== ws) return;
        handleServerMessage(event);
      });

      ws.addEventListener("close", (event) => {
        if (cancelled || wsRef.current !== ws) return;
        clearInitAckDeadline();
        // Only treat the connection as eligible for instant reconnect when it
        // was established (init-acked) and stayed up at least MIN_STABLE_MS; a
        // sub-window flap takes the backoff branch instead of looping at 0 ms.
        const established =
          initAckedRef.current &&
          establishedAt > 0 &&
          Date.now() - establishedAt >= MIN_STABLE_MS;
        wsRef.current = null;
        initSentRef.current = false;
        initAckedRef.current = false;
        binaryAttachedRef.current = false;
        decoderRef.current = null;
        resetForReplayRef.current = false;
        if (isTerminalTraceEnabled()) {
          traceTerminalEvent("socket-close", {
            sessionId,
            status: String(event.code),
            reason: event.reason,
            established,
          });
        }
        // PTY generation gate: do NOT reset currentGenerationRef here.
        // The session's PTY generation persists across the WS drop;
        // any input typed during the reconnect window must keep its
        // last-known tag so the server gate can drop it if auto-resume
        // bumped the gen during the gap.
        /*
         * Server emits 1008 on "Session not found", "init expected", or
         * "Session unavailable" (see packages/server/src/ws/terminal.ts).
         * Those are terminal -- stop retrying and let the event-store's
         * sessionState='ended' flip drive SessionErrorState.
         */
        if (event.code === 1008) {
          endedRef.current = true;
          setStatus("ended");
          setEndedReason(event.reason || "Session unavailable");
          return;
        }
        scheduleReconnect(established);
      });

      ws.addEventListener("error", () => {
        // close event will fire and handle reconnect
      });
    };

    void connect();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      clearInitAckDeadline();
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      const active = wsRef.current;
      wsRef.current = null;
      active?.close();
      sendQueueRef.current = [];
      initSentRef.current = false;
      initAckedRef.current = false;
      binaryAttachedRef.current = false;
      decoderRef.current = null;
      resetForReplayRef.current = false;
      currentGenerationRef.current = 0;
      lastDimsRef.current = null;
      lastSeenRef.current = null;
      endedRef.current = false;
      attemptRef.current = 0;
      overflowWarnedRef.current = false;
      nudgeInitRef.current = null;
      setEndedReason(null);
    };
  }, [sessionId, flushQueue]);

  /*
   * Called once per Terminal mount with the initial xterm dims. Captures
   * dims into lastDimsRef and nudges the effect-owned init helper so the
   * auth-fast race (open fires before sendInit) is covered without
   * duplicating the send logic on this side. Whichever side observes
   * OPEN+dims first wins; `initSentRef` inside the helper enforces
   * single-send.
   */
  const sendInit = useCallback((cols: number, rows: number) => {
    lastDimsRef.current = { cols, rows };
    nudgeInitRef.current?.();
  }, []);

  const send = useCallback(
    (msg: WsTerminalClientMessage) => {
      if (initAckedRef.current && sendOnSocket(msg)) return;
      if (msg.type === "flow-pause" || msg.type === "flow-resume") return;
      const queue = sendQueueRef.current;
      if (queue.length >= MAX_SEND_QUEUE) {
        queue.shift();
        traceTerminalEvent("socket-queue-drop", {
          sessionId,
          queueLength: queue.length,
          generation: currentGenerationRef.current,
        });
        if (!overflowWarnedRef.current) {
          overflowWarnedRef.current = true;
          // eslint-disable-next-line no-console
          console.warn(
            `[useTerminalSocket] sendQueue exceeded ${MAX_SEND_QUEUE} frames; dropping oldest input. Socket is not OPEN -- the Terminal should be rendering its ended state.`,
          );
        }
      }
      queue.push({ msg, generation: currentGenerationRef.current });
      if (sessionId) {
        traceClientSend("socket-queue", sessionId, msg, {
          queueLength: queue.length,
          generation: currentGenerationRef.current,
        });
      }
    },
    [sendOnSocket, sessionId],
  );

  return { send, sendInit, status, endedReason };
}

import {
  encodeFlowPauseFrame,
  encodeFlowResumeFrame,
  encodeInputFrame,
  encodeRefreshFrame,
  encodeResizeFrame,
  type WsTerminalClientMessage,
} from "@parasor/shared";

/*
 * Module-scope singleton: TextEncoder is stateless, and `encodeClientMessage`
 * is on the per-keystroke hot path (binary input frame). Allocating a fresh
 * encoder on every call shows up in flamegraphs under heavy paste / agent
 * streams where input frames can arrive at >100 Hz.
 */
const INPUT_ENCODER = new TextEncoder();

/**
 * Encode a non-init client message for the wire. When the server has
 * acknowledged binary capability via init-ack, INPUT/RESIZE/REFRESH ride
 * the 1-byte-prefixed binary format. Otherwise we fall back to the
 * legacy JSON envelope so we can still talk to a server that didn't
 * negotiate binary (or to keep the test seam -- the unit tests don't
 * fire init-ack, so they observe the JSON path).
 */
export function encodeClientMessage(
  msg: WsTerminalClientMessage,
  binary: boolean,
  generation: number,
): string | Uint8Array<ArrayBuffer> {
  if (msg.type === "init") {
    // init is always JSON -- capability negotiation precedes binary.
    return JSON.stringify(msg);
  }
  if (!binary) {
    if (msg.type === "input") {
      // Tag legacy JSON input with the current generation too so
      // older-server fallback still benefits from PTY generation gate gating.
      return JSON.stringify({ ...msg, generation });
    }
    return JSON.stringify(msg);
  }
  if (msg.type === "input") {
    return encodeInputFrame(generation, INPUT_ENCODER.encode(msg.data));
  }
  if (msg.type === "resize") {
    return encodeResizeFrame(msg.cols, msg.rows);
  }
  if (msg.type === "refresh") {
    return encodeRefreshFrame();
  }
  if (msg.type === "flow-pause") {
    return encodeFlowPauseFrame();
  }
  return encodeFlowResumeFrame();
}

export function encodedByteLength(
  payload: string | Uint8Array<ArrayBuffer>,
): number {
  return typeof payload === "string" ? payload.length : payload.byteLength;
}

/**
 * PTY generation gate flush-time generation rule. A queued frame carries the generation that
 * was current at *enqueue* time. If it was enqueued before any generation was
 * known (tag 0) but the socket has since learned a live generation (>0), adopt
 * the live value so the flushed frame is gated against the right PTY epoch.
 * Otherwise keep the enqueue-time tag -- a non-zero tag is the deliberate
 * capture of the epoch the user typed against (auto-resume race fix).
 */
export function resolveFlushGeneration(
  enqueuedGeneration: number,
  currentGeneration: number,
): number {
  return enqueuedGeneration === 0 && currentGeneration > 0
    ? currentGeneration
    : enqueuedGeneration;
}

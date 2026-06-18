/**
 * Terminal WS protocol .
 *
 * Two layers coexist:
 * - **JSON envelopes** (this file's types): `init`, `init-ack`, `replay`,
 *   carrying control + capability negotiation. Always plain text.
 * - **Binary frames** (see `BinaryPrefix`): hot-path INPUT/OUTPUT/RESIZE/
 *   REFRESH/EXIT. Sent only when both client and server declare
 *   `capabilities.binary`; otherwise the legacy JSON `input`/`resize`/
 *   `refresh` envelopes apply (back-compat for old web clients).
 */

import type {
  TerminalClientKind,
  TerminalMobileSubscribeMode,
} from "./terminal-presence.js";

/**
 * Capabilities declared by either side. Both fields default to `false`
 * if absent -- `chunkedReplay` requires `binary` (validated server-side).
 */
export interface TerminalCapabilities {
  binary: boolean;
  chunkedReplay: boolean;
}

/**
 * Reconnect cursor stored in the client's `sessionStorage`.
 *
 * `seq` is a uint64 chunk sequence number serialized as a decimal string
 * across the JSON wire and storage layers -- a JSON `number` would lose
 * precision past 2^53, and BigInt has no JSON literal form. The server
 * parses it back into `bigint` before comparing against the in-memory
 * ring. Empty rings are represented by the absence of `lastSeen` (not a
 * sentinel string), so any string here means "client genuinely saw this
 * chunk".
 */
export interface TerminalLastSeen {
  generation: number;
  seq: string;
}

/**
 * Snapshot of server-side chunk ring at init-ack time.
 *
 * - `lastDeliveredSeq`: the sequence number of the most recently
 *   appended chunk (= `nextSeqToAllocate - 1`). `null` when the ring is
 *   empty (fresh session, no broadcast yet).
 * - `oldestSeq`: the seq of the oldest chunk still in the ring. `null`
 *   when the ring is empty.
 *
 * Both are decimal strings (uint64 BigInt JSON encoding, see
 * `TerminalLastSeen.seq`). The client uses these to seed `lastSeen`
 * after a `replay: "full"` snapshot so the next reconnect's delta
 * window starts from `lastDeliveredSeq + 1`.
 */
export interface TerminalServerState {
  generation: number;
  lastDeliveredSeq: string | null;
  oldestSeq: string | null;
}

export type TerminalReplayKind = "delta" | "full" | "none";

/**
 * Client -> server. First message on every WS must be `init`: it carries
 * the viewport dims that the PTY should be spawned with (for a session
 * still in `spawning` state) or resized to (for a session already
 * `running`). Any other first frame closes the WS.
 *
 * `capabilities` was added in . Old clients omit it,
 * which selects the legacy JSON path. `lastSeen` requires
 * `chunkedReplay=true`; otherwise it is ignored.
 */
export type WsTerminalClientMessage =
  | {
      type: "init";
      cols: number;
      rows: number;
      clientKind?: TerminalClientKind;
      mobileMode?: TerminalMobileSubscribeMode;
      capabilities?: TerminalCapabilities & { lastSeen?: TerminalLastSeen };
    }
  /*
   * `generation` (PTY generation gate) is the PTY generation the client believes is
   * active when the input was produced. The server discards mismatched
   * input so stale terminal-response sequences (DECRPM/DSR/DA replies
   * to the previous TUI's queries) cannot land on the post-restart
   * shell's stdin. Optional for back-compat; absence means "no gating".
   */
  | { type: "input"; data: string; generation?: number }
  | { type: "resize"; cols: number; rows: number }
  /*
   * Client-driven hint that the surface (xterm.js viewport) just became
   * visible again -- page returned from background, tab regained focus,
   * iOS keyboard collapsed and re-exposed the pane. Server reacts by
   * nudging SIGWINCH so any TUI repaints onto the (possibly stale) xterm
   * even when the viewport dimensions haven't changed.
   */
  | { type: "refresh" }
  | { type: "flow-pause" }
  | { type: "flow-resume" };

/**
 * Server -> client JSON envelopes.
 *
 * - `replay`: bulk scrollback rehydration after server restart, PTY
 *   restart, or in-memory chunk eviction. Always sent before live
 *   OUTPUT resumes.
 * - `init-ack`: capability handshake response. Old servers that don't
 *   know about capabilities skip this and emit `replay` directly with
 *   string OUTPUTs -- old clients' code path stays untouched.
 */
export type WsTerminalServerMessage =
  | { type: "replay"; data: string }
  | {
      type: "init-ack";
      capabilities: TerminalCapabilities;
      serverState: TerminalServerState;
      replay: TerminalReplayKind;
    };

/** @deprecated use WsTerminalClientMessage */
export type WsTerminalMessage = WsTerminalClientMessage;

/**
 * 1-byte prefix for the binary wire format. Big-endian for any
 * multi-byte numeric fields (`uint32 generation`, `uint64 seq`,
 * `uint32 cols/rows`, `int32 exitCode`).
 *
 * Numbering keeps client->server prefixes in 0x0X and server->client in
 * 0x1X to make Wireshark / log inspection obvious.
 */
export const BinaryPrefix = {
  // client -> server
  INPUT: 0x00,
  RESIZE: 0x01,
  REFRESH: 0x02,
  FLOW_PAUSE: 0x03,
  FLOW_RESUME: 0x04,
  // server -> client
  OUTPUT: 0x10,
  EXIT: 0x11,
} as const;

export type BinaryPrefixValue =
  (typeof BinaryPrefix)[keyof typeof BinaryPrefix];

export const OUTPUT_HEADER_BYTES = 12; // uint32 generation + uint64 seq
export const INPUT_HEADER_BYTES = 4; // uint32 generation (PTY generation gate)
export const RESIZE_PAYLOAD_BYTES = 8; // uint32 cols + uint32 rows
export const EXIT_PAYLOAD_BYTES = 4; // int32 exitCode

/** Hard limits used by R6 frame validation. */
export const RESIZE_MAX_DIM = 8192;

export type BinaryFrame =
  | { kind: "input"; generation: number; data: Uint8Array }
  | { kind: "resize"; cols: number; rows: number }
  | { kind: "refresh" }
  | { kind: "flow-pause" }
  | { kind: "flow-resume" }
  | {
      kind: "output";
      generation: number;
      seq: bigint;
      data: Uint8Array;
    }
  | { kind: "exit"; exitCode: number };

export type BinaryDecodeResult =
  | { ok: true; frame: BinaryFrame }
  | { ok: false; reason: string };

/**
 * Encode an OUTPUT frame: `0x10 | uint32 generation | uint64 seq | data`.
 * Caller-supplied `data` is treated as a raw PTY byte slice; we never
 * re-encode UTF-8. `seq` is a `bigint` because uint64 exceeds JS safe
 * integer range (2^53).
 */
export function encodeOutputFrame(
  generation: number,
  seq: bigint,
  data: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(1 + OUTPUT_HEADER_BYTES + data.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  out[0] = BinaryPrefix.OUTPUT;
  view.setUint32(1, generation >>> 0, false);
  view.setBigUint64(5, BigInt.asUintN(64, seq), false);
  out.set(data, 1 + OUTPUT_HEADER_BYTES);
  return out;
}

export function encodeExitFrame(exitCode: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(1 + EXIT_PAYLOAD_BYTES);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  out[0] = BinaryPrefix.EXIT;
  view.setInt32(1, exitCode | 0, false);
  return out;
}

/**
 * Encode an INPUT frame: `0x00 | uint32 generation | data`.
 *
 * `generation` (PTY generation gate) tags the input with the PTY generation the
 * client believes is active, so the server can drop stale frames after
 * an auto-resume rather than forwarding them to the new shell's stdin.
 */
export function encodeInputFrame(
  generation: number,
  data: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(1 + INPUT_HEADER_BYTES + data.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  out[0] = BinaryPrefix.INPUT;
  view.setUint32(1, generation >>> 0, false);
  out.set(data, 1 + INPUT_HEADER_BYTES);
  return out;
}

export function encodeResizeFrame(
  cols: number,
  rows: number,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(1 + RESIZE_PAYLOAD_BYTES);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  out[0] = BinaryPrefix.RESIZE;
  view.setUint32(1, cols >>> 0, false);
  view.setUint32(5, rows >>> 0, false);
  return out;
}

export function encodeRefreshFrame(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([BinaryPrefix.REFRESH]);
}

export function encodeFlowPauseFrame(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([BinaryPrefix.FLOW_PAUSE]);
}

export function encodeFlowResumeFrame(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([BinaryPrefix.FLOW_RESUME]);
}

/**
 * Decode any binary frame received off the wire. Never throws -- R6
 * (DoS protection) requires all length / range / unknown-prefix errors
 * to be returned as `{ ok: false, reason }` so the caller can decide
 * whether to drop, warn, or close the WS after a cumulative threshold.
 */
export function decodeBinaryFrame(buf: Uint8Array): BinaryDecodeResult {
  if (buf.length < 1) return { ok: false, reason: "empty buffer" };
  const prefix = buf[0];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  switch (prefix) {
    case BinaryPrefix.INPUT: {
      if (buf.length < 1 + INPUT_HEADER_BYTES) {
        return { ok: false, reason: "input header" };
      }
      const generation = view.getUint32(1, false);
      return {
        ok: true,
        frame: {
          kind: "input",
          generation,
          data: buf.subarray(1 + INPUT_HEADER_BYTES),
        },
      };
    }
    case BinaryPrefix.RESIZE: {
      if (buf.length !== 1 + RESIZE_PAYLOAD_BYTES) {
        return { ok: false, reason: "resize length" };
      }
      const cols = view.getUint32(1, false);
      const rows = view.getUint32(5, false);
      if (
        cols === 0 ||
        rows === 0 ||
        cols > RESIZE_MAX_DIM ||
        rows > RESIZE_MAX_DIM
      ) {
        return { ok: false, reason: "resize range" };
      }
      return { ok: true, frame: { kind: "resize", cols, rows } };
    }
    case BinaryPrefix.REFRESH:
      if (buf.length !== 1) return { ok: false, reason: "refresh length" };
      return { ok: true, frame: { kind: "refresh" } };
    case BinaryPrefix.FLOW_PAUSE:
      if (buf.length !== 1) return { ok: false, reason: "flow-pause length" };
      return { ok: true, frame: { kind: "flow-pause" } };
    case BinaryPrefix.FLOW_RESUME:
      if (buf.length !== 1) return { ok: false, reason: "flow-resume length" };
      return { ok: true, frame: { kind: "flow-resume" } };
    case BinaryPrefix.OUTPUT: {
      if (buf.length < 1 + OUTPUT_HEADER_BYTES) {
        return { ok: false, reason: "output header" };
      }
      const generation = view.getUint32(1, false);
      const seq = view.getBigUint64(5, false);
      return {
        ok: true,
        frame: {
          kind: "output",
          generation,
          seq,
          data: buf.subarray(1 + OUTPUT_HEADER_BYTES),
        },
      };
    }
    case BinaryPrefix.EXIT: {
      if (buf.length !== 1 + EXIT_PAYLOAD_BYTES) {
        return { ok: false, reason: "exit length" };
      }
      return {
        ok: true,
        frame: { kind: "exit", exitCode: view.getInt32(1, false) },
      };
    }
    default:
      return { ok: false, reason: `unknown prefix 0x${prefix.toString(16)}` };
  }
}

/** Cumulative malformed-frame threshold before closing the WS (R6). */
export const MALFORMED_FRAME_CLOSE_THRESHOLD = 32;

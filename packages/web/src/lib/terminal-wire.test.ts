import {
  decodeBinaryFrame,
  type WsTerminalClientMessage,
} from "@parasor/shared";
import { describe, expect, it } from "vitest";
import {
  encodeClientMessage,
  encodedByteLength,
  resolveFlushGeneration,
} from "./terminal-wire.js";

function decode(payload: string | Uint8Array<ArrayBuffer>) {
  if (typeof payload === "string") throw new Error("expected binary payload");
  const result = decodeBinaryFrame(payload);
  if (!result.ok) throw new Error("frame failed to decode");
  return result.frame;
}

describe("encodeClientMessage -- init", () => {
  const init: WsTerminalClientMessage = {
    type: "init",
    cols: 80,
    rows: 24,
    capabilities: { binary: true, chunkedReplay: true },
  };

  it("is always JSON regardless of binary capability", () => {
    expect(encodeClientMessage(init, false, 0)).toBe(JSON.stringify(init));
    expect(encodeClientMessage(init, true, 7)).toBe(JSON.stringify(init));
  });
});

describe("encodeClientMessage -- legacy JSON path (binary=false)", () => {
  it("tags input with the current generation", () => {
    const msg: WsTerminalClientMessage = { type: "input", data: "ls\r" };
    const payload = encodeClientMessage(msg, false, 5);
    expect(typeof payload).toBe("string");
    expect(JSON.parse(payload as string)).toEqual({
      type: "input",
      data: "ls\r",
      generation: 5,
    });
  });

  it("leaves resize/refresh/flow as untagged JSON", () => {
    const resize: WsTerminalClientMessage = {
      type: "resize",
      cols: 100,
      rows: 40,
    };
    expect(JSON.parse(encodeClientMessage(resize, false, 9) as string)).toEqual(
      {
        type: "resize",
        cols: 100,
        rows: 40,
      },
    );
    const refresh: WsTerminalClientMessage = { type: "refresh" };
    expect(
      JSON.parse(encodeClientMessage(refresh, false, 9) as string),
    ).toEqual({
      type: "refresh",
    });
    const flowPause: WsTerminalClientMessage = { type: "flow-pause" };
    expect(
      JSON.parse(encodeClientMessage(flowPause, false, 9) as string),
    ).toEqual({
      type: "flow-pause",
    });
  });
});

describe("encodeClientMessage -- binary path (binary=true)", () => {
  it("encodes input as an INPUT frame carrying the generation and bytes", () => {
    const msg: WsTerminalClientMessage = { type: "input", data: "あa" };
    const frame = decode(encodeClientMessage(msg, true, 12));
    expect(frame.kind).toBe("input");
    if (frame.kind !== "input") throw new Error("unreachable");
    expect(frame.generation).toBe(12);
    expect(new TextDecoder().decode(frame.data)).toBe("あa");
  });

  it("encodes resize as a RESIZE frame", () => {
    const msg: WsTerminalClientMessage = {
      type: "resize",
      cols: 120,
      rows: 30,
    };
    const frame = decode(encodeClientMessage(msg, true, 0));
    expect(frame).toEqual({ kind: "resize", cols: 120, rows: 30 });
  });

  it("encodes refresh / flow-pause / flow-resume as their frames", () => {
    expect(decode(encodeClientMessage({ type: "refresh" }, true, 0))).toEqual({
      kind: "refresh",
    });
    expect(
      decode(encodeClientMessage({ type: "flow-pause" }, true, 0)),
    ).toEqual({
      kind: "flow-pause",
    });
    expect(
      decode(encodeClientMessage({ type: "flow-resume" }, true, 0)),
    ).toEqual({
      kind: "flow-resume",
    });
  });
});

describe("encodedByteLength", () => {
  it("uses string length for JSON payloads", () => {
    expect(encodedByteLength("abcd")).toBe(4);
  });

  it("uses byteLength for binary payloads", () => {
    const bytes = new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>;
    expect(encodedByteLength(bytes)).toBe(3);
  });
});

describe("resolveFlushGeneration (PTY generation gate flush-time rule)", () => {
  it("adopts the live generation when the frame was enqueued tag-less", () => {
    expect(resolveFlushGeneration(0, 7)).toBe(7);
  });

  it("keeps a non-zero enqueue-time tag even when a newer generation is live", () => {
    expect(resolveFlushGeneration(3, 9)).toBe(3);
  });

  it("stays 0 when neither enqueue nor current generation is known", () => {
    expect(resolveFlushGeneration(0, 0)).toBe(0);
  });
});

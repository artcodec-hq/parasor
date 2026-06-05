import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { encodeFrame, FrameType } from "../pty/host-protocol/frames.js";
import { encodeJsonPayload } from "../pty/host-protocol/messages.js";
import {
  PROBE_VERSION,
  probeDaemonProtocolVersion,
} from "./probe-daemon-version.js";

/*
 * The probe deliberately sends an incompatible HELLO so the daemon NACKs
 * before evicting the live server. These tests stand in a fake socket
 * that captures the outgoing HELLO bytes and replays a chosen NACK shape,
 * letting us assert each branch of the result discriminator.
 */

interface FakeSocketHandle {
  emit: EventEmitter;
  write: (chunk: Buffer) => boolean;
  written: Buffer[];
  destroyed: boolean;
}

function createFakeSocket(): { socket: Socket; handle: FakeSocketHandle } {
  const emit = new EventEmitter();
  const written: Buffer[] = [];
  const handle: FakeSocketHandle = {
    emit,
    write: (chunk: Buffer) => {
      written.push(Buffer.from(chunk));
      return true;
    },
    written,
    destroyed: false,
  };
  const socket = Object.assign(new EventEmitter(), {
    write: handle.write,
    destroy: () => {
      handle.destroyed = true;
    },
  }) as unknown as Socket;
  // Forward emit calls -- both objects are EventEmitter, but we want
  // the test to drive the same emitter the production code subscribes to.
  handle.emit = socket as unknown as EventEmitter;
  return { socket, handle };
}

function nackFrame(code: string, message: string): Buffer {
  return encodeFrame({
    type: FrameType.NACK,
    connectionId: 0,
    generation: 0n,
    requestId: 0,
    payload: encodeJsonPayload({ code, message }),
  });
}

describe("probeDaemonProtocolVersion", () => {
  it("classifies an incompatible daemon as 'mismatch' and reports both versions", async () => {
    const { socket, handle } = createFakeSocket();
    const promise = probeDaemonProtocolVersion({
      socketPath: "/ignored",
      connectFn: () => socket,
      serverVersion: "1.2.0",
    });
    handle.emit.emit("connect");
    handle.emit.emit(
      "data",
      nackFrame(
        "version-mismatch",
        `server ${PROBE_VERSION} not compatible with daemon 1.1.0`,
      ),
    );
    const result = await promise;
    expect(result).toEqual({
      status: "mismatch",
      daemonVersion: "1.1.0",
      serverVersion: "1.2.0",
    });
    expect(handle.destroyed).toBe(true);
  });

  it("classifies a compatible daemon as 'compatible' even though the probe HELLO was incompatible", async () => {
    const { socket, handle } = createFakeSocket();
    const promise = probeDaemonProtocolVersion({
      socketPath: "/ignored",
      connectFn: () => socket,
      serverVersion: "1.2.0",
    });
    handle.emit.emit("connect");
    handle.emit.emit(
      "data",
      nackFrame(
        "version-mismatch",
        `server ${PROBE_VERSION} not compatible with daemon 1.2.0`,
      ),
    );
    const result = await promise;
    expect(result).toEqual({
      status: "compatible",
      daemonVersion: "1.2.0",
      serverVersion: "1.2.0",
    });
  });

  it("treats higher daemon minor (still compatible per ) as compatible", async () => {
    const { socket, handle } = createFakeSocket();
    const promise = probeDaemonProtocolVersion({
      socketPath: "/ignored",
      connectFn: () => socket,
      serverVersion: "1.2.0",
    });
    handle.emit.emit("connect");
    handle.emit.emit(
      "data",
      nackFrame(
        "version-mismatch",
        `server ${PROBE_VERSION} not compatible with daemon 1.5.3`,
      ),
    );
    const result = await promise;
    expect(result.status).toBe("compatible");
  });

  it("encodes a HELLO with the non-semver PROBE_VERSION so the daemon cannot accept it", async () => {
    const { socket, handle } = createFakeSocket();
    const promise = probeDaemonProtocolVersion({
      socketPath: "/ignored",
      connectFn: () => socket,
      serverVersion: "1.2.0",
    });
    handle.emit.emit("connect");
    handle.emit.emit(
      "data",
      nackFrame(
        "version-mismatch",
        `server ${PROBE_VERSION} not compatible with daemon 1.2.0`,
      ),
    );
    await promise;
    expect(handle.written).toHaveLength(1);
    const sent = handle.written[0];
    if (!sent) throw new Error("expected one frame");
    // After the 4-byte length + 17-byte header, the payload is a JSON
    // HelloPayload -- assert PROBE_VERSION is what we sent.
    const payloadStart = 4 + 1 + 4 + 8 + 4;
    const json = JSON.parse(sent.subarray(payloadStart).toString("utf8"));
    expect(json.protocolVersion).toBe(PROBE_VERSION);
    expect(typeof json.serverPid).toBe("number");
    expect(sent.readUInt8(4)).toBe(FrameType.HELLO);
  });

  it("returns 'no-daemon' when the socket reports ECONNREFUSED", async () => {
    const { socket, handle } = createFakeSocket();
    const promise = probeDaemonProtocolVersion({
      socketPath: "/ignored",
      connectFn: () => socket,
    });
    const err = Object.assign(new Error("ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    handle.emit.emit("error", err);
    const result = await promise;
    expect(result).toEqual({ status: "no-daemon" });
  });

  it("returns 'no-daemon' when the socket path does not exist (ENOENT)", async () => {
    const { socket, handle } = createFakeSocket();
    const promise = probeDaemonProtocolVersion({
      socketPath: "/ignored",
      connectFn: () => socket,
    });
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    handle.emit.emit("error", err);
    const result = await promise;
    expect(result).toEqual({ status: "no-daemon" });
  });

  it("returns 'unknown' when the daemon replies with an unexpected NACK code (defensive against future protocol changes)", async () => {
    const { socket, handle } = createFakeSocket();
    const promise = probeDaemonProtocolVersion({
      socketPath: "/ignored",
      connectFn: () => socket,
    });
    handle.emit.emit("connect");
    handle.emit.emit("data", nackFrame("internal-error", "boom"));
    const result = await promise;
    expect(result.status).toBe("unknown");
  });

  it("returns 'unknown' on probe timeout (daemon never replied)", async () => {
    const { socket, handle } = createFakeSocket();
    const promise = probeDaemonProtocolVersion({
      socketPath: "/ignored",
      connectFn: () => socket,
      timeoutMs: 5,
    });
    handle.emit.emit("connect");
    // No data, no error -- let the timer fire.
    const result = await promise;
    expect(result.status).toBe("unknown");
    if (result.status !== "unknown") return;
    expect(result.reason).toMatch(/timed out/);
  });

  it("returns 'unknown' if the NACK message shape is unparseable (forward-compat guard)", async () => {
    const { socket, handle } = createFakeSocket();
    const promise = probeDaemonProtocolVersion({
      socketPath: "/ignored",
      connectFn: () => socket,
    });
    handle.emit.emit("connect");
    handle.emit.emit(
      "data",
      nackFrame("version-mismatch", "totally different message shape"),
    );
    const result = await promise;
    expect(result.status).toBe("unknown");
  });
});

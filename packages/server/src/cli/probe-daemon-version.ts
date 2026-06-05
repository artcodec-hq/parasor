/*
 * Restart confirmation -- pre-flight version probe for the running PTY host daemon.
 *
 * Background. `parasor service restart` (and `parasor restart` on a
 * service-managed install) kicks the server unit. The new server boots,
 * connects to the long-lived daemon, and `pty/host.ts` SIGKILLs the
 * daemon -- terminating every active PTY -- when their PROTOCOL_VERSIONs
 * disagree (host.ts:438-494, intentional per daemon protocol mismatch recovery). The user has no
 * pre-event signal: their CLI returns immediately after `kickstart`.
 *
 * To prompt before the kill, we must learn the running daemon's version
 * from the *CLI* side, before kickstart. The daemon does not persist its
 * version on disk, so the only source of truth is the socket itself --
 * but a normal HELLO would evict the live server (daemon.ts:280-282
 * supersedes the previous current). We instead send an INTENTIONALLY
 * incompatible HELLO ("probe", non-semver). The compat check at
 * daemon.ts:269 rejects it before `currentServer` is touched, the daemon
 * NACKs with `server probe not compatible with daemon X.Y.Z`, and we
 * parse `X.Y.Z` from the message. Live server stays attached.
 */

import type { Buffer } from "node:buffer";
import type { Socket } from "node:net";
import { connect } from "node:net";
import {
  encodeFrame,
  type Frame,
  FrameParser,
  FrameType,
} from "../pty/host-protocol/frames.js";
import {
  decodeJsonPayload,
  encodeJsonPayload,
  type HelloPayload,
  isCompatibleVersion,
  type NackPayload,
  PROTOCOL_VERSION,
  parseVersionMismatch,
} from "../pty/host-protocol/messages.js";

/**
 * The intentionally-incompatible protocol version we send. Non-semver so
 * `parseSemver()` returns null and `isCompatibleVersion()` always rejects,
 * making the eviction-side branch unreachable on every plausible daemon.
 */
export const PROBE_VERSION = "probe";

const PROBE_TIMEOUT_MS = 2000;

export type ProbeResult =
  /** No daemon reachable on the socket -- restart is a no-op for sessions. */
  | { status: "no-daemon" }
  /** Daemon is alive and its version is compatible with the new server. */
  | { status: "compatible"; daemonVersion: string; serverVersion: string }
  /** Daemon is alive but its version is incompatible -- auto-restart will fire. */
  | { status: "mismatch"; daemonVersion: string; serverVersion: string }
  /** Connected but couldn't decide (timeout, malformed reply, IO error). */
  | { status: "unknown"; reason: string };

export interface ProbeOptions {
  socketPath: string;
  /** Override for tests. */
  connectFn?: (socketPath: string) => Socket;
  /** Override for tests. */
  timeoutMs?: number;
  /** Override for tests -- defaults to the build-time PROTOCOL_VERSION. */
  serverVersion?: string;
}

/**
 * Open the daemon socket, send a deliberately-incompatible HELLO, and
 * read the resulting NACK to learn the daemon's PROTOCOL_VERSION. Closes
 * the socket before returning. Never evicts a live server -- see module
 * header for the reason.
 */
export async function probeDaemonProtocolVersion(
  opts: ProbeOptions,
): Promise<ProbeResult> {
  const serverVersion = opts.serverVersion ?? PROTOCOL_VERSION;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const connectFn = opts.connectFn ?? ((p) => connect(p));

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    const settle = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* socket may already be in error state */
      }
      resolve(result);
    };

    let socket: Socket;
    try {
      socket = connectFn(opts.socketPath);
    } catch {
      resolve({
        status: "no-daemon",
      });
      return;
    }

    const timer = setTimeout(() => {
      settle({
        status: "unknown",
        reason: `probe timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    timer.unref();

    const parser = new FrameParser();

    socket.on("connect", () => {
      const payload: HelloPayload = {
        protocolVersion: PROBE_VERSION,
        serverPid: process.pid,
      };
      socket.write(
        encodeFrame({
          type: FrameType.HELLO,
          connectionId: 0,
          generation: 0n,
          requestId: 0,
          payload: encodeJsonPayload(payload),
        }),
      );
    });

    socket.on("data", (chunk: Buffer) => {
      let frames: Frame[];
      try {
        frames = parser.push(chunk);
      } catch (err) {
        clearTimeout(timer);
        settle({
          status: "unknown",
          reason: `frame decode error: ${(err as Error).message}`,
        });
        return;
      }
      for (const frame of frames) {
        if (frame.type !== FrameType.NACK) {
          // HELLO_ACK should never arrive -- we sent an incompatible
          // version. If it does, the daemon's compat rule is broken;
          // err on the side of caution and treat as unknown.
          clearTimeout(timer);
          settle({
            status: "unknown",
            reason: `unexpected frame type 0x${frame.type.toString(16)}`,
          });
          return;
        }
        let nack: NackPayload;
        try {
          nack = decodeJsonPayload<NackPayload>(frame.payload);
        } catch (err) {
          clearTimeout(timer);
          settle({
            status: "unknown",
            reason: `nack decode error: ${(err as Error).message}`,
          });
          return;
        }
        if (nack.code !== "version-mismatch") {
          clearTimeout(timer);
          settle({
            status: "unknown",
            reason: `unexpected nack code: ${nack.code}`,
          });
          return;
        }
        const parsed = parseVersionMismatch(nack.message);
        if (!parsed) {
          clearTimeout(timer);
          settle({
            status: "unknown",
            reason: `nack message did not match expected shape: ${nack.message}`,
          });
          return;
        }
        clearTimeout(timer);
        const daemonVersion = parsed.daemon;
        const isMismatch = !isCompatibleVersion(serverVersion, daemonVersion);
        settle({
          status: isMismatch ? "mismatch" : "compatible",
          daemonVersion,
          serverVersion,
        });
        return;
      }
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
        settle({ status: "no-daemon" });
        return;
      }
      settle({ status: "unknown", reason: err.message });
    });

    socket.on("close", () => {
      // Reaching here without a NACK frame means the daemon dropped the
      // socket without an interpretable reply (e.g. crashed mid-handshake).
      clearTimeout(timer);
      settle({ status: "unknown", reason: "socket closed before NACK" });
    });
  });
}

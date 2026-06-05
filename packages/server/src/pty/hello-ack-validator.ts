import type { Buffer } from "node:buffer";
import {
  decodeJsonPayload,
  type HelloAckPayload,
  isCompatibleVersion,
} from "./host-protocol/messages.js";

/*
 * Pure validator for the daemon's HELLO_ACK frame payload. Split out of
 * {@link RemotePtyHost} so the decode-then-version-compat pipeline can be
 * exercised under unit tests without spinning a socket. The host side
 * routes the result into {@link ConnectionLifecycle.drop} (on failure) or
 * {@link ConnectionLifecycle.applyHelloAck} (on success).
 *
 * Tagged-union return matches the two daemon-issued NACK codes that the
 * caller needs to attach to the typed `RemotePtyHostError` it constructs:
 *   - "frame-invalid"     -- payload not decodable as `HelloAckPayload`.
 *   - "version-mismatch"  -- decoded payload's `protocolVersion` is not
 *                           compatible with our `ourVersion` per the protocol
 *                            compatibility predicate.
 */
export type HelloAckValidation =
  | { ok: true; connectionId: number; generation: bigint }
  | {
      ok: false;
      code: "frame-invalid" | "version-mismatch";
      message: string;
    };

/** Decode + version-compat check on a HELLO_ACK frame payload. `ourVersion`
 *  is the server's own `PROTOCOL_VERSION` constant; injecting it lets the
 *  test suite pin both sides of the compatibility comparison. */
export function validateHelloAck(
  payload: Buffer,
  ourVersion: string,
): HelloAckValidation {
  let body: HelloAckPayload;
  try {
    body = decodeJsonPayload<HelloAckPayload>(payload);
  } catch {
    return {
      ok: false,
      code: "frame-invalid",
      message: "HELLO_ACK undecodable",
    };
  }
  if (!isCompatibleVersion(ourVersion, body.protocolVersion)) {
    return {
      ok: false,
      code: "version-mismatch",
      message: `daemon protocol ${body.protocolVersion} not compatible with server ${ourVersion}`,
    };
  }
  return {
    ok: true,
    connectionId: body.connectionId,
    generation: BigInt(body.generation),
  };
}

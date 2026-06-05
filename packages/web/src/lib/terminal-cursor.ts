import type {
  TerminalLastSeen,
  TerminalReplayKind,
  TerminalServerState,
} from "@parasor/shared";

/**
 * Resolve the reconnect cursor (`lastSeen`) the client should hold right
 * after an init-ack, given the negotiated replay kind and the server's
 * chunk-ring snapshot.
 *
 * - `full` / `none`: anchor to the server's last-delivered seq -- the next
 *   OUTPUT will be `lastDeliveredSeq + 1`. When the ring is empty
 *   (`lastDeliveredSeq === null`) there is nothing to anchor yet; return
 *   `null` so the first OUTPUT seeds the cursor.
 * - `delta`: leave the cursor where it was -- the client handed the server
 *   `lastSeen` and the server is about to fan out the chunks since; each
 *   incoming OUTPUT advances it.
 */
export function resolveLastSeenOnAck(
  replay: TerminalReplayKind,
  serverState: TerminalServerState,
  prev: TerminalLastSeen | null,
): TerminalLastSeen | null {
  if (replay === "delta") return prev;
  const seq = serverState.lastDeliveredSeq;
  if (seq === null) return null;
  return { generation: serverState.generation, seq };
}

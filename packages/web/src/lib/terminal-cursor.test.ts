import type { TerminalLastSeen, TerminalServerState } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { resolveLastSeenOnAck } from "./terminal-cursor.js";

const serverState = (
  generation: number,
  lastDeliveredSeq: string | null,
): TerminalServerState => ({
  generation,
  lastDeliveredSeq,
  oldestSeq: null,
});

describe("resolveLastSeenOnAck", () => {
  it("anchors to lastDeliveredSeq on full replay", () => {
    expect(resolveLastSeenOnAck("full", serverState(7, "42"), null)).toEqual({
      generation: 7,
      seq: "42",
    });
  });

  it("anchors to lastDeliveredSeq on none replay, overriding the prior cursor", () => {
    expect(
      resolveLastSeenOnAck("none", serverState(3, "9"), {
        generation: 1,
        seq: "1",
      }),
    ).toEqual({ generation: 3, seq: "9" });
  });

  it("clears the cursor when the ring is empty on full replay", () => {
    expect(
      resolveLastSeenOnAck("full", serverState(7, null), {
        generation: 1,
        seq: "5",
      }),
    ).toBeNull();
  });

  it("clears the cursor when the ring is empty on none replay", () => {
    expect(resolveLastSeenOnAck("none", serverState(2, null), null)).toBeNull();
  });

  it("leaves the cursor untouched on delta replay", () => {
    const prev: TerminalLastSeen = { generation: 4, seq: "100" };
    expect(resolveLastSeenOnAck("delta", serverState(9, "999"), prev)).toBe(
      prev,
    );
  });

  it("returns null on delta replay when there was no prior cursor", () => {
    expect(
      resolveLastSeenOnAck("delta", serverState(9, "999"), null),
    ).toBeNull();
  });
});

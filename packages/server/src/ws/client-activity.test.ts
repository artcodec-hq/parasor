import type { WSContext } from "hono/ws";
import { describe, expect, it } from "vitest";
import { ClientActivityTracker } from "./client-activity.js";

function ws(id: string): WSContext {
  return { id } as unknown as WSContext;
}

describe("ClientActivityTracker", () => {
  it("returns previous id on set and remove", () => {
    const tracker = new ClientActivityTracker();
    const a = ws("a");
    expect(tracker.setActiveProject(a, "p1")).toBeNull();
    expect(tracker.setActiveProject(a, "p2")).toBe("p1");
    expect(tracker.setActiveProject(a, "p2")).toBe("p2");
    expect(tracker.removeClient(a)).toBe("p2");
    expect(tracker.removeClient(a)).toBeNull();
  });
});

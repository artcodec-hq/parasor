import type { Session, SessionEndReason } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { SessionMirror } from "./session-mirror.js";

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    projectId: "p1",
    pid: null,
    state: "spawning",
    generation: 1,
    title: id,
    command: { type: "shell" },
    cwd: "/",
    shell: "/bin/zsh",
    createdAt: 0,
    ...overrides,
  };
}

describe("SessionMirror generation latch", () => {
  it("seeds the latch from a snapshot and only moves forward", () => {
    const mirror = new SessionMirror();
    mirror.seedGeneration(makeSession("s", { generation: 3 }));
    expect(mirror.generationOf("s")).toBe(3);

    // A stale snapshot must not rewind the latch.
    mirror.seedGeneration(makeSession("s", { generation: 1 }));
    expect(mirror.generationOf("s")).toBe(3);

    // A newer snapshot advances it.
    mirror.seedGeneration(makeSession("s", { generation: 5 }));
    expect(mirror.generationOf("s")).toBe(5);
  });

  it("defaults to generation 0 for an unseen session", () => {
    const mirror = new SessionMirror();
    expect(mirror.generationOf("missing")).toBe(0);
  });

  it("recordDataGeneration advances the latch and reports fresh chunks", () => {
    const mirror = new SessionMirror();
    expect(mirror.recordDataGeneration("s", 1)).toEqual({ stale: false });
    expect(mirror.generationOf("s")).toBe(1);

    // A newer generation is fresh and advances the latch.
    expect(mirror.recordDataGeneration("s", 2)).toEqual({ stale: false });
    expect(mirror.generationOf("s")).toBe(2);
  });

  it("recordDataGeneration treats the same generation as fresh, not stale", () => {
    const mirror = new SessionMirror();
    mirror.recordDataGeneration("s", 4);
    expect(mirror.recordDataGeneration("s", 4)).toEqual({ stale: false });
    expect(mirror.generationOf("s")).toBe(4);
  });

  it("recordDataGeneration flags a strictly-older chunk stale without rewinding", () => {
    const mirror = new SessionMirror();
    mirror.recordDataGeneration("s", 5);
    expect(mirror.recordDataGeneration("s", 3)).toEqual({ stale: true });
    // Latch stays at the highest observed generation.
    expect(mirror.generationOf("s")).toBe(5);
  });
});

describe("SessionMirror reconciliation", () => {
  it("upsert stores a session and seeds its generation", () => {
    const mirror = new SessionMirror();
    mirror.upsert(makeSession("s", { generation: 2, title: "hello" }));
    expect(mirror.get("s")?.title).toBe("hello");
    expect(mirror.generationOf("s")).toBe(2);
  });

  it("replace swaps the stored session without touching the latch", () => {
    const mirror = new SessionMirror();
    mirror.recordDataGeneration("s", 7); // latch ahead of the snapshot
    mirror.upsert(makeSession("s", { generation: 2 }));
    expect(mirror.generationOf("s")).toBe(7);

    // A local optimistic patch carrying a lower generation must not seed.
    mirror.replace(makeSession("s", { generation: 2, title: "renamed" }));
    expect(mirror.get("s")?.title).toBe("renamed");
    expect(mirror.generationOf("s")).toBe(7);
  });

  it("applyList replaces the whole mirror and seeds each generation", () => {
    const mirror = new SessionMirror();
    mirror.upsert(makeSession("old", { generation: 1 }));

    mirror.applyList([
      makeSession("a", { generation: 2 }),
      makeSession("b", { generation: 4 }),
    ]);

    expect(mirror.get("old")).toBeUndefined();
    expect(
      mirror
        .list()
        .map((s) => s.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(mirror.generationOf("a")).toBe(2);
    expect(mirror.generationOf("b")).toBe(4);
  });

  it("applyExit stamps an existing session ended with its end reason", () => {
    const mirror = new SessionMirror();
    mirror.upsert(makeSession("s", { state: "running" }));
    const reason: SessionEndReason = { type: "exit", code: 0 };

    mirror.applyExit("s", reason);

    const ended = mirror.get("s");
    expect(ended?.state).toBe("ended");
    expect(ended?.endReason).toEqual(reason);
  });

  it("applyExit is a no-op for an unknown session id", () => {
    const mirror = new SessionMirror();
    mirror.applyExit("ghost", { type: "exit", code: 1 });
    expect(mirror.get("ghost")).toBeUndefined();
  });

  it("remove drops the session and its generation latch", () => {
    const mirror = new SessionMirror();
    mirror.upsert(makeSession("s", { generation: 3 }));
    mirror.remove("s");
    expect(mirror.get("s")).toBeUndefined();
    expect(mirror.generationOf("s")).toBe(0);
  });

  it("clear empties both the mirror and the generation latch", () => {
    const mirror = new SessionMirror();
    mirror.upsert(makeSession("a", { generation: 1 }));
    mirror.upsert(makeSession("b", { generation: 2 }));

    mirror.clear();

    expect(mirror.list()).toEqual([]);
    expect(mirror.generationOf("a")).toBe(0);
    expect(mirror.generationOf("b")).toBe(0);
  });
});

describe("SessionMirror read accessors", () => {
  it("get returns undefined for a missing session", () => {
    const mirror = new SessionMirror();
    expect(mirror.get("nope")).toBeUndefined();
  });

  it("list returns all mirrored sessions", () => {
    const mirror = new SessionMirror();
    mirror.upsert(makeSession("a"));
    mirror.upsert(makeSession("b"));
    expect(
      mirror
        .list()
        .map((s) => s.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("listByProject filters by projectId", () => {
    const mirror = new SessionMirror();
    mirror.upsert(makeSession("a", { projectId: "p1" }));
    mirror.upsert(makeSession("b", { projectId: "p2" }));
    mirror.upsert(makeSession("c", { projectId: "p1" }));

    expect(
      mirror
        .listByProject("p1")
        .map((s) => s.id)
        .sort(),
    ).toEqual(["a", "c"]);
    expect(mirror.listByProject("p2").map((s) => s.id)).toEqual(["b"]);
    expect(mirror.listByProject("none")).toEqual([]);
  });
});

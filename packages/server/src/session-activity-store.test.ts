import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionActivityRecord } from "@parasor/shared";
import { afterEach, describe, expect, it } from "vitest";
import { SessionActivityStore } from "./session-activity-store.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "parasor-session-activity-"));
  roots.push(root);
  return root;
}

function record(
  sessionId: string,
  overrides: Partial<SessionActivityRecord> = {},
  timestamp = 1,
): SessionActivityRecord {
  return {
    id: `activity-${sessionId}`,
    sessionId,
    kind: "session-created",
    source: "daemon",
    summary: "Session created",
    timestamp,
    ...overrides,
  };
}

describe("SessionActivityStore", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists activity history across store instances", () => {
    const root = tempRoot();
    const store = new SessionActivityStore({
      dir: root,
      now: () => 1_000,
    });
    const appended = store.append(
      record("s1", { kind: "session-created" }, 1_000),
    );
    expect(appended).toBe(true);
    expect(store.getRecent()).toHaveLength(1);
    expect(readFileSync(join(root, "session-activity.json"), "utf8")).toContain(
      "activity-s1",
    );

    const reloaded = new SessionActivityStore({ dir: root, now: () => 2_000 });
    const history = reloaded.getRecent();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: "activity-s1", sessionId: "s1" });
  });

  it("ignores malformed persisted records and keeps valid entries", () => {
    const root = tempRoot();
    const file = {
      version: 1,
      sessions: {
        s1: [
          {
            id: "good",
            sessionId: "s1",
            timestamp: 10,
            kind: "session-created",
            source: "daemon",
            summary: "good",
          },
          {
            id: "bad",
            sessionId: "s1",
            timestamp: 20,
            kind: "session-closed",
            source: "daemon",
            summary: 12,
          },
        ],
        bad: [
          {
            id: "bad-session-id",
            sessionId: "other",
            timestamp: 30,
            kind: "session-ended",
            source: "daemon",
            summary: "mismatch",
          },
        ],
      },
    };
    writeFileSync(
      join(root, "session-activity.json"),
      JSON.stringify(file, null, 2),
      "utf8",
    );

    const reloaded = new SessionActivityStore({ dir: root });
    const history = reloaded.getRecent();

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: "good",
      sessionId: "s1",
      kind: "session-created",
    });
  });

  it("drops duplicate noise inside the noise window", () => {
    const root = tempRoot();
    const store = new SessionActivityStore({
      dir: root,
      noiseWindowMs: 2_000,
      now: () => 1_000,
    });
    store.append(
      record("s1", { kind: "session-closed", source: "daemon" }, 1_000),
    );
    store.append(
      record("s1", { kind: "session-closed", source: "daemon" }, 1_500),
    );

    expect(store.getRecent()).toHaveLength(1);
  });

  it("keeps different kinds even in the same window", () => {
    const root = tempRoot();
    const store = new SessionActivityStore({
      dir: root,
      now: () => 1_000,
    });
    store.append(
      record("s1", { kind: "session-created", source: "daemon" }, 1_000),
    );
    store.append(
      record("s1", { kind: "session-ended", source: "daemon" }, 1_500),
    );

    expect(store.getRecent()).toHaveLength(2);
  });
});

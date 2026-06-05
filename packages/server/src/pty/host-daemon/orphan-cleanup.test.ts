import type { SessionRecord } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { reconcileSessionRecords } from "./orphan-cleanup.js";

function rec(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: over.id ?? "s1",
    projectId: over.projectId ?? "p1",
    command: over.command ?? { type: "shell" },
    cwd: over.cwd ?? "/tmp",
    pid: "pid" in over ? (over.pid as number | null) : 12345,
    pgid: "pgid" in over ? (over.pgid as number | null) : 12345,
    argv: over.argv ?? ["/bin/bash"],
    startedAt: over.startedAt ?? "2026-04-28T00:00:00.000Z",
    state: over.state ?? "running",
    exitCode: "exitCode" in over ? (over.exitCode as number | null) : null,
    exitSignal:
      "exitSignal" in over ? (over.exitSignal as string | null) : null,
    daemonPid: over.daemonPid ?? 999,
    daemonStartedAt: over.daemonStartedAt ?? "2026-04-28T00:00:00.000Z",
  };
}

describe("reconcileSessionRecords", () => {
  it("keeps a running record whose daemonPid matches the current daemon", () => {
    const r = rec({ id: "a", pid: 100, daemonPid: 999 });
    const result = reconcileSessionRecords([r], {
      currentDaemonPid: 999,
      currentDaemonStartedAt: "2026-04-28T00:00:00.000Z",
      isPidAlive: () => true,
    });
    expect(result.records[0]?.state).toBe("running");
    expect(result.transitions).toEqual([{ type: "kept", id: "a" }]);
  });

  it("transitions a running record with mismatched daemonPid (alive pid) to orphaned", () => {
    const r = rec({ id: "b", pid: 200, daemonPid: 111 });
    const result = reconcileSessionRecords([r], {
      currentDaemonPid: 222,
      currentDaemonStartedAt: "2026-04-28T00:00:00.000Z",
      isPidAlive: () => true,
    });
    expect(result.records[0]?.state).toBe("orphaned");
    expect(result.transitions).toEqual([
      { type: "orphaned", id: "b", previousDaemonPid: 111 },
    ]);
  });

  it("transitions a running record with a dead pid to lost", () => {
    const r = rec({ id: "c", pid: 300, daemonPid: 999 });
    const result = reconcileSessionRecords([r], {
      currentDaemonPid: 999,
      currentDaemonStartedAt: "2026-04-28T00:00:00.000Z",
      isPidAlive: () => false,
    });
    expect(result.records[0]?.state).toBe("lost");
    expect(result.transitions).toEqual([
      { type: "lost", id: "c", reason: "dead-pid" },
    ]);
  });

  it("transitions a running record with null pid to lost (create-stub never spawned)", () => {
    const r = rec({ id: "d", pid: null, daemonPid: 999 });
    const result = reconcileSessionRecords([r], {
      currentDaemonPid: 999,
      currentDaemonStartedAt: "2026-04-28T00:00:00.000Z",
      isPidAlive: () => true,
    });
    expect(result.records[0]?.state).toBe("lost");
    expect(result.transitions).toEqual([
      { type: "lost", id: "d", reason: "no-pid" },
    ]);
  });

  it("passes through already-terminal records unchanged", () => {
    const exited = rec({ id: "e", state: "exited", exitCode: 0 });
    const lost = rec({ id: "f", state: "lost" });
    const orphaned = rec({ id: "g", state: "orphaned" });
    const result = reconcileSessionRecords([exited, lost, orphaned], {
      currentDaemonPid: 999,
      currentDaemonStartedAt: "2026-04-28T00:00:00.000Z",
      isPidAlive: () => false,
    });
    expect(result.records).toEqual([exited, lost, orphaned]);
    expect(result.transitions).toEqual([]);
  });

  it("preserves input order and does not mutate input records", () => {
    const a = rec({ id: "a", pid: 1, daemonPid: 999 });
    const b = rec({ id: "b", pid: 2, daemonPid: 111 });
    const c = rec({ id: "c", pid: 3, daemonPid: 999 });
    const input = [a, b, c];
    const result = reconcileSessionRecords(input, {
      currentDaemonPid: 999,
      currentDaemonStartedAt: "2026-04-28T00:00:00.000Z",
      isPidAlive: (pid) => pid !== 3, // c is dead
    });
    expect(result.records.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result.records[0]?.state).toBe("running");
    expect(result.records[1]?.state).toBe("orphaned");
    expect(result.records[2]?.state).toBe("lost");
    // input untouched
    expect(a.state).toBe("running");
    expect(b.state).toBe("running");
    expect(c.state).toBe("running");
  });
  it("transitions running record to orphaned when daemonPid matches but startedAt differs (PID recycle)", () => {
    const r = rec({
      id: "h",
      pid: 100,
      daemonPid: 999,
      daemonStartedAt: "2026-04-27T00:00:00.000Z",
    });
    const result = reconcileSessionRecords([r], {
      currentDaemonPid: 999,
      currentDaemonStartedAt: "2026-04-28T00:00:00.000Z",
      isPidAlive: () => true,
    });
    expect(result.records[0]?.state).toBe("orphaned");
    expect(result.transitions).toEqual([
      { type: "orphaned", id: "h", previousDaemonPid: 999 },
    ]);
  });
});

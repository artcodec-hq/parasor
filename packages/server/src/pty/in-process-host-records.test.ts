import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import {
  InProcessPtyHost,
  type InProcessPtyHostDaemonContext,
} from "./in-process-host.js";

/*
 * -- verify InProcessPtyHost mirrors PTY lifecycle
 * into AppState.sessionRecords when a daemonContext is supplied. The
 * goal is to exercise *every* state transition the orphan-cleanup
 * reconcile path cares about (running -> exited / restart cycle / dispose
 * removal) without booting a real daemon -- that lives in a separate
 * integration test (see ).
 *
 * PTY-allocating tests (testEagerSpawn) rely on `posix_openpt`, which is
 * blocked under macOS sandbox-exec. Those are exercised by
 * `in-process-host.test.ts` (run with sandbox disabled). Here we focus
 * on the create() / restart() / dispose() / shutdownAll() flows that
 * mutate `sessionRecords` *before* the PTY spawns, plus a no-context
 * regression check that keeps the array empty for non-daemon callers.
 */

function makeStore(): { store: AppStateStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "in-process-host-records-test-"));
  const store = new AppStateStore({ dir, debounceMs: 0 });
  return {
    store,
    cleanup: () => {
      store.destroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const DAEMON_CTX: InProcessPtyHostDaemonContext = {
  pid: 4242,
  startedAt: "2026-04-28T00:00:00.000Z",
};

describe("InProcessPtyHost SessionRecord persistence", () => {
  let cleanup: () => void;
  let store: AppStateStore;
  let host: InProcessPtyHost;

  beforeEach(() => {
    const r = makeStore();
    store = r.store;
    cleanup = r.cleanup;
    host = new InProcessPtyHost(store, null, DAEMON_CTX);
  });

  afterEach(async () => {
    await host.disposeAll();
    cleanup?.();
  });

  it("create() pushes a stub record (state=running, pid=null, daemon tuple)", async () => {
    const s = await host.create({
      projectId: "p1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const records = store.get().sessionRecords;
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.id).toBe(s.id);
    expect(r.projectId).toBe("p1");
    expect(r.command).toEqual({ type: "shell" });
    // PTY not yet spawned -- pid/pgid are null, but state is "running" so
    // an ungraceful crash before spawnProcess transitions it to "lost".
    expect(r.pid).toBeNull();
    expect(r.pgid).toBeNull();
    expect(r.state).toBe("running");
    expect(r.exitCode).toBeNull();
    expect(r.exitSignal).toBeNull();
    expect(r.daemonPid).toBe(DAEMON_CTX.pid);
    expect(r.daemonStartedAt).toBe(DAEMON_CTX.startedAt);
    expect(Array.isArray(r.argv)).toBe(true);
    expect(r.argv.length).toBeGreaterThan(0);
  });

  it("dispose() removes the record from sessionRecords", async () => {
    const s = await host.create({
      projectId: "p1",
      command: { type: "shell" },
      cwd: "/",
    });
    expect(store.get().sessionRecords).toHaveLength(1);
    await host.dispose(s.id);
    expect(store.get().sessionRecords).toHaveLength(0);
  });

  it("restart() rearms record (clears pid, refreshes startedAt, keeps daemon tuple)", async () => {
    const s = await host.create({
      projectId: "p1",
      command: { type: "shell" },
      cwd: "/",
    });
    // Drive the managed session to "ended" so restart() is permitted.
    // We can't actually spawn under sandbox, so we mutate the internal
    // info field directly -- the same path that onExit takes.
    const internal = (
      host as unknown as {
        sessions: Map<string, { info: { state: string }; record: unknown }>;
      }
    ).sessions.get(s.id);
    if (!internal) throw new Error("session not found");
    internal.info.state = "ended";

    const before = store.get().sessionRecords[0];
    await new Promise((res) => setTimeout(res, 5)); // ensure startedAt advances
    await host.restart(s.id);

    const after = store.get().sessionRecords[0];
    expect(after.id).toBe(s.id);
    expect(after.pid).toBeNull();
    expect(after.pgid).toBeNull();
    expect(after.state).toBe("running");
    expect(after.exitCode).toBeNull();
    expect(after.exitSignal).toBeNull();
    expect(after.daemonPid).toBe(DAEMON_CTX.pid);
    expect(after.daemonStartedAt).toBe(DAEMON_CTX.startedAt);
    expect(Date.parse(after.startedAt)).toBeGreaterThanOrEqual(
      Date.parse(before.startedAt),
    );
  });

  it("shutdownAll() marks live records as state=exited / exitSignal=SIGHUP", async () => {
    const s1 = await host.create({
      projectId: "p1",
      command: { type: "shell" },
      cwd: "/",
    });
    const s2 = await host.create({
      projectId: "p1",
      command: { type: "shell" },
      cwd: "/",
    });
    await host.shutdownAll();

    const recs = store.get().sessionRecords;
    expect(recs).toHaveLength(2);
    for (const r of recs) {
      expect([s1.id, s2.id]).toContain(r.id);
      expect(r.state).toBe("exited");
      expect(r.pid).toBeNull();
      expect(r.pgid).toBeNull();
      expect(r.exitSignal).toBe("SIGHUP");
    }
  });

  it("loadPersistedSession() rehydrates the record from AppState", () => {
    // Seed the store with a record + session as if a previous daemon
    // generation wrote them, then construct a fresh host and rehydrate.
    store.mutateSessions((s) => {
      s.sessions.push({
        id: "seed-1",
        projectId: "p1",
        pid: null,
        state: "ended",
        generation: 1,
        title: "shell",
        command: { type: "shell" },
        cwd: "/",
        shell: "bash",
        createdAt: 0,
      });
      s.sessionRecords.push({
        id: "seed-1",
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/",
        pid: 999,
        pgid: 999,
        argv: ["bash"],
        startedAt: "2026-01-01T00:00:00.000Z",
        state: "running",
        exitCode: null,
        exitSignal: null,
        daemonPid: 1,
        daemonStartedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    host.loadPersistedSession(
      {
        id: "seed-1",
        projectId: "p1",
        pid: null,
        state: "ended",
        generation: 1,
        title: "shell",
        command: { type: "shell" },
        cwd: "/",
        shell: "bash",
        createdAt: 0,
      },
      true,
    );

    const internal = (
      host as unknown as {
        sessions: Map<string, { record: { pid: number | null } | null }>;
      }
    ).sessions.get("seed-1");
    expect(internal?.record).not.toBeNull();
    expect(internal?.record?.pid).toBe(999);
  });

  it("no daemonContext -> sessionRecords stays empty (back-compat path)", async () => {
    const r = makeStore();
    try {
      const noCtxHost = new InProcessPtyHost(r.store, null, null);
      await noCtxHost.create({
        projectId: "p1",
        command: { type: "shell" },
        cwd: "/",
      });
      expect(r.store.get().sessionRecords).toEqual([]);
      await noCtxHost.disposeAll();
    } finally {
      r.cleanup();
    }
  });
});

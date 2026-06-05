import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import { InProcessPtyHost } from "./in-process-host.js";
import { ScrollbackLog } from "./scrollback-log.js";

function makeStore(): {
  store: AppStateStore;
  scrollbackLog: ScrollbackLog;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "in-process-host-test-"));
  const store = new AppStateStore({ dir, debounceMs: 0 });
  const scrollbackLog = new ScrollbackLog(dir);
  return {
    store,
    scrollbackLog,
    cleanup: () => {
      store.destroy(); // cancel pending debounce, prevent further writes
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function createAndSpawn(manager: InProcessPtyHost, projectId = "proj-1") {
  const session = await manager.create({
    projectId,
    command: { type: "shell" },
    cwd: process.env.HOME ?? "/",
  });
  await manager.testEagerSpawn(session.id);
  const managed = manager.get(session.id);
  if (!managed) {
    throw new Error(`Expected managed session ${session.id} to exist`);
  }
  return managed;
}

function getInternalSession<T>(
  manager: InProcessPtyHost,
  sessionId: string,
): T {
  const managed = (
    manager as unknown as {
      sessions: Map<string, T>;
    }
  ).sessions.get(sessionId);
  if (!managed) {
    throw new Error(`Expected internal session ${sessionId} to exist`);
  }
  return managed;
}

function makeFakePtyProcess() {
  return {
    pause: vi.fn(),
    resume: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    process: "zsh",
  };
}

describe("InProcessPtyHost", () => {
  let manager: InProcessPtyHost;
  let scrollbackLog: ScrollbackLog;
  let cleanup: () => void;

  beforeEach(() => {
    const result = makeStore();
    cleanup = result.cleanup;
    scrollbackLog = result.scrollbackLog;
    manager = new InProcessPtyHost(result.store, result.scrollbackLog);
  });

  afterEach(async () => {
    await manager?.disposeAll();
    cleanup?.();
  });

  it("creates a session in spawning state without a pid", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    expect(session.id).toBeDefined();
    expect(session.pid).toBeNull();
    expect(session.state).toBe("spawning");
    expect(session.generation).toBe(1);
    expect(session.projectId).toBe("proj-1");
    expect(session.createdAt).toBeGreaterThan(0);
  });

  it("marks explicit create titles as manual", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
      title: "Dev server",
      bootstrapInput: "pnpm dev\r",
    });

    expect(session.title).toBe("Dev server");
    expect(session.titleManual).toBe(true);
    expect(manager.get(session.id)?.titleManual).toBe(true);
  });

  it("marks spawned PTYs as truecolor-capable terminals", () => {
    const env = (
      manager as unknown as {
        buildSessionEnv: (
          sessionId: string,
          projectId: string,
        ) => Record<string, string>;
      }
    ).buildSessionEnv("session-1", "project-1");

    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
    expect(env.TERM_PROGRAM).toBe("parasor");
  });

  it("testEagerSpawn transitions spawning -> running and assigns a pid", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    await manager.testEagerSpawn(session.id);
    const after = manager.get(session.id);
    if (!after) {
      throw new Error(`Expected managed session ${session.id} to exist`);
    }
    expect(after.state).toBe("running");
    expect(after.pid).toBeGreaterThan(0);
  });

  it("lists all active sessions", async () => {
    await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    expect(manager.list()).toHaveLength(2);
  });

  it("gets a session by id", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const found = manager.get(session.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(session.id);
  });

  it("returns undefined for unknown session id", () => {
    expect(manager.get("nonexistent")).toBeUndefined();
  });

  it("listByProject filters by projectId", async () => {
    await manager.create({
      projectId: "proj-a",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    await manager.create({
      projectId: "proj-b",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const results = manager.listByProject("proj-a");
    expect(results).toHaveLength(1);
    expect(results[0].projectId).toBe("proj-a");
  });

  it("disposes a session by id", async () => {
    const session = await createAndSpawn(manager);
    await manager.dispose(session.id);
    expect(manager.get(session.id)).toBeUndefined();
    expect(manager.list()).toHaveLength(0);
  });

  it("writes input to a session without throwing", async () => {
    const session = await createAndSpawn(manager);
    expect(() => manager.write(session.id, "echo hello\n")).not.toThrow();
  });

  it("pauses and resumes PTY output for a single attached client", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const pause = vi.fn();
    const resume = vi.fn();
    const internal = getInternalSession<{
      process: { pause: () => void; resume: () => void } | null;
      attachedClients: Map<
        string,
        {
          kind: "string";
          listener: (data: string) => void;
          attachToken: number;
          flowPaused: boolean;
        }
      >;
    }>(manager, session.id);
    internal.process = { pause, resume };
    internal.attachedClients.set("client-a", {
      kind: "string",
      listener: () => {},
      attachToken: 1,
      flowPaused: false,
    });

    manager.pauseOutput(session.id, "client-a");
    manager.resumeOutput(session.id, "client-a");

    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("does not globally pause PTY output for one paused multi-client viewer", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const pause = vi.fn();
    const resume = vi.fn();
    const internal = getInternalSession<{
      process: { pause: () => void; resume: () => void } | null;
      attachedClients: Map<
        string,
        {
          kind: "string";
          listener: (data: string) => void;
          attachToken: number;
          flowPaused: boolean;
        }
      >;
    }>(manager, session.id);
    internal.process = { pause, resume };
    internal.attachedClients.set("client-a", {
      kind: "string",
      listener: () => {},
      attachToken: 1,
      flowPaused: false,
    });
    internal.attachedClients.set("client-b", {
      kind: "string",
      listener: () => {},
      attachToken: 2,
      flowPaused: false,
    });

    manager.pauseOutput(session.id, "client-a");

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("resumes a paused PTY when a second client attaches", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const pause = vi.fn();
    const resume = vi.fn();
    const internal = getInternalSession<{
      info: { state: "spawning" | "running" | "ended" };
      process: {
        pause: () => void;
        resume: () => void;
        resize: (cols: number, rows: number) => void;
      } | null;
      attachedClients: Map<
        string,
        {
          kind: "string";
          listener: (data: string) => void;
          attachToken: number;
          flowPaused: boolean;
        }
      >;
    }>(manager, session.id);
    internal.info.state = "running";
    internal.process = { pause, resume, resize: vi.fn() };
    internal.attachedClients.set("client-a", {
      kind: "string",
      listener: () => {},
      attachToken: 1,
      flowPaused: false,
    });

    manager.pauseOutput(session.id, "client-a");
    await manager.initClient(session.id, "client-b", 80, 24, () => {});

    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("writes bootstrap input once when the PTY first spawns", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
      bootstrapInput: "echo bootstrapped\r",
    });
    const seen: { id: string; data: string }[] = [];
    manager.onSessionInput((id, data) => seen.push({ id, data }));

    await manager.testEagerSpawn(session.id);
    await manager.initClient(session.id, "client-1", 80, 24, () => {});

    expect(seen).toEqual([{ id: session.id, data: "echo bootstrapped\r" }]);
  });

  /*
   * PTY generation gate: input tagged with a stale generation must be dropped before it
   * reaches the PTY. Reproduces the auto-resume race where a previous
   * TUI's terminal-mode-query response (e.g. DECRPM `\x1b[?2026;2$y`)
   * arrives on the WS after the new shell has spawned. Verifies via the
   * onSessionInput hook because that fires only when write() actually
   * forwards to the PTY.
   */
  it("drops input tagged with a stale generation (PTY generation gate)", async () => {
    const session = await createAndSpawn(manager);
    const seen: { id: string; data: string }[] = [];
    manager.onSessionInput((id, data) => seen.push({ id, data }));

    const internal = getInternalSession<{ currentGeneration: number }>(
      manager,
      session.id,
    );
    // Simulate auto-resume so generation > 1 -- required because gen=0 is
    // a "no-tag" sentinel (legacy/untagged callers), so `current - 1`
    // off a fresh gen=1 session would not exercise the drop path.
    internal.currentGeneration = 3;
    const current = internal.currentGeneration;

    manager.write(session.id, "stale", current - 1);
    manager.write(session.id, "fresh", current);
    manager.write(session.id, "untagged");

    expect(seen).toEqual([
      { id: session.id, data: "fresh" },
      { id: session.id, data: "untagged" },
    ]);
  });

  it("resize on a live session does not throw", async () => {
    const session = await createAndSpawn(manager);
    expect(() => manager.resize(session.id, 120, 40)).not.toThrow();
  });

  it("resize on a spawning session is a no-op (no pty yet)", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    expect(() => manager.resize(session.id, 120, 40)).not.toThrow();
  });

  it("explicit resize is authoritative for a running session", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const fakeProcess = makeFakePtyProcess();
    const internal = getInternalSession<{
      info: { state: "running" };
      process: ReturnType<typeof makeFakePtyProcess> | null;
    }>(manager, session.id);
    internal.info.state = "running";
    internal.process = fakeProcess;

    manager.resize(session.id, 120, 40);

    expect(fakeProcess.resize).toHaveBeenCalledExactlyOnceWith(120, 40);
  });

  it("duplicate explicit resize claims are no-ops for the running PTY", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const fakeProcess = makeFakePtyProcess();
    const internal = getInternalSession<{
      info: { state: "running" };
      process: ReturnType<typeof makeFakePtyProcess> | null;
      ptySize: { cols: number; rows: number } | null;
    }>(manager, session.id);
    internal.info.state = "running";
    internal.process = fakeProcess;
    internal.ptySize = { cols: 80, rows: 24 };

    manager.resize(session.id, 80, 24);
    manager.resize(session.id, 120, 40);
    manager.resize(session.id, 120, 40);

    expect(fakeProcess.resize).toHaveBeenCalledExactlyOnceWith(120, 40);
    expect(internal.ptySize).toEqual({ cols: 120, rows: 40 });
  });

  it("initClient spawns the pty on first attach and replays scrollback", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    // Before init, session is spawning and there's no scrollback.
    expect(manager.get(session.id)?.state).toBe("spawning");

    const received: string[] = [];
    const result = await manager.initClient(
      session.id,
      "client-1",
      100,
      30,
      (d) => received.push(d),
    );
    expect(result.ok).toBe(true);
    expect(manager.get(session.id)?.state).toBe("running");
    expect(manager.get(session.id)?.pid).toBeGreaterThan(0);

    // Scrollback replay is empty right after spawn (no prompt yet).
    expect(received.join("")).toBe("");
  });

  it("initClient passes requested dimensions to the first PTY spawn", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const spawnSpy = vi.spyOn(
      manager as unknown as {
        spawnProcess: (managed: unknown, cols: number, rows: number) => unknown;
      },
      "spawnProcess",
    );

    await manager.initClient(session.id, "client-1", 101, 31, () => {});

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0]?.[1]).toBe(101);
    expect(spawnSpy.mock.calls[0]?.[2]).toBe(31);
  });

  it("attachClient passes requested dimensions to the first PTY spawn", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const spawnSpy = vi.spyOn(
      manager as unknown as {
        spawnProcess: (managed: unknown, cols: number, rows: number) => unknown;
      },
      "spawnProcess",
    );

    const result = await manager.attachClient(
      session.id,
      "client-1",
      102,
      32,
      { binary: true, chunkedReplay: true },
      { onChunk: () => {}, onExit: () => {} },
    );

    expect(result.ok).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0]?.[1]).toBe(102);
    expect(spawnSpy.mock.calls[0]?.[2]).toBe(32);
  });

  it("initClient passes requested dimensions to safe auto-resume", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const internal = getInternalSession<{
      info: {
        state: "ended";
        endReason: { type: "exit"; code: number };
      };
      process: null;
    }>(manager, session.id);
    internal.info.state = "ended";
    internal.info.endReason = { type: "exit", code: 0 };
    internal.process = null;
    const spawnSpy = vi.spyOn(
      manager as unknown as {
        spawnProcess: (managed: unknown, cols: number, rows: number) => unknown;
      },
      "spawnProcess",
    );

    const result = await manager.initClient(
      session.id,
      "client-1",
      103,
      33,
      () => {},
    );

    expect(result.ok).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0]?.[1]).toBe(103);
    expect(spawnSpy.mock.calls[0]?.[2]).toBe(33);
  });

  it("initClient does not resize an already-running PTY on passive attach", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const fakeProcess = makeFakePtyProcess();
    const internal = getInternalSession<{
      info: { state: "running" };
      process: ReturnType<typeof makeFakePtyProcess> | null;
    }>(manager, session.id);
    internal.info.state = "running";
    internal.process = fakeProcess;

    const result = await manager.initClient(
      session.id,
      "client-1",
      120,
      40,
      () => {},
    );

    expect(result.ok).toBe(true);
    expect(fakeProcess.resize).not.toHaveBeenCalled();
  });

  it("initClient replays accumulated scrollback to a new client", async () => {
    const session = await createAndSpawn(manager);
    // No explicit flush -- `readTail()` flushes the session's pending
    // append buffer synchronously so callers see every byte that was
    // already passed to `append()`.
    scrollbackLog.append(session.id, "user@host:~$ ");

    const received: string[] = [];
    await manager.initClient(session.id, "client-1", 80, 24, (d) =>
      received.push(d),
    );

    expect(received.join("")).toContain("user@host:~$ ");
  });

  it("attachClient delta replay does not read the disk tail", async () => {
    const session = await createAndSpawn(manager);
    const readTailSpy = vi.spyOn(scrollbackLog, "readTail");
    vi.spyOn(scrollbackLog, "readSince").mockReturnValue({
      kind: "delta",
      chunks: [{ seq: 1n, data: Buffer.from("hi") }],
    });

    const result = await manager.attachClient(
      session.id,
      "c1",
      80,
      24,
      {
        binary: true,
        chunkedReplay: true,
        lastSeen: { generation: 1, seq: "0" },
      },
      { onChunk: () => {}, onExit: () => {} },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replay).toBe("delta");
    expect(readTailSpy).not.toHaveBeenCalled();
  });

  it("attachClient does not resize an already-running PTY on passive attach", async () => {
    const session = await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    const fakeProcess = makeFakePtyProcess();
    const internal = getInternalSession<{
      info: { state: "running" };
      process: ReturnType<typeof makeFakePtyProcess> | null;
    }>(manager, session.id);
    internal.info.state = "running";
    internal.process = fakeProcess;

    const result = await manager.attachClient(
      session.id,
      "client-1",
      120,
      40,
      { binary: true, chunkedReplay: true },
      { onChunk: () => {}, onExit: () => {} },
    );

    expect(result.ok).toBe(true);
    expect(fakeProcess.resize).not.toHaveBeenCalled();
  });

  it("attachClient full replay reads the disk tail once", async () => {
    const session = await createAndSpawn(manager);
    const readTailSpy = vi
      .spyOn(scrollbackLog, "readTail")
      .mockReturnValue("TAILDATA");
    vi.spyOn(scrollbackLog, "readSince").mockReturnValue({ kind: "full" });

    const result = await manager.attachClient(
      session.id,
      "c1",
      80,
      24,
      {
        binary: true,
        chunkedReplay: true,
        lastSeen: { generation: 1, seq: "0" },
      },
      { onChunk: () => {}, onExit: () => {} },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replay).toBe("full");
      expect(result.fullReplay).toContain("TAILDATA");
    }
    expect(readTailSpy).toHaveBeenCalledTimes(1);
  });

  it("attachClient full replay uses a bounded headless snapshot by default", async () => {
    const session = await createAndSpawn(manager);
    const rawTail = `${"old-output-with-padding-0000000000000000000000\r\n".repeat(12_000)}latest prompt\n`;
    scrollbackLog.append(session.id, rawTail);
    vi.spyOn(scrollbackLog, "readSince").mockReturnValue({ kind: "full" });

    const result = await manager.attachClient(
      session.id,
      "c1",
      80,
      24,
      {
        binary: true,
        chunkedReplay: true,
        lastSeen: { generation: 1, seq: "0" },
      },
      { onChunk: () => {}, onExit: () => {} },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replay).toBe("full");
      expect(result.replayDiagnostics?.source).toBe("headless-rebuild");
      expect(result.replayDiagnostics?.rawBytes).toBe(
        Buffer.byteLength(rawTail, "utf8"),
      );
      expect(result.replayDiagnostics?.maxBytes).toBe(256 * 1024);
      expect(
        Buffer.byteLength(result.fullReplay ?? "", "utf8"),
      ).toBeLessThanOrEqual(256 * 1024);
      expect(result.fullReplay).toContain("latest prompt");
    }
  });

  it("attachClient does not full-replay disk tail when lastSeen is already current", async () => {
    const session = await createAndSpawn(manager);
    const readTailSpy = vi
      .spyOn(scrollbackLog, "readTail")
      .mockReturnValue("TAILDATA");
    vi.spyOn(scrollbackLog, "readSince").mockReturnValue({ kind: "none" });

    const result = await manager.attachClient(
      session.id,
      "c1",
      80,
      24,
      {
        binary: true,
        chunkedReplay: true,
        lastSeen: { generation: 1, seq: "5" },
      },
      { onChunk: () => {}, onExit: () => {} },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replay).toBe("none");
      expect(result.fullReplay).toBeUndefined();
    }
    expect(readTailSpy).not.toHaveBeenCalled();
  });

  it("attaches multiple clients concurrently and broadcasts data to all", async () => {
    const session = await createAndSpawn(manager);

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    await manager.initClient(session.id, "client-a", 80, 24, (d) =>
      receivedA.push(d),
    );
    await manager.initClient(session.id, "client-b", 80, 24, (d) =>
      receivedB.push(d),
    );

    const managed = getInternalSession<{
      attachedClients: Map<string, unknown>;
    }>(manager, session.id);
    expect(managed.attachedClients.size).toBe(2);

    await new Promise<void>((resolve) => {
      const checkDone = () => {
        if (
          receivedA.join("").includes("broadcast-check") &&
          receivedB.join("").includes("broadcast-check")
        ) {
          resolve();
        }
      };
      manager.write(session.id, "echo broadcast-check\n");
      const timer = setInterval(() => {
        checkDone();
      }, 20);
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, 3000);
    });

    expect(receivedA.join("")).toContain("broadcast-check");
    expect(receivedB.join("")).toContain("broadcast-check");
  });

  it("isolates a throwing listener so other clients keep receiving", async () => {
    const session = await createAndSpawn(manager);

    const receivedB: string[] = [];
    await manager.initClient(session.id, "client-a", 80, 24, () => {
      throw new Error("boom");
    });
    await manager.initClient(session.id, "client-b", 80, 24, (d) =>
      receivedB.push(d),
    );

    await new Promise<void>((resolve) => {
      const onDone = () => {
        if (receivedB.join("").includes("still-alive")) resolve();
      };
      manager.write(session.id, "echo still-alive\n");
      const timer = setInterval(onDone, 20);
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, 3000);
    });

    expect(receivedB.join("")).toContain("still-alive");
  });

  it("re-initClient with the same clientId replaces the listener in place", async () => {
    const session = await createAndSpawn(manager);

    await manager.initClient(session.id, "client-a", 80, 24, () => {
      /* noop */
    });
    await manager.initClient(session.id, "client-a", 80, 24, () => {
      /* noop */
    });

    const managed = getInternalSession<{
      attachedClients: Map<string, unknown>;
    }>(manager, session.id);
    expect(managed.attachedClients.size).toBe(1);
    expect(managed.attachedClients.has("client-a")).toBe(true);
  });

  it("detachClient removes only the specified client", async () => {
    const session = await createAndSpawn(manager);
    await manager.initClient(session.id, "client-a", 80, 24, () => {
      /* noop */
    });
    await manager.initClient(session.id, "client-b", 80, 24, () => {
      /* noop */
    });
    manager.detachClient(session.id, "client-a");

    const managed = getInternalSession<{
      attachedClients: Map<string, unknown>;
    }>(manager, session.id);
    expect(managed.attachedClients.size).toBe(1);
    expect(managed.attachedClients.has("client-b")).toBe(true);
  });

  // Attach fencing -- fencing token. A stale onClose for client-A's old WS
  // (with the old attach-token) MUST NOT remove the entry that the new
  // attach (same clientId, fresh token) just registered.
  it("detachClient with stale token does not evict the live entry", async () => {
    const session = await createAndSpawn(manager);

    // First attach -- captures token1.
    const first = await manager.initClient(
      session.id,
      "client-a",
      80,
      24,
      () => {
        /* old listener */
      },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const staleToken = first.attachToken;

    // Re-attach same clientId -- fresh token2 overwrites the entry.
    const liveListener = vi.fn();
    const second = await manager.initClient(
      session.id,
      "client-a",
      80,
      24,
      liveListener,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.attachToken).not.toBe(staleToken);

    // Stale onClose firing now: detach with the OLD token. Must be a no-op.
    manager.detachClient(session.id, "client-a", staleToken);

    const managed = getInternalSession<{
      attachedClients: Map<string, unknown>;
    }>(manager, session.id);
    expect(managed.attachedClients.size).toBe(1);
    expect(managed.attachedClients.has("client-a")).toBe(true);

    // Detach with the matching token DOES remove it.
    manager.detachClient(session.id, "client-a", second.attachToken);
    expect(managed.attachedClients.size).toBe(0);
  });

  it("initClient throwing replay listener rolls back attachedClients entry (attach fencing)", async () => {
    const session = await createAndSpawn(manager);
    scrollbackLog.append(session.id, "user@host:~$ ");
    const managed = getInternalSession<{
      attachedClients: Map<string, unknown>;
    }>(manager, session.id);

    await expect(
      manager.initClient(session.id, "client-a", 80, 24, () => {
        throw new Error("ws closed mid-replay");
      }),
    ).rejects.toThrow("ws closed mid-replay");

    // Without rollback the entry would leak; cleanupTerminalRelay would
    // then early-return on its undefined token, leaving a stale listener.
    expect(managed.attachedClients.has("client-a")).toBe(false);
  });

  // Unconditional detach (no token supplied) keeps the previous shape --
  // dispose / disposeAll / legacy callers expect it.
  it("detachClient without expectedToken removes unconditionally", async () => {
    const session = await createAndSpawn(manager);
    await manager.initClient(session.id, "client-a", 80, 24, () => {
      /* noop */
    });
    manager.detachClient(session.id, "client-a");
    const managed = getInternalSession<{
      attachedClients: Map<string, unknown>;
    }>(manager, session.id);
    expect(managed.attachedClients.size).toBe(0);
  });

  it("getScrollback returns null for an empty-scrollback session", async () => {
    const session = await createAndSpawn(manager);
    expect(manager.getScrollback(session.id)).toBeNull();
  });

  it("getScrollback returns null for unknown session", () => {
    expect(manager.getScrollback("nope")).toBeNull();
  });

  // scrollback tail regression regression: pre-unification the in-memory accumulator capped
  // scrollback at ~100K chars even though the on-disk log retained up
  // to 4 MiB of tail. After unification every read path goes through
  // scrollbackLog.readTail() so volumes well beyond the old in-memory
  // ceiling are delivered intact.
  it("initClient replay delivers >100K chars from the disk tail (scrollback tail regression)", async () => {
    const session = await createAndSpawn(manager);
    const head = "old-bytes-".repeat(20_000); // 200K chars, beyond old cap
    const tail = "tail-marker-xyz";
    scrollbackLog.append(session.id, head + tail);

    const received: string[] = [];
    await manager.initClient(session.id, "client-1", 80, 24, (d) =>
      received.push(d),
    );

    const replay = received.join("");
    expect(replay.length).toBeGreaterThan(150_000);
    expect(replay).toContain(tail);
  });

  it("emits data events to the attached client listener", async () => {
    const session = await createAndSpawn(manager);
    const data = await new Promise<string>((resolve) => {
      const chunks: string[] = [];
      void manager.initClient(session.id, "client-1", 80, 24, (d) => {
        chunks.push(d);
        if (chunks.join("").includes("test-output-xyz")) {
          resolve(chunks.join(""));
        }
      });
      // Give the init a tick, then write. testEagerSpawn already spawned
      // the PTY so the write path is live immediately.
      setImmediate(() => {
        manager.write(session.id, "echo test-output-xyz\n");
      });
    });
    expect(data).toContain("test-output-xyz");
  });

  it("onSessionData global listener receives data", async () => {
    const session = await createAndSpawn(manager);
    const result = await new Promise<{ sessionId: string; data: string }>(
      (resolve) => {
        manager.onSessionData((sessionId, data) =>
          resolve({ sessionId, data }),
        );
        manager.write(session.id, "echo global-test\n");
      },
    );
    expect(result.sessionId).toBe(session.id);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("disposeAll clears all sessions", async () => {
    await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    await manager.create({
      projectId: "proj-1",
      command: { type: "shell" },
      cwd: process.env.HOME ?? "/",
    });
    await manager.disposeAll();
    expect(manager.list()).toHaveLength(0);
  });

  it("restart rejects if session is not ended", async () => {
    const session = await createAndSpawn(manager);
    await expect(manager.restart(session.id)).rejects.toThrow("not ended");
  });

  it("restart rejects if session not found", async () => {
    await expect(manager.restart("does-not-exist")).rejects.toThrow(
      "not found",
    );
  });

  it("loadPersistedSession makes an ended session available via get()", () => {
    const fakeSession = {
      id: "persisted-1",
      projectId: "proj-1",
      pid: null,
      state: "ended" as const,
      generation: 2,
      title: "Old session",
      command: { type: "shell" as const },
      cwd: "/",
      shell: "/bin/zsh",
      createdAt: Date.now() - 10000,
      endedAt: Date.now() - 5000,
    };
    manager.loadPersistedSession(fakeSession, true);
    const found = manager.get("persisted-1");
    expect(found).toBeDefined();
    expect(found?.state).toBe("ended");
    expect(found?.generation).toBe(2);
    expect(found?.endReason).toEqual({ type: "server-graceful" });
  });

  it("loadPersistedSession marks unlabeled sessions as server-crash when marker is missing", () => {
    const fakeSession = {
      id: "persisted-2",
      projectId: "proj-1",
      pid: null,
      state: "ended" as const,
      generation: 1,
      title: "Crash session",
      command: { type: "shell" as const },
      cwd: "/",
      shell: "/bin/zsh",
      createdAt: Date.now() - 10000,
    };
    manager.loadPersistedSession(fakeSession, false);
    expect(manager.get("persisted-2")?.endReason).toEqual({
      type: "server-crash",
    });
  });

  it("loadPersistedSession preserves a pre-existing endReason", () => {
    const fakeSession = {
      id: "persisted-3",
      projectId: "proj-1",
      pid: null,
      state: "ended" as const,
      generation: 1,
      title: "Already exited",
      command: { type: "shell" as const },
      cwd: "/",
      shell: "/bin/zsh",
      createdAt: Date.now() - 10000,
      endReason: { type: "exit" as const, code: 42 },
    };
    manager.loadPersistedSession(fakeSession, false);
    expect(manager.get("persisted-3")?.endReason).toEqual({
      type: "exit",
      code: 42,
    });
  });

  it("loadPersistedSession on a daemon-context host stamps daemon-graceful", () => {
    const { store, cleanup: c } = makeStore();
    const daemonHost = new InProcessPtyHost(store, null, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    try {
      const fakeSession = {
        id: "daemon-graceful-1",
        projectId: "proj-1",
        pid: null,
        state: "running" as const,
        generation: 1,
        title: "Daemon-owned",
        command: { type: "shell" as const },
        cwd: "/",
        shell: "/bin/zsh",
        createdAt: Date.now() - 10000,
      };
      daemonHost.loadPersistedSession(fakeSession, true);
      expect(daemonHost.get("daemon-graceful-1")?.endReason).toEqual({
        type: "daemon-graceful",
      });
    } finally {
      void daemonHost.disposeAll();
      c();
    }
  });

  it("loadPersistedSession on a daemon-context host stamps daemon-crash when marker missing", () => {
    const { store, cleanup: c } = makeStore();
    const daemonHost = new InProcessPtyHost(store, null, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    try {
      const fakeSession = {
        id: "daemon-crash-1",
        projectId: "proj-1",
        pid: null,
        state: "running" as const,
        generation: 1,
        title: "Daemon-crashed",
        command: { type: "shell" as const },
        cwd: "/",
        shell: "/bin/zsh",
        createdAt: Date.now() - 10000,
      };
      daemonHost.loadPersistedSession(fakeSession, false);
      expect(daemonHost.get("daemon-crash-1")?.endReason).toEqual({
        type: "daemon-crash",
      });
    } finally {
      void daemonHost.disposeAll();
      c();
    }
  });

  it("persists session to store on create", async () => {
    const { store, cleanup: c } = makeStore();
    const mgr = new InProcessPtyHost(store);
    try {
      const session = await mgr.create({
        projectId: "proj-1",
        command: { type: "shell" },
        cwd: process.env.HOME ?? "/",
      });
      await store.flush();
      const state = store.get();
      expect(state.sessions.some((s) => s.id === session.id)).toBe(true);
    } finally {
      await mgr.disposeAll();
      c();
    }
  });

  it("removes session from store on dispose", async () => {
    const { store, cleanup: c } = makeStore();
    const mgr = new InProcessPtyHost(store);
    try {
      const session = await mgr.create({
        projectId: "proj-1",
        command: { type: "shell" },
        cwd: process.env.HOME ?? "/",
      });
      await mgr.dispose(session.id);
      await store.flush();
      const state = store.get();
      expect(state.sessions.some((s) => s.id === session.id)).toBe(false);
    } finally {
      c();
    }
  });
});

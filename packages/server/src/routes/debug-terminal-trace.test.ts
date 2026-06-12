import { promises as fsp, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "@parasor/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalTraceRecorder } from "../debug/terminal-trace-recorder.js";
import type {
  AttachClientCapabilities,
  AttachClientResult,
  AttachClientSink,
  CreateSessionInput,
  PtyHost,
} from "../pty/host.js";
import { AppStateStore } from "../state/app-state.js";
import { ProjectManager } from "../state/project-manager.js";
import { EventBus } from "../ws/events.js";
import { createDebugTerminalTraceRoute } from "./debug-terminal-trace.js";

class FakePtyHost implements PtyHost {
  private sessions = new Map<string, Session>();
  private listeners = new Map<string, (data: string) => void>();
  private sinks = new Map<string, AttachClientSink>();
  private next = 0;
  disposed: string[] = [];

  setPtyEnv(): void {}
  list(): Session[] {
    return [...this.sessions.values()];
  }
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }
  listByProject(projectId: string): Session[] {
    return this.list().filter((session) => session.projectId === projectId);
  }
  getScrollback(): string | null {
    return null;
  }
  getForegroundProcess(): string | null {
    return null;
  }
  async create(input: CreateSessionInput): Promise<Session> {
    const id = `probe-session-${++this.next}`;
    const session = {
      id,
      projectId: input.projectId,
      title: input.title ?? "probe",
      command: input.command,
      cwd: input.cwd,
      pinned: false,
      createdAt: 1,
      updatedAt: 1,
      generation: 1,
      state: "running",
    } as unknown as Session;
    this.sessions.set(id, session);
    return session;
  }
  async restart(): Promise<Session> {
    throw new Error("not used");
  }
  setTitle(): boolean {
    return true;
  }
  setPinned(): boolean {
    return true;
  }
  write(id: string, data: string): void {
    const marker = /printf '([^']+)\\n'/.exec(data)?.[1];
    if (!marker) return;
    this.listeners.get(id)?.(`${marker}\r\n`);
    this.sinks.get(id)?.onChunk(1, 1n, Buffer.from(`${marker}\r\n`));
  }
  resize(): void {}
  refresh(): void {}
  pauseOutput(): void {}
  resumeOutput(): void {}
  async initClient(
    id: string,
    _clientId: string,
    _cols: number,
    _rows: number,
    listener: (data: string) => void,
  ): Promise<{ ok: true; attachToken: number } | { ok: false }> {
    if (!this.sessions.has(id)) return { ok: false };
    this.listeners.set(id, listener);
    listener("prompt");
    return { ok: true, attachToken: 1 };
  }
  async attachClient(
    id: string,
    _clientId: string,
    _cols: number,
    _rows: number,
    _capabilities: AttachClientCapabilities,
    sink: AttachClientSink,
  ): Promise<AttachClientResult> {
    if (!this.sessions.has(id)) return { ok: false };
    this.sinks.set(id, sink);
    sink.onChunk(1, 0n, Buffer.from("prompt"));
    return {
      ok: true,
      attachToken: 1,
      capabilities: { binary: true, chunkedReplay: true },
      serverState: { generation: 1, lastDeliveredSeq: null, oldestSeq: null },
      replay: "none",
    };
  }
  detachClient(id: string): void {
    this.listeners.delete(id);
    this.sinks.delete(id);
  }
  async dispose(id: string): Promise<void> {
    this.disposed.push(id);
    this.sessions.delete(id);
  }
  async disposeAll(): Promise<void> {}
  async shutdownAll(): Promise<void> {}
  loadPersistedSession(): void {}
  onSessionInput(): void {}
  onSessionData(): void {}
  onSessionExit = null;
}

describe("debug terminal trace route", () => {
  const cleanups: string[] = [];

  afterEach(async () => {
    for (const dir of cleanups.splice(0)) {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  function makeApp() {
    const dir = mkdtempSync(join(tmpdir(), "parasor-terminal-trace-route-"));
    cleanups.push(dir);
    const store = new AppStateStore({
      dir,
      debounceMs: 0,
      onPersistError: null,
    });
    const projectManager = new ProjectManager(store);
    const project = projectManager.create({ path: dir, name: "repo" });
    const recorder = new TerminalTraceRecorder({ now: () => 123 });
    const ptyManager = new FakePtyHost();
    const app = new Hono();
    app.route(
      "/api/debug/terminal-trace",
      createDebugTerminalTraceRoute({
        recorder,
        ptyManager,
        eventBus: new EventBus(),
        appStateStore: store,
        projectManager,
      }),
    );
    return { app, project, recorder, ptyManager };
  }

  it("supports enable, query, and clear", async () => {
    const { app, recorder } = makeApp();
    let res = await app.request("/api/debug/terminal-trace", {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    recorder.record("pty-refresh", {}, { sessionId: "s1" });

    res = await app.request("/api/debug/terminal-trace");
    expect(await res.json()).toMatchObject({
      enabled: true,
      eventCount: 1,
      events: [{ type: "pty-refresh", sessionId: "s1" }],
    });

    res = await app.request("/api/debug/terminal-trace", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(recorder.list()).toEqual([]);
  });

  it("ingests bounded sanitized client trace batches", async () => {
    const { app, recorder } = makeApp();
    recorder.setEnabled(true);

    const events = Array.from({ length: 205 }, (_, index) => ({
      seq: index + 1,
      t: 12.5 + index,
      type:
        index === 0 ? "virtual-keyboard-height-change" : "xterm-write-start",
      sessionId: "s-client",
      clientId: "c-client",
      durationMs: 3,
      dataLength: 12,
      cursorX: 4,
      cursorY: 5,
      viewportY: 2,
      baseY: 20,
      bufferType: "normal",
      renderStart: 10,
      renderEnd: 12,
      data: "secret terminal text",
      nested: { value: "should not pass schema filter" },
    }));
    const res = await app.request("/api/debug/terminal-trace/client", {
      method: "POST",
      body: JSON.stringify({ events }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      accepted: 200,
      dropped: 5,
    });
    const recorded = recorder.list();
    expect(recorded).toHaveLength(200);
    expect(recorded[0]).toMatchObject({
      type: "client-event",
      sessionId: "s-client",
      clientId: "c-client",
      payload: {
        seq: 1,
        type: "virtual-keyboard-height-change",
        durationMs: 3,
        dataLength: 12,
        cursorX: 4,
        cursorY: 5,
        viewportY: 2,
        baseY: 20,
        bufferType: "normal",
        renderStart: 10,
        renderEnd: 12,
      },
    });
    expect(JSON.stringify(recorded)).not.toContain("secret terminal text");
    expect(JSON.stringify(recorded)).not.toContain("should not pass");
  });

  it("deduplicates repeated client trace events", async () => {
    const { app, recorder } = makeApp();
    recorder.setEnabled(true);

    const event = {
      seq: 1,
      t: 12.5,
      type: "terminal-mount",
      sessionId: "s-client",
      dataLength: 12,
    };
    const res = await app.request("/api/debug/terminal-trace/client", {
      method: "POST",
      body: JSON.stringify({ events: [event, event] }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      accepted: 2,
      duplicates: 1,
    });
    expect(recorder.list()).toHaveLength(1);
    expect(recorder.list()[0]).toMatchObject({
      type: "client-event",
      sessionId: "s-client",
      payload: {
        seq: 1,
        type: "terminal-mount",
      },
    });
  });

  it("does not record one-shot client diagnostics while trace is disabled", async () => {
    const { app, recorder } = makeApp();
    expect(recorder.isEnabled()).toBe(false);

    const res = await app.request(
      "/api/debug/terminal-trace/client-diagnostic",
      {
        method: "POST",
        body: JSON.stringify({
          diagnostic: "terminal-input-background",
          reason: "disabled",
          sessionId: "s-disabled",
          events: [{ seq: 1, type: "terminal-resize-apply" }],
          bottomRows: {
            rowsSampled: [{ line: 0, text: "visible terminal text" }],
          },
        }),
        headers: { "content-type": "application/json" },
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      accepted: 0,
      recorded: false,
      diagnosticEventCount: 1,
      hasBottomRows: true,
      enabled: false,
      eventCount: 0,
    });
    expect(recorder.list()).toEqual([]);
  });

  it("records one-shot client diagnostics while trace is enabled", async () => {
    const { app, recorder } = makeApp();
    recorder.setEnabled(true);

    const rowsSampled = Array.from({ length: 25 }, (_, row) => ({
      line: row,
      viewportRow: row,
      isWrapped: false,
      text: row === 0 ? "composer secret visible text" : "status",
      attrRuns: Array.from({ length: 130 }, (_, run) => ({
        start: run,
        end: run + 1,
        attrs: {
          fgMode: 0,
          fg: -1,
          bgMode: 33_554_432,
          bg: 240,
          bold: false,
        },
      })),
    }));
    const events = Array.from({ length: 90 }, (_, seq) => ({
      seq,
      type: "terminal-resize-apply",
      sessionId: "s-diag",
      clientId: "c-diag",
      rows: 24,
      data: "secret raw terminal payload should be dropped",
    }));

    const res = await app.request(
      "/api/debug/terminal-trace/client-diagnostic",
      {
        method: "POST",
        body: JSON.stringify({
          diagnostic: "terminal-input-background",
          reason: "gray background missing",
          sessionId: "s-diag",
          clientId: "c-diag",
          source: {
            status: "selected",
            requested: {
              sessionId: "s-diag",
              paneId: "pane-diag",
              unknownRequestedField: "drop me",
            },
            selected: {
              sessionId: "s-diag",
              paneId: "pane-diag",
              unknownSelectedField: "drop me",
            },
            unknownSourceField: "drop me",
          },
          events,
          bottomRows: {
            cols: 80,
            rows: 24,
            cursorX: 2,
            cursorY: 20,
            viewportY: 100,
            baseY: 120,
            bufferType: "normal",
            rowCount: 25,
            renderer: {
              requestedWebgl: true,
              effectiveRenderer: "webgl",
              webglStatus: "attached",
              webglFailureReason: "should preserve bounded strings",
              contextLossCount: 0,
              fontLoadingDoneCount: 2,
              atlasRebuildCount: 2,
              iosFontPrefetchStatus: "not-ios",
              unicodeVersion: "11",
              isTouch: false,
              isIos: false,
              fontFamily:
                "SF Mono, ui-monospace, Menlo, Consolas, Symbols Nerd Font",
              fontSize: 13,
              unknownRendererField: "drop me",
            },
            rowsSampled,
          },
        }),
        headers: { "content-type": "application/json" },
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      accepted: 1,
      recorded: true,
      diagnosticEventCount: 80,
      droppedDiagnosticEvents: 10,
      hasBottomRows: true,
      enabled: true,
    });
    expect(recorder.isEnabled()).toBe(true);
    expect(recorder.list()).toHaveLength(1);
    expect(recorder.list()[0]).toMatchObject({
      type: "client-diagnostic",
      sessionId: "s-diag",
      clientId: "c-diag",
      payload: {
        diagnostic: "terminal-input-background",
        reason: "gray background missing",
        eventCount: 80,
        droppedEvents: 10,
        source: {
          status: "selected",
          requested: { sessionId: "s-diag", paneId: "pane-diag" },
          selected: { sessionId: "s-diag", paneId: "pane-diag" },
        },
        bottomRows: {
          cols: 80,
          rows: 24,
        },
      },
    });
    const payload = recorder.list()[0]?.payload;
    expect(JSON.stringify(payload?.source)).not.toContain("unknown");
    const bottomRows = payload?.bottomRows as
      | {
          renderer?: Record<string, unknown>;
          rowsSampled?: Array<{ attrRuns?: unknown[] }>;
        }
      | undefined;
    expect(bottomRows?.renderer).toMatchObject({
      requestedWebgl: true,
      effectiveRenderer: "webgl",
      webglStatus: "attached",
      contextLossCount: 0,
      fontLoadingDoneCount: 2,
      atlasRebuildCount: 2,
      iosFontPrefetchStatus: "not-ios",
      unicodeVersion: "11",
      isTouch: false,
      isIos: false,
      fontFamily: "SF Mono, ui-monospace, Menlo, Consolas, Symbols Nerd Font",
      fontSize: 13,
    });
    expect(bottomRows?.renderer).not.toHaveProperty("unknownRendererField");
    expect(bottomRows?.rowsSampled).toHaveLength(20);
    expect(bottomRows?.rowsSampled?.[0]).toMatchObject({
      line: 0,
      text: "composer secret visible text",
    });
    expect(bottomRows?.rowsSampled?.[0]?.attrRuns).toHaveLength(20);
    expect(bottomRows?.rowsSampled?.[0]?.attrRuns?.[0]).toMatchObject({
      start: 0,
      end: 1,
      attrs: expect.objectContaining({ bg: 240, bold: false }),
    });
    expect(JSON.stringify(recorder.list())).not.toContain(
      "secret raw terminal payload should be dropped",
    );
  });

  it("clears client trace dedupe state when trace is cleared", async () => {
    const { app, recorder } = makeApp();
    recorder.setEnabled(true);

    const event = {
      seq: 1,
      t: 12.5,
      type: "terminal-mount",
      sessionId: "s-client",
    };
    await app.request("/api/debug/terminal-trace/client", {
      method: "POST",
      body: JSON.stringify({ events: [event] }),
      headers: { "content-type": "application/json" },
    });
    await app.request("/api/debug/terminal-trace", { method: "DELETE" });
    await app.request("/api/debug/terminal-trace/client", {
      method: "POST",
      body: JSON.stringify({ events: [event] }),
      headers: { "content-type": "application/json" },
    });

    expect(recorder.list()).toHaveLength(1);
  });

  it("runs a direct PTY latency probe without returning terminal text", async () => {
    const { app, project, ptyManager } = makeApp();

    const res = await app.request("/api/debug/terminal-trace/probe", {
      method: "POST",
      body: JSON.stringify({ projectId: project.id, timeoutMs: 1000 }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      projectId: project.id,
      mode: "server-terminal-relay",
      timedOut: false,
    });
    expect(body.timings.createMs).toEqual(expect.any(Number));
    expect(body.timings.inputToMarkerMs).toEqual(expect.any(Number));
    expect(JSON.stringify(body)).not.toContain("__parasor_latency_probe_");
    expect(ptyManager.disposed).toEqual([body.sessionId]);
  });
});

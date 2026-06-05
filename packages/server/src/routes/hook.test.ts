import type { Session } from "@parasor/shared";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDetector } from "../agent-detector/detector.js";
import type { PtyHost } from "../pty/host.js";
import { createHookRoute } from "./hook.js";

interface Mocks {
  ptyManager: PtyHost;
  agentDetector: AgentDetector;
  setExternalState: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  remoteAddress: string;
}

function makeMocks(remoteAddress = "127.0.0.1"): Mocks {
  const get = vi.fn((id: string): Session | undefined => {
    if (id === "valid-session") {
      return { id, projectId: "p1", state: "running" } as unknown as Session;
    }
    return undefined;
  });
  const setExternalState = vi.fn();
  return {
    ptyManager: { get } as unknown as PtyHost,
    agentDetector: { setExternalState } as unknown as AgentDetector,
    setExternalState,
    get,
    remoteAddress,
  };
}

function createApp(mocks: Mocks): Hono {
  const app = new Hono();
  app.route(
    "/hook",
    createHookRoute({
      ptyManager: mocks.ptyManager,
      agentDetector: mocks.agentDetector,
      remoteAddress: () => mocks.remoteAddress,
    }),
  );
  return app;
}

async function postNotify(app: Hono, body: unknown): Promise<Response> {
  return await app.request("/hook/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("hook route -- auth / loopback", () => {
  it("rejects requests from non-loopback IPs with 403", async () => {
    const mocks = makeMocks("192.168.1.42");
    const app = createApp(mocks);
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(403);
    expect(mocks.setExternalState).not.toHaveBeenCalled();
  });

  it("rejects when the remote address is missing entirely", async () => {
    const mocks = makeMocks("");
    const app = createApp(mocks);
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(403);
  });

  it("accepts IPv6 loopback ::1", async () => {
    const mocks = makeMocks("::1");
    const app = createApp(mocks);
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(200);
  });

  it("accepts IPv4-mapped IPv6 loopback ::ffff:127.0.0.1", async () => {
    const mocks = makeMocks("::ffff:127.0.0.1");
    const app = createApp(mocks);
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(200);
  });
});

describe("hook route -- input validation", () => {
  let mocks: Mocks;
  let app: Hono;

  beforeEach(() => {
    mocks = makeMocks();
    app = createApp(mocks);
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await app.request("/hook/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 413 when the declared payload exceeds the 64 KB cap", async () => {
    const res = await app.request("/hook/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(128 * 1024),
      },
      body: "{}",
    });
    expect(res.status).toBe(413);
  });

  it("returns 400 when sessionId is missing", async () => {
    const res = await postNotify(app, { agent: "claude", event: "Stop" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when sessionId is not a string", async () => {
    const res = await postNotify(app, {
      sessionId: 42,
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when agent is unknown", async () => {
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "cursor",
      event: "Stop",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when event is missing", async () => {
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown event of a known agent", async () => {
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "ToolExploded",
    });
    expect(res.status).toBe(400);
  });
});

describe("hook route -- session lookup + dispatch", () => {
  let mocks: Mocks;
  let app: Hono;

  beforeEach(() => {
    mocks = makeMocks();
    app = createApp(mocks);
  });

  it("returns 404 when the session does not exist", async () => {
    const res = await postNotify(app, {
      sessionId: "ghost",
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(404);
    expect(mocks.setExternalState).not.toHaveBeenCalled();
  });

  it("forwards a valid claude Stop to setExternalState as completed", async () => {
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      applied: boolean;
      lifecycle: string;
      source: string;
      confidence: string;
    };
    expect(data.applied).toBe(true);
    expect(data.lifecycle).toBe("completed");
    expect(mocks.setExternalState).toHaveBeenCalledWith("valid-session", {
      lifecycle: "completed",
      source: "hook",
      confidence: "high",
    });
  });

  it("forwards a valid codex agent_turn_complete to setExternalState as completed", async () => {
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "codex",
      event: "agent_turn_complete",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      applied: boolean;
      lifecycle: string;
    };
    expect(data.applied).toBe(true);
    expect(data.lifecycle).toBe("completed");
    expect(mocks.setExternalState).toHaveBeenCalledWith("valid-session", {
      lifecycle: "completed",
      source: "hook",
      confidence: "high",
    });
  });

  it("records hook debug breadcrumbs for a valid session", async () => {
    const res = await app.request("/hook/debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "valid-session",
        label: "claude-wrapper-exec",
        detail: "--resume",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("treats Claude SessionStart as a noop and does not call setExternalState", async () => {
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "SessionStart",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; applied: boolean };
    expect(data.applied).toBe(false);
    expect(mocks.setExternalState).not.toHaveBeenCalled();
  });
});

describe("hook route -- rate limit", () => {
  it("returns 429 after exceeding 100 requests in a 1s window", async () => {
    const mocks = makeMocks();
    const app = createApp(mocks);
    const body = JSON.stringify({
      sessionId: "valid-session",
      agent: "claude",
      event: "Stop",
    });
    let last: Response | undefined;
    for (let i = 0; i < 105; i++) {
      last = await app.request("/hook/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    }
    // First 100 should be 200, the 101st onwards should be 429.
    expect(last?.status).toBe(429);
  });

  it("resets the bucket after the 1s window expires", async () => {
    vi.useFakeTimers();
    try {
      const mocks = makeMocks();
      const app = createApp(mocks);
      const body = JSON.stringify({
        sessionId: "valid-session",
        agent: "claude",
        event: "Stop",
      });
      // Fire 100 to fill the bucket; the 101st must 429.
      for (let i = 0; i < 100; i++) {
        await app.request("/hook/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      }
      const blocked = await app.request("/hook/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(blocked.status).toBe(429);

      // Advance past the window -- the next request is allowed again.
      vi.advanceTimersByTime(1100);
      const reopened = await app.request("/hook/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(reopened.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("hook route -- IPv6 hex loopback", () => {
  it("accepts ::ffff:7f00:0001 (IPv4-mapped IPv6 hex form)", async () => {
    const mocks = makeMocks("::ffff:7f00:0001");
    const app = createApp(mocks);
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(200);
  });

  it("accepts 127.0.0.2 (anywhere in 127.0.0.0/8)", async () => {
    const mocks = makeMocks("127.0.0.2");
    const app = createApp(mocks);
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(200);
  });

  it("rejects ::ffff:8.8.8.8 (IPv4-mapped non-loopback)", async () => {
    const mocks = makeMocks("::ffff:8.8.8.8");
    const app = createApp(mocks);
    const res = await postNotify(app, {
      sessionId: "valid-session",
      agent: "claude",
      event: "Stop",
    });
    expect(res.status).toBe(403);
  });
});

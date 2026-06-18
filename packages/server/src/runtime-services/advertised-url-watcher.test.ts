import type { RuntimeServiceInfo } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import {
  normalizeAdvertisedUrl,
  RuntimeServiceAdvertisedUrlWatcher,
  stripTerminalControls,
} from "./advertised-url-watcher.js";

function service(
  overrides: Partial<RuntimeServiceInfo> = {},
): RuntimeServiceInfo {
  return {
    id: "svc",
    kind: "workspace",
    port: 5173,
    pid: 100,
    processName: "vite",
    bindHost: "127.0.0.1",
    connectHost: "127.0.0.1",
    bindsAll: false,
    protocol: "http",
    serviceName: "vite",
    attribution: {
      source: "session-process-tree",
      confidence: "high",
      projectId: "p1",
      worktreePath: "/repo",
      sessionId: "s1",
    },
    reachable: true,
    reachablePort: 49231,
    lifecycle: "reachable",
    firstSeenAt: 1,
    lastSeenAt: 1,
    source: "scanner+forwarder",
    ...overrides,
  };
}

describe("RuntimeServiceAdvertisedUrlWatcher", () => {
  it("extracts URLs split across chunks and stores origin only", () => {
    const watcher = new RuntimeServiceAdvertisedUrlWatcher();
    watcher.feed("s1", "Local: http://local", {
      projectId: "p1",
      worktreePath: "/repo",
    });
    watcher.feed("s1", "host:5173/path?token=secret#hash", {
      projectId: "p1",
      worktreePath: "/repo",
    });

    expect(watcher.applyToService(service()).advertisedUrl).toMatchObject({
      origin: "http://localhost:5173",
      host: "localhost",
      hostKind: "loopback",
      sourceSessionId: "s1",
      validatedListenerPid: 100,
    });
  });

  it("strips terminal controls before scanning", () => {
    expect(
      stripTerminalControls("\u001b[32mhttp://localhost:5173\u001b[0m"),
    ).toBe("http://localhost:5173");
    expect(
      stripTerminalControls(
        "\u001b]8;;http://secret/path\u0007label\u001b]8;;\u0007",
      ),
    ).toBe("label");
  });

  it("rejects wildcard hosts and userinfo", () => {
    expect(normalizeAdvertisedUrl("http://0.0.0.0:5173", "s1", 1)).toBeNull();
    expect(normalizeAdvertisedUrl("http://*:5173", "s1", 1)).toBeNull();
    expect(
      normalizeAdvertisedUrl("http://user:pass@localhost:5173", "s1", 1),
    ).toBeNull();
  });

  it("validates by worktree and port", () => {
    const watcher = new RuntimeServiceAdvertisedUrlWatcher();
    watcher.feed(
      "s1",
      "http://localhost:5173",
      { projectId: "p1", worktreePath: "/repo" },
      1,
    );

    expect(
      watcher.applyToService(
        service({
          port: 3000,
        }),
      ).advertisedUrl,
    ).toBeUndefined();
    expect(
      watcher.applyToService(
        service({
          attribution: {
            source: "session-process-tree",
            confidence: "high",
            projectId: "p1",
            worktreePath: "/other",
            sessionId: "s1",
          },
        }),
      ).advertisedUrl,
    ).toBeUndefined();
  });

  it("evicts on listener disappearance and PID change", () => {
    const watcher = new RuntimeServiceAdvertisedUrlWatcher();
    watcher.feed(
      "s1",
      "http://localhost:5173",
      {
        projectId: "p1",
        worktreePath: "/repo",
      },
      1,
    );
    expect(watcher.applyToService(service()).advertisedUrl).toBeDefined();

    expect(
      watcher.applyToService(service({ pid: 101 })).advertisedUrl,
    ).toBeUndefined();

    const disappearedWatcher = new RuntimeServiceAdvertisedUrlWatcher();
    disappearedWatcher.feed(
      "s1",
      "http://localhost:5173",
      {
        projectId: "p1",
        worktreePath: "/repo",
      },
      2,
    );
    expect(
      disappearedWatcher.applyToService(service()).advertisedUrl,
    ).toBeDefined();
    disappearedWatcher.reconcile([], 2);
    expect(
      disappearedWatcher.applyToService(service()).advertisedUrl,
    ).toBeUndefined();
  });

  it("keeps pending URLs briefly when terminal output beats port scanning", () => {
    const watcher = new RuntimeServiceAdvertisedUrlWatcher({
      pendingRetentionMs: 100,
    });
    watcher.feed(
      "s1",
      "http://localhost:5173",
      { projectId: "p1", worktreePath: "/repo" },
      1,
    );

    watcher.reconcile([], 50);
    expect(watcher.applyToService(service()).advertisedUrl).toMatchObject({
      origin: "http://localhost:5173",
    });

    watcher.feed(
      "s1",
      "http://localhost:5173",
      { projectId: "p1", worktreePath: "/repo" },
      1,
    );
    watcher.reconcile([], 150);
    expect(watcher.applyToService(service()).advertisedUrl).toBeUndefined();
  });

  it("prefers custom DNS, then HTTPS when host quality ties", () => {
    const watcher = new RuntimeServiceAdvertisedUrlWatcher();
    watcher.feed(
      "s1",
      "http://192.168.1.20:5173 http://localhost:5173 https://app.test:5173",
      { projectId: "p1", worktreePath: "/repo" },
      1,
    );

    expect(watcher.applyToService(service()).advertisedUrl).toMatchObject({
      origin: "https://app.test:5173",
      hostKind: "custom",
      protocol: "https",
    });
  });
});

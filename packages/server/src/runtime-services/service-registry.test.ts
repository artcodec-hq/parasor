import { describe, expect, it, vi } from "vitest";
import type { PortForwarder } from "../port-forwarder/forwarder.js";
import type { ScannedPortInfo } from "../port-scanner/scanner.js";
import { RuntimeServiceAdvertisedUrlWatcher } from "./advertised-url-watcher.js";
import {
  projectServicesToPorts,
  RuntimeServiceRegistry,
} from "./service-registry.js";

function forwarder(opts?: {
  inert?: boolean;
  reachablePort?: number | null;
}): PortForwarder {
  return {
    isInert: () => opts?.inert === true,
    getReachablePort: () => opts?.reachablePort ?? null,
    setOnChange: vi.fn(),
    sync: vi.fn(),
    stop: vi.fn(),
  } as unknown as PortForwarder;
}

function port(overrides: Partial<ScannedPortInfo> = {}): ScannedPortInfo {
  return {
    port: 5173,
    pid: 100,
    bindHost: "127.0.0.1",
    bindsAll: false,
    processName: "vite",
    sessionId: "s1",
    sessionCwd: "/repo",
    ...overrides,
  };
}

describe("RuntimeServiceRegistry", () => {
  it("builds workspace service rows with session attribution", () => {
    const registry = new RuntimeServiceRegistry();
    const services = registry.syncProject({
      projectId: "p1",
      projectPath: "/repo",
      worktreePaths: ["/repo"],
      ports: [port()],
      forwarder: forwarder({ reachablePort: 49231 }),
      now: 1000,
    });

    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      kind: "workspace",
      port: 5173,
      pid: 100,
      processName: "vite",
      serviceName: "vite",
      bindHost: "127.0.0.1",
      connectHost: "127.0.0.1",
      protocol: "http",
      reachable: true,
      reachablePort: 49231,
      lifecycle: "reachable",
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      source: "scanner+forwarder",
      attribution: {
        source: "session-process-tree",
        confidence: "high",
        projectId: "p1",
        worktreePath: "/repo",
        sessionId: "s1",
      },
    });
  });

  it("projects live services back to the legacy PortInfo shape", () => {
    const registry = new RuntimeServiceRegistry();
    const services = registry.syncProject({
      projectId: "p1",
      projectPath: "/repo",
      worktreePaths: ["/repo"],
      ports: [port()],
      forwarder: forwarder({ reachablePort: 49231 }),
      now: 1000,
    });

    expect(projectServicesToPorts(services)).toEqual([
      {
        port: 5173,
        pid: 100,
        bindsAll: false,
        reachable: true,
        reachablePort: 49231,
      },
    ]);
  });

  it("attaches validated advertised URLs to matching workspace services only", () => {
    const watcher = new RuntimeServiceAdvertisedUrlWatcher();
    watcher.feed("s1", "ready at http://localhost:5173/path?secret=1", {
      projectId: "p1",
      worktreePath: "/repo",
    });
    const registry = new RuntimeServiceRegistry({
      advertisedUrlWatcher: watcher,
    });
    const services = registry.syncProject({
      projectId: "p1",
      projectPath: "/repo",
      worktreePaths: ["/repo"],
      ports: [port()],
      forwarder: forwarder(),
      now: 1000,
    });

    expect(services[0].advertisedUrl).toMatchObject({
      origin: "http://localhost:5173",
      validatedListenerPid: 100,
    });
    expect(projectServicesToPorts(services)).toEqual([
      {
        port: 5173,
        pid: 100,
        bindsAll: false,
        reachable: false,
      },
    ]);

    const external = registry.syncProject({
      projectId: "p1",
      projectPath: "/repo",
      worktreePaths: ["/repo"],
      ports: [
        port({
          sessionId: undefined,
          sessionCwd: undefined,
          cwd: "/tmp",
          commandLine: undefined,
        }),
      ],
      forwarder: forwarder(),
      now: 1100,
    });
    const externalService = external.find(
      (service) => service.kind === "external",
    );
    expect(externalService?.advertisedUrl).toBeUndefined();
  });

  it("retains disappeared services for a bounded window", () => {
    const registry = new RuntimeServiceRegistry({
      disappearedRetentionMs: 100,
    });
    registry.syncProject({
      projectId: "p1",
      projectPath: "/repo",
      worktreePaths: ["/repo"],
      ports: [port()],
      forwarder: forwarder(),
      now: 1000,
    });

    const disappeared = registry.syncProject({
      projectId: "p1",
      projectPath: "/repo",
      worktreePaths: ["/repo"],
      ports: [],
      forwarder: forwarder(),
      now: 1050,
    });
    expect(disappeared[0]).toMatchObject({
      lifecycle: "disappeared",
      disappearedAt: 1050,
      reachable: false,
    });
    expect(projectServicesToPorts(disappeared)).toEqual([]);

    const expired = registry.syncProject({
      projectId: "p1",
      projectPath: "/repo",
      worktreePaths: ["/repo"],
      ports: [],
      forwarder: forwarder(),
      now: 1200,
    });
    expect(expired).toEqual([]);
  });
});

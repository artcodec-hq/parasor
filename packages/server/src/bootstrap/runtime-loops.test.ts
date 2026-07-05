import type {
  Notification,
  PortDetectionMode,
  PortInfo,
  Worktree,
} from "@parasor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortForwarder } from "../port-forwarder/forwarder.js";
import type { ScannedPortInfo } from "../port-scanner/scanner.js";
import { RuntimeServiceAdvertisedUrlWatcher } from "../runtime-services/advertised-url-watcher.js";
import { RuntimeServiceRegistry } from "../runtime-services/service-registry.js";
import {
  broadcastForegroundTitles,
  startRuntimeLoops,
} from "./runtime-loops.js";

describe("broadcastForegroundTitles", () => {
  it("broadcasts only changed titles for running sessions", () => {
    const eventBus = {
      broadcast: vi.fn(),
    };

    const ptyManager = {
      list: () => [
        { id: "running-changed", state: "running", title: "bash" },
        { id: "running-same", state: "running", title: "node" },
        {
          id: "running-manual",
          state: "running",
          title: "Build logs",
          titleManual: true,
        },
        { id: "ended", state: "ended", title: "zsh" },
      ],
      getForegroundProcess: (sessionId: string) => {
        if (sessionId === "running-changed") return "node";
        if (sessionId === "running-same") return "node";
        if (sessionId === "running-manual") return "python";
        return "python";
      },
      setTitle: (sessionId: string) => sessionId === "running-changed",
    };

    broadcastForegroundTitles(ptyManager as never, eventBus as never);

    expect(eventBus.broadcast).toHaveBeenCalledTimes(1);
    expect(eventBus.broadcast).toHaveBeenCalledWith({
      type: "session-title-changed",
      sessionId: "running-changed",
      title: "node",
      titleManual: false,
    });
  });
});

interface FakeForwarder {
  forwarder: PortForwarder;
  sync: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  /** projectId -> devPort -> OS-assigned listen port */
  reachable: Map<string, Map<number, number>>;
  /** Set a reachable port without firing the change listener. */
  setReachablePort: (
    projectId: string,
    devPort: number,
    listenPort: number,
  ) => void;
  /**
   * Simulate the forwarder's async bind finishing: record the listen port
   * AND invoke the registered change listener (as the real `"listening"`
   * handler does).
   */
  completeBind: (
    projectId: string,
    devPort: number,
    listenPort: number,
  ) => void;
}

function makeFakeForwarder(opts?: { inert?: boolean }): FakeForwarder {
  const reachable = new Map<string, Map<number, number>>();
  const sync = vi.fn();
  const stop = vi.fn();
  let onChange: ((projectId: string) => void) | null = null;
  const setReachablePort = (
    projectId: string,
    devPort: number,
    listenPort: number,
  ) => {
    const m = reachable.get(projectId) ?? new Map<number, number>();
    m.set(devPort, listenPort);
    reachable.set(projectId, m);
  };
  const completeBind = (
    projectId: string,
    devPort: number,
    listenPort: number,
  ) => {
    setReachablePort(projectId, devPort, listenPort);
    onChange?.(projectId);
  };
  const forwarder = {
    sync,
    stop,
    isInert: () => opts?.inert === true,
    setOnChange: (cb: (projectId: string) => void) => {
      onChange = cb;
    },
    getReachablePort: (projectId: string, devPort: number) =>
      reachable.get(projectId)?.get(devPort) ?? null,
    getForwarderState: (projectId: string, devPort: number) => {
      const listenPort = reachable.get(projectId)?.get(devPort);
      return listenPort === undefined
        ? { status: "pending" }
        : { status: "reachable", reachablePort: listenPort };
    },
  } as unknown as PortForwarder;
  return {
    forwarder,
    sync,
    stop,
    reachable,
    setReachablePort,
    completeBind,
  };
}

describe("startRuntimeLoops port-detected notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(
    mode: PortDetectionMode,
    opts?: {
      inert?: boolean;
      advertisedUrlWatcher?: RuntimeServiceAdvertisedUrlWatcher;
      serviceRegistry?: RuntimeServiceRegistry;
      worktrees?: Worktree[];
    },
  ) {
    const handlerRef: {
      current: ((projectId: string, ports: ScannedPortInfo[]) => void) | null;
    } = { current: null };
    const portScanner = {
      onPortsChanged: (
        cb: (projectId: string, ports: ScannedPortInfo[]) => void,
      ) => {
        handlerRef.current = cb;
      },
      start: vi.fn(),
      stop: vi.fn(),
    };
    const broadcast = vi.fn();
    const addNotification = vi.fn();
    const eventBus = { broadcast, addNotification };
    const appStateStore = {
      get: () => ({
        projects: [{ id: "p1", name: "demo", path: "/repo" }],
        projectStates: {},
        serviceConfig: { portDetection: mode, preventIdleSleep: false },
      }),
    };
    const ptyManager = { list: () => [] };
    const projectRuntime = { pollGitChanges: vi.fn() };
    const worktreeCache = {
      get: () => ({ p1: opts?.worktrees ?? [] }),
    };

    const uploadStaging = {
      sweepStale: vi.fn().mockResolvedValue({ swept: [] }),
    };
    const fake = makeFakeForwarder(opts);
    const loops = startRuntimeLoops({
      appStateStore: appStateStore as never,
      eventBus: eventBus as never,
      portScanner: portScanner as never,
      ptyManager: ptyManager as never,
      projectRuntime: projectRuntime as never,
      uploadStaging: uploadStaging as never,
      worktreeCache: worktreeCache as never,
      portForwarder: fake.forwarder,
      ...(opts?.serviceRegistry
        ? { serviceRegistry: opts.serviceRegistry }
        : {}),
      ...(opts?.advertisedUrlWatcher
        ? { advertisedUrlWatcher: opts.advertisedUrlWatcher }
        : {}),
    });

    const trigger = (
      projectId: string,
      ports: Array<PortInfo & Partial<ScannedPortInfo>>,
    ) => {
      if (!handlerRef.current) throw new Error("handler not registered");
      handlerRef.current(
        projectId,
        ports.map((port) => ({
          bindHost: port.bindsAll ? "0.0.0.0" : "127.0.0.1",
          ...port,
        })),
      );
    };
    return { trigger, broadcast, addNotification, fake, loops };
  }

  it("emits notification only for newly added ports in all-interfaces mode when bindsAll=true", () => {
    const { trigger, broadcast, addNotification } = setup("all-interfaces");

    trigger("p1", [{ port: 5173, pid: 1, bindsAll: true }]);

    expect(addNotification).toHaveBeenCalledTimes(1);
    const n = addNotification.mock.calls[0][0] as Notification;
    expect(n.type).toBe("port-detected");
    expect(n.port).toBe(5173);
    expect(n.bindsAll).toBe(true);
    expect(n.reachable).toBe(true);
    expect(n.projectId).toBe("p1");
    expect(broadcast).toHaveBeenCalledWith({
      type: "ports-updated",
      projectId: "p1",
      ports: [{ port: 5173, pid: 1, bindsAll: true, reachable: true }],
    });
    expect(broadcast).toHaveBeenCalledWith({
      type: "notification",
      notification: n,
    });
  });

  it("filters out loopback-only ports with no forwarder in all-interfaces mode", () => {
    const { trigger, addNotification, broadcast } = setup("all-interfaces");
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: false }]);
    expect(addNotification).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith({
      type: "ports-updated",
      projectId: "p1",
      ports: [{ port: 5173, pid: 1, bindsAll: false, reachable: false }],
    });
  });

  it("notifies a loopback port fronted by a forwarder and carries reachablePort on broadcast + notification", () => {
    const { trigger, addNotification, broadcast, fake } =
      setup("all-interfaces");
    fake.setReachablePort("p1", 5173, 49231);
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: false }]);

    expect(fake.sync).toHaveBeenCalledWith("p1", [
      { port: 5173, pid: 1, bindsAll: false, bindHost: "127.0.0.1" },
    ]);
    expect(broadcast).toHaveBeenCalledWith({
      type: "ports-updated",
      projectId: "p1",
      ports: [
        {
          port: 5173,
          pid: 1,
          bindsAll: false,
          reachable: true,
          reachablePort: 49231,
        },
      ],
    });
    expect(addNotification).toHaveBeenCalledTimes(1);
    const n = addNotification.mock.calls[0][0] as Notification;
    expect(n.reachable).toBe(true);
    expect(n.reachablePort).toBe(49231);
  });

  it("treats every port as reachable when parasor is loopback-bound (inert forwarder)", () => {
    const { trigger, addNotification, broadcast } = setup("all-interfaces", {
      inert: true,
    });
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: false }]);
    expect(broadcast).toHaveBeenCalledWith({
      type: "ports-updated",
      projectId: "p1",
      ports: [{ port: 5173, pid: 1, bindsAll: false, reachable: true }],
    });
    expect(addNotification).toHaveBeenCalledTimes(1);
    expect((addNotification.mock.calls[0][0] as Notification).reachable).toBe(
      true,
    );
  });

  it("re-emits services when a scoped advertised URL is captured", () => {
    const watcher = new RuntimeServiceAdvertisedUrlWatcher();
    const registry = new RuntimeServiceRegistry({
      advertisedUrlWatcher: watcher,
    });
    const { trigger, broadcast } = setup("all-interfaces", {
      advertisedUrlWatcher: watcher,
      serviceRegistry: registry,
    });
    trigger("p1", [
      {
        port: 5173,
        pid: 1,
        bindHost: "127.0.0.1",
        bindsAll: false,
        sessionId: "s1",
        sessionCwd: "/repo",
      },
    ]);
    broadcast.mockClear();

    watcher.feed("s1", "http://localhost:5173", {
      projectId: "p1",
      worktreePath: "/repo",
    });

    expect(broadcast).toHaveBeenCalledWith({
      type: "services-updated",
      projectId: "p1",
      services: [
        expect.objectContaining({
          advertisedUrl: expect.objectContaining({
            origin: "http://localhost:5173",
          }),
        }),
      ],
    });
  });

  it("attributes session-owned ports to linked worktrees from the runtime cache", () => {
    const { trigger, broadcast } = setup("all-interfaces", {
      worktrees: [
        {
          path: "/repo.worktrees/feature",
          head: "abc123",
          branch: "feature",
        },
      ],
    });

    trigger("p1", [
      {
        port: 7764,
        pid: 100,
        bindHost: "127.0.0.1",
        bindsAll: false,
        sessionId: "s1",
        sessionCwd: "/repo.worktrees/feature/packages/app",
      },
    ]);

    expect(broadcast).toHaveBeenCalledWith({
      type: "services-updated",
      projectId: "p1",
      services: [
        expect.objectContaining({
          kind: "workspace",
          port: 7764,
          attribution: expect.objectContaining({
            source: "session-process-tree",
            sessionId: "s1",
            worktreePath: "/repo.worktrees/feature",
          }),
        }),
      ],
    });
  });

  it("does not start a forwarder in 'off' mode", () => {
    const { trigger, addNotification, broadcast, fake } = setup("off");
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: true }]);
    expect(addNotification).not.toHaveBeenCalled();
    expect(fake.sync).toHaveBeenCalledWith("p1", []);
    expect(broadcast).toHaveBeenCalledWith({
      type: "ports-updated",
      projectId: "p1",
      ports: [{ port: 5173, pid: 1, bindsAll: true, reachable: true }],
    });
  });

  it("does not re-emit for ports seen in the previous tick", () => {
    const { trigger, addNotification } = setup("all-interfaces");
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: true }]);
    trigger("p1", [
      { port: 5173, pid: 1, bindsAll: true },
      { port: 3000, pid: 2, bindsAll: true },
    ]);
    expect(addNotification).toHaveBeenCalledTimes(2);
    const ports = addNotification.mock.calls.map(
      ([n]) => (n as Notification).port,
    );
    expect(ports).toEqual([5173, 3000]);
  });

  it("skips unknown projects (no name available)", () => {
    const { trigger, addNotification } = setup("all-interfaces");
    trigger("unknown", [{ port: 5173, pid: 1, bindsAll: true }]);
    expect(addNotification).not.toHaveBeenCalled();
  });

  it("re-emits when a known port flips from loopback-only to public", () => {
    const { trigger, addNotification } = setup("all-interfaces");
    // First tick: loopback-only, no forwarder URL -> not reachable, not notified.
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: false }]);
    expect(addNotification).not.toHaveBeenCalled();
    // Second tick: same port, now bound to all interfaces -- becomes reachable.
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: true }]);
    expect(addNotification).toHaveBeenCalledTimes(1);
    const n = addNotification.mock.calls[0][0] as Notification;
    expect(n.port).toBe(5173);
    expect(n.bindsAll).toBe(true);
  });

  it("re-emits + notifies once the forwarder finishes its async bind for a loopback port", () => {
    const { trigger, addNotification, broadcast, fake } =
      setup("all-interfaces");
    // Tick: loopback-only port appears; forwarder.sync was called but the bind
    // has not completed -- getReachablePort is still null -> not reachable yet.
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: false }]);
    expect(fake.sync).toHaveBeenCalledWith("p1", [
      { port: 5173, pid: 1, bindsAll: false, bindHost: "127.0.0.1" },
    ]);
    expect(addNotification).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenLastCalledWith({
      type: "ports-updated",
      projectId: "p1",
      ports: [{ port: 5173, pid: 1, bindsAll: false, reachable: false }],
    });
    broadcast.mockClear();

    // The forwarder's `listen` resolves out-of-band -> it fires its change
    // listener; the runtime re-emits the (now reachable) port.
    fake.completeBind("p1", 5173, 49231);
    expect(broadcast).toHaveBeenCalledWith({
      type: "ports-updated",
      projectId: "p1",
      ports: [
        {
          port: 5173,
          pid: 1,
          bindsAll: false,
          reachable: true,
          reachablePort: 49231,
        },
      ],
    });
    expect(addNotification).toHaveBeenCalledTimes(1);
    const n = addNotification.mock.calls[0][0] as Notification;
    expect(n.port).toBe(5173);
    expect(n.reachable).toBe(true);
    expect(n.reachablePort).toBe(49231);
  });

  it("re-syncs forwarders when portDetection toggles off and back on", () => {
    const { trigger, fake, loops } = setup("all-interfaces");
    const ports = [{ port: 5173, pid: 1, bindsAll: false }];
    fake.setReachablePort("p1", 5173, 49231);
    trigger("p1", ports);
    fake.sync.mockClear();

    loops.onServiceConfigChanged({
      preventIdleSleep: false,
      portDetection: "off",
      dropSizeMaxBytes: 1,
      dropSizeHardMaxBytes: 1,
    });
    expect(fake.sync).toHaveBeenCalledWith("p1", []);
    fake.sync.mockClear();

    loops.onServiceConfigChanged({
      preventIdleSleep: false,
      portDetection: "all-interfaces",
      dropSizeMaxBytes: 1,
      dropSizeHardMaxBytes: 1,
    });
    expect(fake.sync).toHaveBeenCalledWith("p1", [
      { port: 5173, pid: 1, bindsAll: false, bindHost: "127.0.0.1" },
    ]);
  });

  it("does not re-emit when a public port flips back to loopback-only", () => {
    const { trigger, addNotification } = setup("all-interfaces");
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: true }]);
    expect(addNotification).toHaveBeenCalledTimes(1);
    trigger("p1", [{ port: 5173, pid: 1, bindsAll: false }]);
    expect(addNotification).toHaveBeenCalledTimes(1);
  });

  it("disposes the forwarder on stop()", () => {
    const { fake, loops } = setup("all-interfaces");
    loops.stop();
    expect(fake.stop).toHaveBeenCalled();
  });
});

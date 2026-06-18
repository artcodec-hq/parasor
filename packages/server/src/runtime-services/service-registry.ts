import type { PortInfo, RuntimeServiceInfo } from "@parasor/shared";
import type { PortForwarder } from "../port-forwarder/forwarder.js";
import type { ScannedPortInfo } from "../port-scanner/scanner.js";
import type { RuntimeServiceAdvertisedUrlWatcher } from "./advertised-url-watcher.js";
import {
  attributeRuntimeService,
  connectHostForBindHost,
  inferRuntimeServiceProtocol,
  type RuntimeServiceWorktreeProbe,
} from "./service-attribution.js";

const DEFAULT_DISAPPEARED_RETENTION_MS = 30_000;

export interface RuntimeServiceRegistryProjectInput {
  projectId: string;
  projectPath: string;
  worktreePaths: string[];
  ports: ScannedPortInfo[];
  forwarder: PortForwarder;
  now?: number;
}

export interface RuntimeServiceRegistryOptions {
  disappearedRetentionMs?: number;
  advertisedUrlWatcher?: RuntimeServiceAdvertisedUrlWatcher;
}

export class RuntimeServiceRegistry {
  private readonly byProject = new Map<string, RuntimeServiceInfo[]>();
  private readonly disappearedRetentionMs: number;
  private readonly advertisedUrlWatcher:
    | RuntimeServiceAdvertisedUrlWatcher
    | undefined;

  constructor(options: RuntimeServiceRegistryOptions = {}) {
    this.disappearedRetentionMs =
      options.disappearedRetentionMs ?? DEFAULT_DISAPPEARED_RETENTION_MS;
    this.advertisedUrlWatcher = options.advertisedUrlWatcher;
  }

  syncProject(input: RuntimeServiceRegistryProjectInput): RuntimeServiceInfo[] {
    const now = input.now ?? Date.now();
    const previous = this.byProject.get(input.projectId) ?? [];
    const previousById = new Map(
      previous.map((service) => [service.id, service]),
    );
    const live = input.ports.map((port) => {
      const service = this.buildService(
        input,
        port,
        previousById.get(serviceIdFor(input.projectId, port)),
        now,
      );
      return this.advertisedUrlWatcher?.applyToService(service) ?? service;
    });
    const liveIds = new Set(live.map((service) => service.id));
    const retained = previous.flatMap((service) => {
      if (liveIds.has(service.id)) return [];
      const disappearedAt = service.disappearedAt ?? now;
      if (now - disappearedAt > this.disappearedRetentionMs) return [];
      return [
        {
          ...service,
          reachable: false,
          lifecycle: "disappeared" as const,
          disappearedAt,
          lastSeenAt: service.lastSeenAt,
        },
      ];
    });
    const next = [...live, ...retained].sort(
      (a, b) =>
        a.port - b.port ||
        (a.processName ?? "").localeCompare(b.processName ?? ""),
    );
    if (next.length === 0) this.byProject.delete(input.projectId);
    else this.byProject.set(input.projectId, next);
    this.advertisedUrlWatcher?.reconcile(this.getLiveServices(), now);
    return next;
  }

  getProjectServices(projectId: string): RuntimeServiceInfo[] {
    return this.byProject.get(projectId) ?? [];
  }

  getAllServices(): Record<string, RuntimeServiceInfo[]> {
    const out: Record<string, RuntimeServiceInfo[]> = {};
    for (const [projectId, services] of this.byProject) {
      out[projectId] = services;
    }
    return out;
  }

  private getLiveServices(): RuntimeServiceInfo[] {
    return [...this.byProject.values()].flat();
  }

  private buildService(
    input: RuntimeServiceRegistryProjectInput,
    port: ScannedPortInfo,
    previous: RuntimeServiceInfo | undefined,
    now: number,
  ): RuntimeServiceInfo {
    const reachablePort = input.forwarder.getReachablePort(
      input.projectId,
      port.port,
    );
    const reachable =
      port.bindsAll || input.forwarder.isInert() || reachablePort !== null;
    const lifecycle = reachable ? "reachable" : "localhost-only";
    const attribution = attributeRuntimeService({
      projectId: input.projectId,
      sessionId: port.sessionId,
      sessionCwd: port.sessionCwd,
      processCwd: port.cwd,
      commandLine: port.commandLine,
      worktrees: worktreeProbes(input),
    });
    const kind = attribution.worktreePath ? "workspace" : "external";
    const protocol = inferRuntimeServiceProtocol(port.port);
    const bindHost = port.bindHost ?? (port.bindsAll ? "0.0.0.0" : "127.0.0.1");

    return {
      id: serviceIdFor(input.projectId, port),
      kind,
      port: port.port,
      pid: port.pid,
      ...(port.processName ? { processName: port.processName } : {}),
      ...(port.cwd ? { cwd: port.cwd } : {}),
      bindHost,
      connectHost: connectHostForBindHost(bindHost),
      bindsAll: port.bindsAll,
      protocol,
      serviceName: serviceNameFor(port.processName, port.port),
      attribution,
      reachable,
      ...(reachablePort !== null ? { reachablePort } : {}),
      lifecycle,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
      source: reachablePort !== null ? "scanner+forwarder" : "scanner",
    };
  }
}

export function projectServicesToPorts(
  services: RuntimeServiceInfo[],
): PortInfo[] {
  return services
    .filter(
      (service) => service.lifecycle !== "disappeared" && service.pid !== null,
    )
    .map((service) => ({
      port: service.port,
      pid: service.pid ?? 0,
      bindsAll: service.bindsAll,
      reachable: service.reachable,
      ...(service.reachablePort !== undefined
        ? { reachablePort: service.reachablePort }
        : {}),
    }));
}

function serviceIdFor(projectId: string, port: ScannedPortInfo): string {
  return `${projectId}:${port.sessionId ?? "-"}:${port.port}:${port.pid}`;
}

function worktreeProbes(
  input: RuntimeServiceRegistryProjectInput,
): RuntimeServiceWorktreeProbe[] {
  const paths = new Set(
    [input.projectPath, ...input.worktreePaths].filter(
      (worktreePath) => worktreePath.trim() !== "",
    ),
  );
  return Array.from(paths).map((worktreePath) => ({
    projectId: input.projectId,
    path: worktreePath,
  }));
}

function serviceNameFor(processName: string | undefined, port: number): string {
  if (!processName) return `Port ${port}`;
  const lower = processName.toLowerCase();
  if (
    [
      "vite",
      "next",
      "astro",
      "storybook",
      "hono",
      "node",
      "bun",
      "python",
    ].includes(lower)
  ) {
    return processName;
  }
  return processName;
}

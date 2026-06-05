import type { PortInfo } from "@parasor/shared";

export interface ReachablePortLookup {
  byProjectId: Map<string, Map<number, number>>;
  fallbackByDevPort: Map<number, number>;
  ambiguousDevPorts: Set<number>;
}

function isPort(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n < 65536;
}

export function buildReachablePortLookup(
  portsByProjectId: Record<string, PortInfo[]>,
): ReachablePortLookup {
  const byProjectId = new Map<string, Map<number, number>>();
  const fallbackByDevPort = new Map<number, number>();
  const ambiguousDevPorts = new Set<number>();

  for (const [projectId, ports] of Object.entries(portsByProjectId)) {
    const projectPorts = new Map<number, number>();
    for (const info of ports ?? []) {
      if (!isPort(info.port)) continue;
      if (isPort(info.reachablePort)) {
        projectPorts.set(info.port, info.reachablePort);
      } else if (info.bindsAll) {
        projectPorts.set(info.port, info.port);
      }
    }
    if (projectPorts.size === 0) continue;
    byProjectId.set(projectId, projectPorts);
    for (const [devPort, reachablePort] of projectPorts) {
      const existing = fallbackByDevPort.get(devPort);
      if (existing === undefined) {
        fallbackByDevPort.set(devPort, reachablePort);
      } else if (existing !== reachablePort) {
        ambiguousDevPorts.add(devPort);
      }
    }
  }

  return { ambiguousDevPorts, byProjectId, fallbackByDevPort };
}

export function findReachablePortForOpenUrl(
  lookup: ReachablePortLookup,
  devPort: number,
  options: { projectId?: string; activeProjectId?: string | null },
): number | undefined {
  if (options.projectId) {
    const projectPort = lookup.byProjectId.get(options.projectId)?.get(devPort);
    if (projectPort !== undefined) return projectPort;
  }
  if (options.activeProjectId) {
    const activeProjectPort = lookup.byProjectId
      .get(options.activeProjectId)
      ?.get(devPort);
    if (activeProjectPort !== undefined) return activeProjectPort;
  }
  if (lookup.ambiguousDevPorts.has(devPort)) return undefined;
  return lookup.fallbackByDevPort.get(devPort);
}

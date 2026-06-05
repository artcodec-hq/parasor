import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PortInfo, Session } from "@parasor/shared";

const execFileAsync = promisify(execFile);

export interface LsofEntry {
  pid: number;
  port: number;
  bindsAll: boolean;
}

export function parseLsofOutput(output: string): LsofEntry[] {
  const entries: LsofEntry[] = [];
  let currentPid: number | null = null;

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;

    if (line.startsWith("p")) {
      currentPid = parseInt(line.slice(1), 10);
    } else if (line.startsWith("n") && currentPid !== null) {
      const addr = line.slice(1);
      const colonIdx = addr.lastIndexOf(":");
      if (colonIdx === -1) continue;

      const host = addr.slice(0, colonIdx);
      const port = parseInt(addr.slice(colonIdx + 1), 10);
      if (Number.isNaN(port)) continue;

      const bindsAll =
        host === "*" || host === "0.0.0.0" || host === "[::]" || host === "";
      entries.push({ pid: currentPid, port, bindsAll });
    }
  }

  return entries;
}

export function buildProcessTree(psOutput: string): Map<number, Set<number>> {
  const tree = new Map<number, Set<number>>();

  for (const line of psOutput.split("\n")) {
    const trimmed = line.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const pid = parseInt(parts[0], 10);
    const ppid = parseInt(parts[1], 10);
    if (Number.isNaN(pid) || Number.isNaN(ppid)) continue;

    if (!tree.has(ppid)) tree.set(ppid, new Set());
    tree.get(ppid)?.add(pid);
  }

  return tree;
}

export function findDescendantPids(
  root: number,
  tree: Map<number, Set<number>>,
  maxDepth: number,
): Set<number> {
  const result = new Set<number>();
  const queue: Array<{ pid: number; depth: number }> = [
    { pid: root, depth: 0 },
  ];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const { pid, depth } = next;
    if (depth >= maxDepth) continue;

    const children = tree.get(pid);
    if (!children) continue;

    for (const child of children) {
      result.add(child);
      queue.push({ pid: child, depth: depth + 1 });
    }
  }

  return result;
}

export class PortScanner {
  private lastResult = new Map<string, PortInfo[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly activeInterval = 3000;
  private readonly idleInterval = 10000;
  private onChange: ((projectId: string, ports: PortInfo[]) => void) | null =
    null;

  onPortsChanged(cb: (projectId: string, ports: PortInfo[]) => void): void {
    this.onChange = cb;
  }

  start(getSessions: () => Session[], hasRecentActivity?: () => boolean): void {
    let currentInterval = this.activeInterval;

    const tick = async () => {
      const sessions = getSessions().filter(
        (s) => s.state === "running" && s.pid !== null,
      );

      if (sessions.length === 0) {
        for (const projectId of this.lastResult.keys()) {
          this.onChange?.(projectId, []);
        }
        this.lastResult.clear();
        return;
      }

      try {
        const result = await this.scan(sessions);
        this.diffAndNotify(result);
      } catch {
        // scan failure -- skip silently
      }

      const wantedInterval = hasRecentActivity?.()
        ? this.activeInterval
        : this.idleInterval;
      if (wantedInterval !== currentInterval) {
        currentInterval = wantedInterval;
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(tick, currentInterval);
      }
    };

    this.timer = setInterval(tick, currentInterval);
    tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getProjectPorts(projectId: string): PortInfo[] {
    return this.lastResult.get(projectId) ?? [];
  }

  getAllPorts(): Record<string, PortInfo[]> {
    const result: Record<string, PortInfo[]> = {};
    for (const [k, v] of this.lastResult) {
      result[k] = v;
    }
    return result;
  }

  private async scan(sessions: Session[]): Promise<Map<string, PortInfo[]>> {
    const [lsofOut, psOut] = await Promise.all([
      execFileAsync("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P", "-Fpn"], {
        timeout: 5000,
      })
        .then((r) => r.stdout)
        .catch(() => ""),
      execFileAsync("ps", ["-eo", "pid,ppid"], { timeout: 5000 })
        .then((r) => r.stdout)
        .catch(() => ""),
    ]);

    const listenEntries = parseLsofOutput(lsofOut);
    const listenByPid = new Map<number, LsofEntry[]>();
    for (const entry of listenEntries) {
      if (!listenByPid.has(entry.pid)) listenByPid.set(entry.pid, []);
      listenByPid.get(entry.pid)?.push(entry);
    }

    const processTree = buildProcessTree(psOut);
    const projectPorts = new Map<string, PortInfo[]>();

    const sessionsByProject = new Map<string, Session[]>();
    for (const s of sessions) {
      if (!sessionsByProject.has(s.projectId))
        sessionsByProject.set(s.projectId, []);
      sessionsByProject.get(s.projectId)?.push(s);
    }

    for (const [projectId, projectSessions] of sessionsByProject) {
      const ports: PortInfo[] = [];
      const seenPorts = new Set<number>();

      for (const session of projectSessions) {
        if (!session.pid) continue;
        const descendants = findDescendantPids(session.pid, processTree, 5);
        descendants.add(session.pid);

        for (const pid of descendants) {
          const entries = listenByPid.get(pid);
          if (!entries) continue;
          for (const entry of entries) {
            if (seenPorts.has(entry.port)) continue;
            seenPorts.add(entry.port);
            ports.push({
              port: entry.port,
              pid: entry.pid,
              bindsAll: entry.bindsAll,
            });
          }
        }
      }

      ports.sort((a, b) => a.port - b.port);
      projectPorts.set(projectId, ports);
    }

    return projectPorts;
  }

  private diffAndNotify(newResult: Map<string, PortInfo[]>): void {
    const allProjectIds = new Set([
      ...this.lastResult.keys(),
      ...newResult.keys(),
    ]);

    for (const projectId of allProjectIds) {
      const oldPorts = this.lastResult.get(projectId) ?? [];
      const newPorts = newResult.get(projectId) ?? [];

      if (JSON.stringify(oldPorts) !== JSON.stringify(newPorts)) {
        this.onChange?.(projectId, newPorts);
      }
    }

    this.lastResult = newResult;
  }
}

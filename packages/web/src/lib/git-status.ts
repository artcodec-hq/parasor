const STATUS_COLORS: Record<string, string> = {
  M: "text-yellow-400",
  A: "text-green-400",
  D: "text-red-400",
  R: "text-blue-400",
  "?": "text-neutral-400",
};

const STATUS_PRIORITY: Record<string, number> = {
  D: 4,
  M: 3,
  A: 2,
  R: 1,
  "?": 0,
};

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? "text-neutral-400";
}

export function getDirStatus(
  dirPath: string,
  statuses: Record<string, string>,
): string | null {
  const prefix = dirPath === "." ? "" : `${dirPath}/`;
  let best: string | null = null;
  let bestPriority = -1;
  for (const [path, status] of Object.entries(statuses)) {
    if (path.startsWith(prefix)) {
      const priority = STATUS_PRIORITY[status] ?? 0;
      if (priority > bestPriority) {
        best = status;
        bestPriority = priority;
      }
      if (bestPriority >= 4) break; // D is max priority, early exit
    }
  }
  return best;
}

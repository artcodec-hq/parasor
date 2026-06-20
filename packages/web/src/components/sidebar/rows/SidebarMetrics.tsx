export interface SidebarRowMetrics {
  dirty: number;
  ahead: number;
  behind: number;
  serviceCount?: number;
}

export function SidebarMetricsView({
  metrics,
}: {
  metrics?: SidebarRowMetrics;
}) {
  if (!metrics || !hasVisibleMetrics(metrics)) return null;
  return (
    <span
      aria-hidden
      title={formatSidebarMetricsTitle(metrics)}
      className="flex shrink-0 items-center gap-1 text-xs leading-none tabular-nums"
    >
      {metrics.dirty > 0 && (
        <span className="text-[var(--theme-git-modified)]">
          +/-{metrics.dirty}
        </span>
      )}
      {metrics.ahead > 0 && (
        <span className="text-[var(--theme-git-added)]">+{metrics.ahead}</span>
      )}
      {metrics.behind > 0 && (
        <span className="text-[var(--theme-git-modified)]">
          -{metrics.behind}
        </span>
      )}
      {(metrics.serviceCount ?? 0) > 0 && (
        <span className="flex items-center gap-0.5 text-accent">
          <span className="h-1.5 w-1.5 rounded-full border border-current" />
          {metrics.serviceCount}
        </span>
      )}
    </span>
  );
}

export function hasVisibleMetrics(metrics: SidebarRowMetrics): boolean {
  return (
    metrics.dirty > 0 ||
    metrics.ahead > 0 ||
    metrics.behind > 0 ||
    (metrics.serviceCount ?? 0) > 0
  );
}

export function formatSidebarMetricsTitle(metrics: SidebarRowMetrics): string {
  const parts: string[] = [];
  if (metrics.dirty > 0) {
    parts.push(
      `${metrics.dirty} uncommitted change${metrics.dirty === 1 ? "" : "s"}`,
    );
  }
  if (metrics.ahead > 0) {
    parts.push(
      `${metrics.ahead} commit${metrics.ahead === 1 ? "" : "s"} ahead`,
    );
  }
  if (metrics.behind > 0) {
    parts.push(
      `${metrics.behind} commit${metrics.behind === 1 ? "" : "s"} behind`,
    );
  }
  const serviceCount = metrics.serviceCount ?? 0;
  if (serviceCount > 0) {
    parts.push(`${serviceCount} live port${serviceCount === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

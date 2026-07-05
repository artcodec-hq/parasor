export interface SidebarRowMetrics {
  /** Added/deleted line counts for compact dirty diffstat display. */
  dirtyAdded?: number;
  dirtyDeleted?: number;
  /** Changed file entries when line counts are unavailable. */
  dirtyCount?: number;
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
      className="flex shrink-0 items-center gap-0.5 text-[10px] leading-none tabular-nums"
    >
      {(metrics.dirtyAdded ?? 0) > 0 && (
        <span className="text-[var(--theme-git-added)]">
          +{metrics.dirtyAdded}
        </span>
      )}
      {(metrics.dirtyDeleted ?? 0) > 0 && (
        <span className="text-[var(--theme-git-deleted)]">
          -{metrics.dirtyDeleted}
        </span>
      )}
      {(metrics.serviceCount ?? 0) > 0 && (
        <span className="flex items-center gap-0.5 text-accent">
          <span className="h-1 w-1 rounded-full border border-current" />
          {metrics.serviceCount}
        </span>
      )}
    </span>
  );
}

export function hasVisibleMetrics(metrics: SidebarRowMetrics): boolean {
  return hasDirtyLineMetrics(metrics) || (metrics.serviceCount ?? 0) > 0;
}

export function formatSidebarMetricsTitle(metrics: SidebarRowMetrics): string {
  const parts: string[] = [];
  const dirtyAdded = metrics.dirtyAdded ?? 0;
  if (dirtyAdded > 0) {
    parts.push(`${dirtyAdded} added line${dirtyAdded === 1 ? "" : "s"}`);
  }
  const dirtyDeleted = metrics.dirtyDeleted ?? 0;
  if (dirtyDeleted > 0) {
    parts.push(`${dirtyDeleted} deleted line${dirtyDeleted === 1 ? "" : "s"}`);
  }
  if (dirtyAdded === 0 && dirtyDeleted === 0) {
    const dirtyCount = metrics.dirtyCount ?? 0;
    if (dirtyCount > 0) {
      parts.push(
        `${dirtyCount} uncommitted change${dirtyCount === 1 ? "" : "s"}`,
      );
    }
  }
  const serviceCount = metrics.serviceCount ?? 0;
  if (serviceCount > 0) {
    parts.push(`${serviceCount} live port${serviceCount === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

function hasDirtyLineMetrics(metrics: SidebarRowMetrics): boolean {
  return (metrics.dirtyAdded ?? 0) > 0 || (metrics.dirtyDeleted ?? 0) > 0;
}

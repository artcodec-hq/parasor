export const SIDEBAR_WIDTH_DEFAULT = 256;
export const SIDEBAR_WIDTH_MIN = 220;
export const SIDEBAR_WIDTH_MAX = 480;
export const WORKSPACE_WIDTH_MIN = 360;

export function sidebarWidthMax(viewportWidth = window.innerWidth): number {
  if (!Number.isFinite(viewportWidth)) return SIDEBAR_WIDTH_MAX;
  const viewportBound = viewportWidth - WORKSPACE_WIDTH_MIN;
  return Math.max(
    SIDEBAR_WIDTH_MIN,
    Math.min(SIDEBAR_WIDTH_MAX, viewportBound),
  );
}

export function clampSidebarWidth(
  width: number,
  viewportWidth = window.innerWidth,
): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  const max = sidebarWidthMax(viewportWidth);
  return Math.round(Math.min(max, Math.max(SIDEBAR_WIDTH_MIN, width)));
}

export function clampStoredSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.round(
    Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width)),
  );
}

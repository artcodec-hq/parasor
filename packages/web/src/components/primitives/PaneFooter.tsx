import type { ReactNode } from "react";

export type PaneFooterTone = "pane" | "sidebar";

interface PaneFooterProps {
  /** Hide on mobile (`md:flex`). */
  desktopOnly?: boolean;
  /** Left-side status text. Renders xs / secondary, truncated. */
  status?: ReactNode;
  /** Right-side slot for compact chrome actions. */
  actions?: ReactNode;
  /**
   * Surface tone. `pane` matches `PaneHeader` (tab-active bg). `sidebar`
   * is transparent so the footer inherits the sidebar surface and adds an
   * iOS safe-area inset.
   */
  tone?: PaneFooterTone;
  /** Horizontal padding class. Defaults to the pane/header rail inset. */
  horizontalPaddingClassName?: string;
}

const TONE_BG: Record<PaneFooterTone, string> = {
  pane: "bg-pane-header-bg",
  sidebar: "",
};

/**
 * Bottom chrome rail -- counterpart to `PaneHeader`. Shares `h-bar` so the
 * top + bottom rails of every pane and the sidebar align.
 */
export function PaneFooter({
  desktopOnly = false,
  status,
  actions,
  tone = "pane",
  horizontalPaddingClassName = "px-3",
}: PaneFooterProps) {
  const visibility = desktopOnly ? "hidden md:flex" : "flex";
  const bg = TONE_BG[tone];
  const safeAreaPadding =
    tone === "sidebar" ? "cm-safe-area-bottom-standalone" : "";

  return (
    <div
      className={`${visibility} shrink-0 flex-col border-t border-border ${bg} ${safeAreaPadding}`}
    >
      <div
        className={`flex h-bar items-center gap-2 ${horizontalPaddingClassName}`}
      >
        {status !== undefined ? (
          <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
            {status}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {actions}
      </div>
    </div>
  );
}

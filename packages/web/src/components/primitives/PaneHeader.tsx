import type { ReactNode } from "react";

export type PaneHeaderIconTone = "accent" | "warning";

interface PaneHeaderProps {
  icon?: ReactNode;
  iconTone?: PaneHeaderIconTone;
  /** Hide on mobile (`md:flex`). For panes whose mobile chrome lives in SessionPaneHeader. */
  desktopOnly?: boolean;
  title: string;
  /** `title` attribute for the title span (used when truncation hides full text). */
  titleAttr?: string;
  /** Custom title control, e.g. inline editable title. */
  titleElement?: ReactNode;
  /** Render the title with the content monospace stack. Default false for UI chrome. */
  titleMono?: boolean;
  /** Element rendered immediately after the title (e.g., dirty indicator dot). */
  titleAdornment?: ReactNode;
  subtitle?: string;
  subtitleAttr?: string;
  /** Inline content slotted after the title block (e.g., Diff Staged/Unstaged toggle). */
  inline?: ReactNode;
  /** Right-edge slot. Pass mono 11/secondary spans for text meta or buttons for actions. */
  actions?: ReactNode;
}

const ICON_TONE: Record<PaneHeaderIconTone, string> = {
  accent: "text-accent",
  warning: "text-warning",
};

/**
 * Tier-1 pane chrome -- semibold title + optional subtitle. Used by
 * every workspace pane (Editor / FileTree / Diff / GitGraph / Uncommitted
 * / Terminal / Browser) so chrome stays uniform across stacked rows.
 */
export function PaneHeader({
  icon,
  iconTone = "accent",
  desktopOnly = false,
  title,
  titleAttr,
  titleElement,
  titleMono = false,
  titleAdornment,
  subtitle,
  subtitleAttr,
  inline,
  actions,
}: PaneHeaderProps) {
  const visibility = desktopOnly ? "hidden md:flex" : "flex";
  return (
    <div
      className={`${visibility} h-bar shrink-0 items-center gap-2 border-b border-border bg-pane-header-bg px-3`}
    >
      {icon && (
        <span aria-hidden className={`flex shrink-0 ${ICON_TONE[iconTone]}`}>
          {icon}
        </span>
      )}
      {titleElement ?? (
        <span
          title={titleAttr}
          className={`min-w-0 flex-shrink truncate text-sm font-semibold tracking-[-0.005em] text-text-primary${
            titleMono ? " cm-mono" : ""
          }`}
        >
          {title}
        </span>
      )}
      {titleAdornment}
      {subtitle && (
        <span
          title={subtitleAttr}
          className="min-w-0 flex-shrink truncate text-xs text-text-secondary/75"
        >
          {subtitle}
        </span>
      )}
      {inline}
      <span className="flex-1" />
      {actions}
    </div>
  );
}

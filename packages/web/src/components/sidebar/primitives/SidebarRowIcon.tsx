import type { ReactNode } from "react";

export type SidebarRowIconTone =
  | "accent"
  | "secondary"
  | "primary"
  | "warning"
  | "danger"
  | "success";

const TONE_CLASS: Record<SidebarRowIconTone, string> = {
  accent: "text-accent",
  secondary: "text-text-secondary",
  primary: "text-text-primary",
  warning: "text-warning",
  danger: "text-danger",
  success: "text-success",
};

interface SidebarRowIconProps {
  tone?: SidebarRowIconTone;
  /**
   * Extra animation/decoration classes (e.g. `agent-status-working`). Kept
   * separate from `tone` so callers can layer animation over a colour without
   * stringing class fragments together.
   */
  className?: string;
  children: ReactNode;
}

/**
 * 14×14 icon slot with tone-driven colour. The actual SVG is passed as
 * `children` so consumers stay in control of which glyph (and its size).
 */
export function SidebarRowIcon({
  tone = "secondary",
  className,
  children,
}: SidebarRowIconProps) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center ${TONE_CLASS[tone]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

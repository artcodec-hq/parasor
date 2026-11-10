import type { ReactNode } from "react";

type Weight = "normal" | "medium" | "semibold";

const WEIGHT_CLASS: Record<Weight, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
};

interface SidebarRowLabelProps {
  /**
   * When true, label uses `font-semibold`. Most rows derive this from their
   * `selected` state. Pass `weight` directly to override (Monitor row is
   * always semibold).
   */
  selected?: boolean;
  /** Override the default `selected ? semibold : normal` mapping. */
  weight?: Weight;
  grow?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}

export function SidebarRowLabel({
  selected,
  weight,
  grow = true,
  className,
  title,
  children,
}: SidebarRowLabelProps) {
  const w = weight ?? (selected ? "semibold" : "normal");
  const widthClass = grow ? "flex-1" : "shrink";
  return (
    <span
      title={title}
      className={`min-w-0 ${widthClass} truncate text-sm leading-tight ${WEIGHT_CLASS[w]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

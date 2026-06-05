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
  className?: string;
  title?: string;
  children: ReactNode;
}

export function SidebarRowLabel({
  selected,
  weight,
  className,
  title,
  children,
}: SidebarRowLabelProps) {
  const w = weight ?? (selected ? "semibold" : "normal");
  return (
    <span
      title={title}
      className={`min-w-0 flex-1 truncate text-sm leading-tight ${WEIGHT_CLASS[w]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

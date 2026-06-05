import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";

export type SidebarRowDepth = 0 | 1;

interface SidebarRowProps {
  selected?: boolean;
  /**
   * Visual nesting level. Depth owns sidebar row horizontal padding so spacing
   * can be adjusted in one place.
   */
  depth?: SidebarRowDepth;
  hint?: string;
  onClick?: () => void;
  /** Extra classes appended verbatim. */
  className?: string;
  rootProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}

export const SIDEBAR_ROW_INSET_CLASS: Record<SidebarRowDepth, string> = {
  0: "px-3",
  1: "pr-3 pl-9",
};

const SELECTED_CLASS =
  "bg-row-selected-bg before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent before:content-['']";

/**
 * Sidebar row chrome. Owns the height, padding, hover, and selection cue
 * (3px accent stripe on the left + tinted background). Consumers compose
 * `SidebarRowIcon` / `SidebarRowLabel` / domain-specific badges inside.
 */
export function SidebarRow({
  selected,
  depth = 0,
  hint,
  onClick,
  className,
  rootProps,
  children,
}: SidebarRowProps) {
  const interactive = onClick !== undefined;
  const {
    className: rootClassName,
    onKeyDown: rootOnKeyDown,
    ...restRootProps
  } = rootProps ?? {};

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    rootOnKeyDown?.(event);
    if (!interactive || event.defaultPrevented) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: row uses role/button keyboard handling while preserving nested layout content.
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-current={selected ? "page" : undefined}
      title={hint}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      {...restRootProps}
      className={`
        relative flex h-bar min-w-0 ${interactive ? "cursor-pointer" : "cursor-default"} items-center gap-2 ${SIDEBAR_ROW_INSET_CLASS[depth]} text-text-primary
        ${selected ? SELECTED_CLASS : interactive ? "hover:bg-row-hover-bg" : ""}
        ${rootClassName ?? ""}
        ${className ?? ""}
      `}
    >
      {children}
    </div>
  );
}

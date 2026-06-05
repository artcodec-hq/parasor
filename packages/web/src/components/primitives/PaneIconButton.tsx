import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type PaneIconButtonSize = "sm" | "md";
export type PaneIconButtonTone = "normal" | "active" | "accent" | "danger";

interface PaneIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: PaneIconButtonSize;
  tone?: PaneIconButtonTone;
  pressed?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const SIZE: Record<PaneIconButtonSize, string> = {
  sm: "h-tap-sm w-tap-sm",
  md: "h-tap-md w-tap-md",
};

const TONE: Record<PaneIconButtonTone, string> = {
  normal: "text-text-secondary hover:bg-row-hover-bg hover:text-text-primary",
  active: "text-text-primary hover:bg-row-hover-bg",
  accent: "text-accent hover:bg-row-hover-bg",
  danger: "text-text-secondary hover:bg-danger/15 hover:text-danger",
};

export function PaneIconButton({
  label,
  size = "sm",
  tone = "normal",
  pressed,
  title,
  className,
  children,
  ...rest
}: PaneIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      className={`flex ${SIZE[size]} shrink-0 items-center justify-center rounded-control transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary ${TONE[tone]}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}

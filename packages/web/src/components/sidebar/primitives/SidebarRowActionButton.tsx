import type { ButtonHTMLAttributes, ReactNode } from "react";

type SidebarRowActionTone =
  | "default"
  | "accent"
  | "accentHover"
  | "accentPrimaryHover"
  | "dangerPrimaryHover";

interface SidebarRowActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  children: ReactNode;
  tone?: SidebarRowActionTone;
}

const TONE_CLASS: Record<SidebarRowActionTone, string> = {
  default: "text-text-secondary hover:text-text-primary",
  accent: "text-accent",
  accentHover: "text-text-secondary hover:text-accent",
  accentPrimaryHover: "text-accent hover:text-text-primary",
  dangerPrimaryHover: "text-danger hover:text-text-primary",
};

export function SidebarRowActionButton({
  children,
  tone = "default",
  type = "button",
  ...buttonProps
}: SidebarRowActionButtonProps) {
  return (
    <button
      type={type}
      className={`relative flex h-icon-base w-icon-base shrink-0 items-center justify-center rounded-control before:absolute before:-inset-1.5 before:content-[''] ${TONE_CLASS[tone]}`}
      {...buttonProps}
    >
      {children}
    </button>
  );
}

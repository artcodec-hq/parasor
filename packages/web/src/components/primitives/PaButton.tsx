import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type PaButtonKind = "submit" | "destroy" | "normal" | "dismiss";

export type PaButtonSize = "xs" | "sm";

interface PaButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: PaButtonKind;
  /** Defaults to `sm`; use `xs` for dense chrome or toast actions only. */
  size?: PaButtonSize;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-control border font-normal leading-[1.4] transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const SIZE: Record<PaButtonSize, string> = {
  xs: "px-2 py-0.5 text-xs",
  sm: "px-2.5 py-1 text-sm",
};

const KIND: Record<PaButtonKind, string> = {
  submit:
    "border-transparent bg-accent text-bg-primary font-medium hover:bg-accent/90",
  destroy:
    "border-transparent bg-danger text-bg-primary font-medium hover:bg-danger/90",
  normal:
    "border-transparent bg-button-secondary-bg text-text-primary hover:bg-button-secondary-hover-bg",
  dismiss:
    "border-transparent bg-transparent text-text-secondary hover:bg-row-hover-bg hover:text-text-primary",
};

export function PaButton({
  kind = "normal",
  size = "sm",
  className,
  children,
  ...rest
}: PaButtonProps) {
  return (
    <button
      className={`${BASE} ${SIZE[size]} ${KIND[kind]}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}

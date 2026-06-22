import type { ButtonHTMLAttributes } from "react";

interface MonitorPinSwitchButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "aria-label" | "aria-pressed" | "children" | "title" | "type"
  > {
  pressed: boolean;
}

export function MonitorPinSwitchButton({
  pressed,
  className,
  ...buttonProps
}: MonitorPinSwitchButtonProps) {
  const label = pressed ? "Remove from Monitor" : "Pin to Monitor";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`relative flex h-5 w-8 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-1 before:content-['']${className ? ` ${className}` : ""}`}
      {...buttonProps}
    >
      <span
        aria-hidden
        className={`relative block h-3.5 w-6 rounded-full ring-1 transition-colors ${
          pressed
            ? "bg-accent/35 ring-accent/30"
            : "bg-text-secondary/15 ring-border/80"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-2.5 w-2.5 rounded-full transition-transform ${
            pressed
              ? "translate-x-2.5 bg-accent"
              : "translate-x-0 bg-text-secondary/60"
          }`}
        />
      </span>
    </button>
  );
}

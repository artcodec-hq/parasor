import type { ButtonHTMLAttributes } from "react";

interface MonitorSwitchButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "aria-label" | "aria-pressed" | "children" | "title" | "type"
  > {
  pressed: boolean;
  trackSurface?: "content" | "sidebar";
}

export function MonitorSwitchButton({
  pressed,
  trackSurface = "content",
  className,
  ...buttonProps
}: MonitorSwitchButtonProps) {
  const label = pressed ? "Remove from Monitor" : "Pin to Monitor";
  const trackClassName =
    trackSurface === "sidebar" ? "bg-bg-primary/80" : "bg-bg-primary";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`relative flex h-5 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-1 before:content-['']${className ? ` ${className}` : ""}`}
      {...buttonProps}
    >
      <span
        aria-hidden
        className={`relative block h-3.5 w-6 rounded-full transition-colors ${trackClassName}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-2.5 w-2.5 rounded-full transition-transform ${pressed
              ? "translate-x-2.5 bg-accent"
              : "translate-x-0 bg-text-secondary/60"
            }`}
        />
      </span>
    </button>
  );
}

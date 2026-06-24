import type { ButtonHTMLAttributes } from "react";

interface MonitorSwitchButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "aria-label" | "aria-pressed" | "children" | "className" | "title" | "type"
  > {
  className?: string;
  pressed: boolean;
}

export function MonitorSwitchButton({
  pressed,
  className,
  ...buttonProps
}: MonitorSwitchButtonProps) {
  const label = pressed ? "Remove from Monitor" : "Pin to Monitor";
  const trackClassName = className ?? "bg-bg-primary/80";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="relative flex h-5 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-1 before:content-['']"
      {...buttonProps}
    >
      <span
        aria-hidden
        className={`relative block h-3.5 w-6 rounded-full transition-colors ${trackClassName}`}
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

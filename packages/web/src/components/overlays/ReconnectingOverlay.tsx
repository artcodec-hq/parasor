import { useEffect, useState } from "react";

export const DEFAULT_RECONNECTING_OVERLAY_DELAY_MS = 750;

/*
 * Pane-scoped dim overlay shown while the terminal WebSocket is
 * reconnecting. Gated by a short grace window so 1-RTT blips don't
 * flash. `pointer-events-none` keeps keystrokes flowing into xterm --
 * they queue in useTerminalSocket and replay once init completes on
 * the fresh socket. Centered card with spinner + headline.
 */
export function ReconnectingOverlay({
  showDelayMs = DEFAULT_RECONNECTING_OVERLAY_DELAY_MS,
  title = "Reconnecting…",
  detail = "terminal output is buffered",
}: {
  showDelayMs?: number;
  title?: string;
  detail?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    const timer = setTimeout(() => setVisible(true), showDelayMs);
    return () => clearTimeout(timer);
  }, [showDelayMs]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/80 backdrop-blur-[2px]">
      <div className="flex min-w-surface-sm flex-col items-center gap-2 rounded-window border border-border bg-bg-secondary px-7 py-5 text-center shadow-xl">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        >
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeDasharray="20 30"
            strokeLinecap="round"
          />
        </svg>
        <div className="text-base text-text-primary">{title}</div>
        <div className="cm-mono text-xs text-text-secondary">{detail}</div>
      </div>
    </div>
  );
}

import { PaGlyph } from "./PaGlyph.js";

export type AgentDotState =
  | "idle"
  | "working"
  | "attention"
  | "review"
  | "none";

interface AgentDotProps {
  state?: AgentDotState;
  size?: number;
  title?: string;
}

const LABEL: Record<AgentDotState, string> = {
  idle: "idle",
  working: "working",
  attention: "needs input",
  review: "review",
  none: "default",
};

/*
 * Status icon shared across Sidebar / Monitor surfaces. Shapes follow the
 * requested Lucide mapping: working=loader-circle, attention=circle-pause,
 * done/default=circle-small.
 */
export function AgentDot({ state = "idle", size = 16, title }: AgentDotProps) {
  const label = title ?? LABEL[state];
  const dim = { width: size, height: size };
  const iconClass = "h-full w-full";

  if (state === "working") {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center text-[var(--theme-git-modified)]"
        style={dim}
        role="img"
        aria-label={label}
      >
        <PaGlyph.working className={`agent-status-working ${iconClass}`} />
      </span>
    );
  }

  if (state === "attention") {
    return (
      <span
        className="agent-status-attention inline-flex shrink-0 items-center justify-center text-danger"
        style={dim}
        role="img"
        aria-label={label}
      >
        <PaGlyph.attention className={iconClass} />
      </span>
    );
  }

  if (state === "review") {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center text-success"
        style={dim}
        role="img"
        aria-label={label}
      >
        <PaGlyph.circleSmall className={iconClass} />
      </span>
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center text-text-secondary/70"
      style={dim}
      role="img"
      aria-label={label}
    >
      <PaGlyph.circleSmall className={iconClass} />
    </span>
  );
}

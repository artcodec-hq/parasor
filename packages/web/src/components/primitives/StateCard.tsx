import type { ReactNode } from "react";
import type { PaButtonKind } from "./PaButton.js";
import { PaButton } from "./PaButton.js";

export type StateCardTone = "err" | "warn" | "info";

export interface StateCardAction {
  label: string;
  onClick: () => void;
  /** Force the rendered button kind. Otherwise the slot picks (commit/cancel/dismiss). */
  kind?: PaButtonKind;
}

export interface StateCardProps {
  tone: StateCardTone;
  /** Optional override; defaults are FAILED / NEEDS ATTENTION / PAUSED. */
  tag?: string;
  title: string;
  body: ReactNode;
  primary?: StateCardAction;
  secondary?: StateCardAction;
  ternary?: StateCardAction;
  className?: string;
}

const TONE_BAR: Record<StateCardTone, string> = {
  err: "bg-danger",
  warn: "bg-warning",
  info: "bg-accent",
};

const TONE_TEXT: Record<StateCardTone, string> = {
  err: "text-danger",
  warn: "text-warning",
  info: "text-accent",
};

const TONE_DEFAULT_TAG: Record<StateCardTone, string> = {
  err: "FAILED",
  warn: "NEEDS ATTENTION",
  info: "PAUSED",
};

/**
 * Reusable state card: 4px tone bar + uppercase tag + title + body +
 * up to 3 action buttons.
 */
export function StateCard({
  tone,
  tag,
  title,
  body,
  primary,
  secondary,
  ternary,
  className,
}: StateCardProps) {
  const resolvedTag = tag ?? TONE_DEFAULT_TAG[tone];
  return (
    <div
      className={`flex w-surface-sm max-w-full flex-col overflow-hidden rounded-window border border-border bg-bg-secondary shadow-lg${className ? ` ${className}` : ""}`}
    >
      <div aria-hidden className={`h-1 shrink-0 ${TONE_BAR[tone]}`} />
      <div className="flex flex-col gap-2 px-4 py-3.5">
        <span
          className={`cm-mono self-start text-xs font-bold uppercase tracking-[0.08em] ${TONE_TEXT[tone]}`}
        >
          {resolvedTag}
        </span>
        <div className="text-sm font-semibold tracking-[-0.005em] text-text-primary">
          {title}
        </div>
        <div className="text-sm leading-[1.55] text-text-secondary">{body}</div>
        {(primary || secondary || ternary) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {primary && (
              <PaButton
                kind={primary.kind ?? "submit"}
                size="sm"
                onClick={primary.onClick}
              >
                {primary.label}
              </PaButton>
            )}
            {secondary && (
              <PaButton
                kind={secondary.kind ?? "normal"}
                size="sm"
                onClick={secondary.onClick}
              >
                {secondary.label}
              </PaButton>
            )}
            {ternary && (
              <PaButton
                kind={ternary.kind ?? "dismiss"}
                size="sm"
                onClick={ternary.onClick}
              >
                {ternary.label}
              </PaButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

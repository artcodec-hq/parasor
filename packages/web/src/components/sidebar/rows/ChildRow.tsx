import { AgentDot, PaGlyph } from "../../primitives/index.js";
import type { SidebarChild } from "../model/types.js";
import { SidebarRow, SidebarRowLabel } from "../primitives/index.js";

interface ChildRowProps {
  child: SidebarChild;
  selected: boolean;
  disabled?: boolean;
  unavailable?: boolean;
  onClick?: () => void;
  onTogglePin?: () => void;
}

const ACCESSIBLE_STATUS_LABEL: Partial<Record<SidebarChild["status"], string>> =
  {
    working: "status: working",
    attention: "status: needs input",
    review: "status: review",
  };

const STATUS_LABEL_CLASS: Record<SidebarChild["status"], string> = {
  working: "text-[var(--theme-git-modified)]",
  attention: "text-danger",
  review: "text-success",
  idle: "",
  none: "",
};

function SidebarChildStatus({ child }: { child: SidebarChild }) {
  return (
    <span
      aria-hidden
      className="flex h-4 w-4 shrink-0 items-center justify-center"
    >
      <AgentDot state={child.status} />
    </span>
  );
}

export function ChildRow({
  child,
  selected,
  disabled = false,
  unavailable = false,
  onClick,
  onTogglePin,
}: ChildRowProps) {
  const accessibleStatus = ACCESSIBLE_STATUS_LABEL[child.status];
  const rowSelected = !disabled && selected;
  const canTogglePin =
    !disabled &&
    !unavailable &&
    child.kind === "terminal" &&
    onTogglePin !== undefined;

  return (
    <SidebarRow
      depth={1}
      selected={rowSelected}
      hint={child.hint}
      onClick={disabled ? undefined : onClick}
      className={disabled || unavailable ? "opacity-50" : undefined}
      rootProps={disabled ? { "aria-disabled": true } : undefined}
    >
      <SidebarChildStatus child={child} />
      <SidebarRowLabel
        selected={rowSelected}
        className={STATUS_LABEL_CLASS[child.status]}
      >
        {child.label}
      </SidebarRowLabel>
      {accessibleStatus && (
        <span className="sr-only">, {accessibleStatus}</span>
      )}
      {canTogglePin ? (
        <MonitorSwitchButton pressed={child.pinned} onToggle={onTogglePin} />
      ) : !disabled && !unavailable && child.pinned ? (
        <span
          role="img"
          aria-label="pinned to Monitor"
          title="Pinned to Monitor"
          className="flex shrink-0 text-accent"
        >
          <PaGlyph.pin />
        </span>
      ) : null}
    </SidebarRow>
  );
}

function MonitorSwitchButton({
  pressed,
  onToggle,
}: {
  pressed: boolean;
  onToggle: () => void;
}) {
  const label = pressed ? "Remove from Monitor" : "Pin to Monitor";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="relative flex h-5 w-9 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-1 before:content-['']"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <MonitorSwitch pressed={pressed} />
    </button>
  );
}

function MonitorSwitch({ pressed }: { pressed: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative block h-3.5 w-7 rounded-full transition-colors ${
        pressed ? "bg-accent/35" : "bg-bg-primary/80"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-2.5 w-2.5 rounded-full transition-transform ${
          pressed
            ? "translate-x-3.5 bg-accent"
            : "translate-x-0 bg-text-secondary/60"
        }`}
      />
    </span>
  );
}

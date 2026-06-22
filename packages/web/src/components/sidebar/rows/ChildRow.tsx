import {
  AgentDot,
  MonitorSwitchButton,
  PaGlyph,
} from "../../primitives/index.js";
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
        <MonitorSwitchButton
          pressed={child.pinned}
          trackSurface="sidebar"
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
        />
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

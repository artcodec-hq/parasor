import { AgentDot, PaGlyph } from "../../primitives/index.js";
import type { SidebarChild } from "../model/types.js";
import {
  SidebarRow,
  SidebarRowActionButton,
  SidebarRowLabel,
} from "../primitives/index.js";

interface ChildRowProps {
  child: SidebarChild;
  selected: boolean;
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
  onClick,
  onTogglePin,
}: ChildRowProps) {
  const accessibleStatus = ACCESSIBLE_STATUS_LABEL[child.status];
  const canTogglePin = child.kind === "terminal" && onTogglePin !== undefined;

  return (
    <SidebarRow
      depth={1}
      selected={selected}
      hint={child.hint}
      onClick={onClick}
    >
      <SidebarChildStatus child={child} />
      <SidebarRowLabel
        selected={selected}
        className={STATUS_LABEL_CLASS[child.status]}
      >
        {child.label}
      </SidebarRowLabel>
      {accessibleStatus && (
        <span className="sr-only">, {accessibleStatus}</span>
      )}
      {canTogglePin ? (
        <SidebarRowActionButton
          aria-label={child.pinned ? "Remove from Monitor" : "Pin to Monitor"}
          aria-pressed={child.pinned}
          title={child.pinned ? "Remove from Monitor" : "Pin to Monitor"}
          tone={child.pinned ? "accent" : "default"}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
        >
          <PaGlyph.pin />
        </SidebarRowActionButton>
      ) : child.pinned ? (
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

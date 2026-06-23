import { PaGlyph } from "../../primitives/index.js";
import {
  SidebarRow,
  SidebarRowIcon,
  SidebarRowLabel,
} from "../primitives/index.js";

interface MonitorRowProps {
  selected: boolean;
  /** Count of pinned terminals across all projects. */
  pinnedCount: number;
  onClick?: () => void;
}

export function MonitorRow({
  selected,
  pinnedCount,
  onClick,
}: MonitorRowProps) {
  return (
    <SidebarRow selected={selected} onClick={onClick}>
      <SidebarRowIcon tone={selected ? "accent" : "secondary"}>
        <PaGlyph.monitor />
      </SidebarRowIcon>
      <SidebarRowLabel weight="semibold">Monitor</SidebarRowLabel>
      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-bg-primary/80 px-1.5 text-xs font-semibold leading-none text-text-secondary">
        {pinnedCount}
      </span>
    </SidebarRow>
  );
}

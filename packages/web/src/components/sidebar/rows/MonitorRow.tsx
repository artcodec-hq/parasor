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
      <span className="shrink-0 text-xs text-text-secondary">
        {pinnedCount}
      </span>
    </SidebarRow>
  );
}

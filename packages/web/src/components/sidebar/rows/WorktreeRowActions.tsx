import { PaGlyph } from "../../primitives/index.js";
import { SidebarRowActionButton } from "../primitives/index.js";

interface WorktreeRowActionsProps {
  label: string;
  onOpenContainer?: () => void;
}

export function WorktreeRowActions({
  label,
  onOpenContainer,
}: WorktreeRowActionsProps) {
  if (!onOpenContainer) return null;

  return (
    <SidebarRowActionButton
      aria-label={`New session in ${label}`}
      tone="accentHover"
      onClick={(event) => {
        event.stopPropagation();
        onOpenContainer();
      }}
    >
      <PaGlyph.add />
    </SidebarRowActionButton>
  );
}

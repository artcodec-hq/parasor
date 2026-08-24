import { PaGlyph } from "../../primitives/index.js";
import { SidebarRowActionButton } from "../primitives/index.js";

interface WorktreeRowActionsProps {
  label: string;
  onNewSession?: () => void;
}

export function WorktreeRowActions({
  label,
  onNewSession,
}: WorktreeRowActionsProps) {
  if (!onNewSession) return null;

  return (
    <span className="shrink-0 opacity-45 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {onNewSession ? (
        <SidebarRowActionButton
          aria-label={`New session in ${label}`}
          tone="accentHover"
          onClick={(event) => {
            event.stopPropagation();
            onNewSession();
          }}
        >
          <PaGlyph.add />
        </SidebarRowActionButton>
      ) : null}
    </span>
  );
}

import { PaGlyph } from "../../primitives/index.js";
import { SidebarRowActionButton } from "../primitives/index.js";

interface WorktreeRowActionsProps {
  label: string;
  onNewSession?: () => void;
  onNewWorkItem?: () => void;
}

export function WorktreeRowActions({
  label,
  onNewSession,
  onNewWorkItem,
}: WorktreeRowActionsProps) {
  if (!onNewSession && !onNewWorkItem) return null;

  return (
    <span className="shrink-0 opacity-45 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {onNewWorkItem ? (
        <SidebarRowActionButton
          aria-label={`Open work item in ${label}`}
          tone="accentHover"
          onClick={(event) => {
            event.stopPropagation();
            onNewWorkItem();
          }}
        >
          <PaGlyph.doc />
        </SidebarRowActionButton>
      ) : null}
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

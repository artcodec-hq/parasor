import { PaGlyph } from "../../primitives/index.js";
import { SidebarRowActionButton } from "../primitives/index.js";

interface WorktreeRowActionsProps {
  label: string;
  onNewSession?: () => void;
  onPruneStaleWorktree?: () => void;
}

export function WorktreeRowActions({
  label,
  onNewSession,
  onPruneStaleWorktree,
}: WorktreeRowActionsProps) {
  if (!onNewSession && !onPruneStaleWorktree) return null;

  return (
    <span className="shrink-0 opacity-45 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {onPruneStaleWorktree ? (
        <SidebarRowActionButton
          title="Prune stale worktree"
          aria-label={`Prune stale worktree ${label}`}
          tone="dangerPrimaryHover"
          onClick={(event) => {
            event.stopPropagation();
            onPruneStaleWorktree();
          }}
        >
          <PaGlyph.close />
        </SidebarRowActionButton>
      ) : onNewSession ? (
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

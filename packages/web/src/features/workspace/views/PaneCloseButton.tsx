import {
  PaGlyph,
  PaneIconButton,
} from "../../../components/primitives/index.js";

interface PaneCloseButtonProps {
  onClick: () => void;
}

/**
 * Direct × close button for terminal/browser pane headers. Hover turns
 * red (destructive intent signal) so it's visually unmistakable from the
 * adjacent gray Pin toggle -- close kills a shell session, misclicks
 * matter.
 */
export function PaneCloseButton({ onClick }: PaneCloseButtonProps) {
  return (
    <PaneIconButton
      label="Close pane"
      title="Close pane"
      size="md"
      tone="danger"
      onClick={onClick}
    >
      <PaGlyph.close />
    </PaneIconButton>
  );
}

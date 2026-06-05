import {
  PaGlyph,
  PaneIconButton,
} from "../../../components/primitives/index.js";

interface PinToggleButtonProps {
  pinned: boolean;
  onToggle: () => void;
}

/**
 * Pin toggle for terminal pane headers. Icon-only frameless button --
 * pinned state communicated by color (accent vs. secondary). Affordance
 * meaning is explained on the Monitor empty state, not via inline label.
 */
export function PinToggleButton({ pinned, onToggle }: PinToggleButtonProps) {
  return (
    <PaneIconButton
      label={pinned ? "Unpin from Monitor" : "Pin to Monitor"}
      title={pinned ? "Pinned to Monitor -- click to unpin" : "Pin to Monitor"}
      size="md"
      tone={pinned ? "accent" : "normal"}
      pressed={pinned}
      onClick={onToggle}
    >
      <PaGlyph.pin />
    </PaneIconButton>
  );
}

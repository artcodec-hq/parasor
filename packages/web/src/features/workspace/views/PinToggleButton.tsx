import { MonitorPinSwitchButton } from "../../../components/primitives/index.js";

interface PinToggleButtonProps {
  pinned: boolean;
  onToggle: () => void;
}

/**
 * Pin toggle for terminal pane headers. Mirrors the sidebar Monitor switch so
 * the same control looks and lands consistently wherever pinning is exposed.
 */
export function PinToggleButton({ pinned, onToggle }: PinToggleButtonProps) {
  return <MonitorPinSwitchButton pressed={pinned} onClick={onToggle} />;
}

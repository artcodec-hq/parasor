import { MonitorSwitchButton } from "../../../components/primitives/index.js";

interface PinToggleButtonProps {
  pinned: boolean;
  onToggle: () => void;
}

/**
 * Pin toggle for terminal pane headers. Mirrors the Monitor switch used in the
 * sidebar so pinning has a consistent shape wherever it appears.
 */
export function PinToggleButton({ pinned, onToggle }: PinToggleButtonProps) {
  return (
    <MonitorSwitchButton
      pressed={pinned}
      trackSurface="sidebar"
      onClick={onToggle}
    />
  );
}

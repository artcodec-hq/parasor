import { DEFAULT_RECONNECTING_OVERLAY_DELAY_MS } from "../../../components/overlays/ReconnectingOverlay.js";

const FOREGROUND_RECONNECTING_OVERLAY_DELAY_MS = 2500;
const FOREGROUND_RECONNECTING_GRACE_MS = 3000;

export function resolveTerminalReconnectingOverlayDelay({
  isTouch,
  lastForegroundAtMs,
  nowMs = Date.now(),
}: {
  isTouch: boolean;
  lastForegroundAtMs: number;
  nowMs?: number;
}) {
  return isTouch &&
    lastForegroundAtMs > 0 &&
    nowMs - lastForegroundAtMs <= FOREGROUND_RECONNECTING_GRACE_MS
    ? FOREGROUND_RECONNECTING_OVERLAY_DELAY_MS
    : DEFAULT_RECONNECTING_OVERLAY_DELAY_MS;
}

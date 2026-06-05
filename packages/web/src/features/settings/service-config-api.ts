import type { PortDetectionMode } from "@parasor/shared";
import { authFetch } from "../../lib/auth-fetch.js";

export interface ServiceConfigPatch {
  preventIdleSleep?: boolean;
  portDetection?: PortDetectionMode;
  dropSizeMaxBytes?: number;
}

export async function updateServiceConfig(
  patch: ServiceConfigPatch,
): Promise<void> {
  const res = await authFetch("/api/service-config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Failed to update service config: ${res.status}`);
  }
}

/**
 * Fire-and-warn variant of {@link updateServiceConfig} used by App's
 * Settings handlers. The Settings UI does not block on the PATCH and has
 * no toast affordance for failure, so a rejection is logged with the
 * patched field name (matching the original inline `Failed to update
 * <field>:` wording) and otherwise swallowed.
 *
 * Single-key patches keep the warning message specific to the field the
 * user just toggled; multi-key patches (none today) would warn under
 * the first key only -- same as the old inline handlers would have done
 * if they grew a multi-key payload.
 */
export function fireServiceConfigUpdate(patch: ServiceConfigPatch): void {
  const field = Object.keys(patch)[0] ?? "service config";
  void updateServiceConfig(patch).catch((error) => {
    console.warn(`Failed to update ${field}:`, error);
  });
}

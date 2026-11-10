import type { PortDetectionMode } from "@parasor/shared";
import { useCallback } from "react";
import { fireServiceConfigUpdate } from "../settings/service-config-api.js";

export function useServiceConfigActions() {
  const setPreventIdleSleep = useCallback((enabled: boolean) => {
    fireServiceConfigUpdate({ preventIdleSleep: enabled });
  }, []);

  const setPortDetection = useCallback((mode: PortDetectionMode) => {
    fireServiceConfigUpdate({ portDetection: mode });
  }, []);

  const setDropSizeMaxBytes = useCallback((bytes: number) => {
    fireServiceConfigUpdate({ dropSizeMaxBytes: bytes });
  }, []);

  return {
    setDropSizeMaxBytes,
    setPortDetection,
    setPreventIdleSleep,
  };
}

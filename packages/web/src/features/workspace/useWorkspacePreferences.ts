import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  clampSidebarWidth,
  clampStoredSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
} from "../../lib/sidebar-width.js";

const PREFS_KEY = "parasor:preferences";

interface Prefs {
  sidebarWidth?: number;
  focusedProjectId?: string | null;
  focusedPaneId?: string | null;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable under privacy mode.
  }
}

export function useWorkspacePreferences() {
  const prefs = useMemo(loadPrefs, []);
  const [sidebarWidth, setSidebarWidthState] = useState(() =>
    clampStoredSidebarWidth(prefs.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT),
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    prefs.focusedProjectId ?? null,
  );
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(
    prefs.focusedPaneId ?? null,
  );

  const setSidebarWidth = useCallback((next: SetStateAction<number>) => {
    setSidebarWidthState((prev) =>
      clampSidebarWidth(typeof next === "function" ? next(prev) : next),
    );
  }, []);

  useEffect(() => {
    savePrefs({
      sidebarWidth,
      focusedProjectId: activeProjectId,
      focusedPaneId,
    });
  }, [sidebarWidth, activeProjectId, focusedPaneId]);

  return {
    activeProjectId,
    focusedPaneId,
    setActiveProjectId,
    setFocusedPaneId,
    setSidebarWidth,
    sidebarWidth,
  };
}

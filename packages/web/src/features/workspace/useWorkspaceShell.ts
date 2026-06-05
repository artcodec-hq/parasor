import type { Project } from "@parasor/shared";
import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";

const LEGACY_LAYOUT_KEY = "parasor:layout";

interface UseWorkspaceShellOptions {
  activeProjectId: string | null;
  projects: Project[];
  setActiveProjectId: (id: string) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function sortProjectsForHotkey(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.lastAccessedAt - a.lastAccessedAt;
  });
}

export function useWorkspaceShell({
  activeProjectId: _activeProjectId,
  projects,
  setActiveProjectId,
}: UseWorkspaceShellOptions) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    localStorage.removeItem(LEGACY_LAYOUT_KEY);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setSettingsOpen((value) => !value);
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        /^[1-9]$/.test(event.key) &&
        !isTypingTarget(event.target)
      ) {
        const sorted = sortProjectsForHotkey(projects);
        const index = Number(event.key) - 1;
        const target = sorted[index];
        if (target) {
          event.preventDefault();
          setActiveProjectId(target.id);
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [projects, setActiveProjectId]);

  return {
    closeSettings,
    isMobile,
    openSettings,
    settingsOpen,
  };
}

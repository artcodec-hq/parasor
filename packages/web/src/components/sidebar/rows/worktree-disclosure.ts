import { useEffect, useState } from "react";

const WORKTREE_DISCLOSURE_STORAGE_PREFIX = "parasor:sidebar:worktree-open";

function worktreeDisclosureStorageKey(projectId: string): string {
  return `${WORKTREE_DISCLOSURE_STORAGE_PREFIX}:${projectId}`;
}

function readWorktreeDisclosureState(
  projectId: string,
  worktreePath: string,
): boolean {
  try {
    const raw = window.localStorage.getItem(
      worktreeDisclosureStorageKey(projectId),
    );
    if (!raw) return true;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return true;
    }
    const value = (parsed as Record<string, unknown>)[worktreePath];
    return typeof value === "boolean" ? value : true;
  } catch {
    return true;
  }
}

function writeWorktreeDisclosureState(
  projectId: string,
  worktreePath: string,
  open: boolean,
): void {
  try {
    const key = worktreeDisclosureStorageKey(projectId);
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const next =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    next[worktreePath] = open;
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // localStorage is a best-effort UI preference.
  }
}

export function useWorktreeDisclosure(
  projectId: string,
  worktreePath: string,
  forceOpen: boolean,
) {
  const [internalOpen, setInternalOpen] = useState(() =>
    readWorktreeDisclosureState(projectId, worktreePath),
  );

  useEffect(() => {
    setInternalOpen(readWorktreeDisclosureState(projectId, worktreePath));
  }, [projectId, worktreePath]);

  const open = forceOpen ? true : internalOpen;
  const toggle = () => {
    if (forceOpen) return;
    setInternalOpen((wasOpen) => {
      const next = !wasOpen;
      writeWorktreeDisclosureState(projectId, worktreePath, next);
      return next;
    });
  };

  return { open, toggle };
}

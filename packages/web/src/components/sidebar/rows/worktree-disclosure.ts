export function useWorktreeDisclosure(
  worktreePath: string,
  forceOpen: boolean,
  worktreeOpen: Record<string, boolean> | undefined,
  onOpenChange?: (worktreePath: string, open: boolean) => void,
) {
  const internalOpen = worktreeOpen?.[worktreePath] ?? true;
  const open = forceOpen ? true : internalOpen;
  const toggle = () => {
    if (forceOpen) return;
    onOpenChange?.(worktreePath, !internalOpen);
  };

  return { open, toggle };
}

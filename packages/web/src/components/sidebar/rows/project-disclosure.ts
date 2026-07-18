export function useProjectDisclosure(
  projectPath: string,
  forceOpen: boolean,
  openState: Record<string, boolean> | undefined,
  onOpenChange?: (projectPath: string, open: boolean) => void,
) {
  const storedOpen = openState?.[projectPath] ?? true;
  const open = forceOpen ? true : storedOpen;
  const toggle = () => {
    if (forceOpen) return;
    onOpenChange?.(projectPath, !storedOpen);
  };

  return { open, toggle };
}

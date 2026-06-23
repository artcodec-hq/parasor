import { PaButton, PaKbd } from "../../components/primitives/index.js";

interface WorkspaceEmptyStateProps {
  activeProjectId: string | null;
  hydrated: boolean;
  onNewProject: () => void;
}

/**
 * Hero placeholder shown when no pane is focused. The workspace empty
 * surface is brand-only -- actual launch flows live on worktree rows
 * (`+` -> NewSessionDialog) and the sidebar. "New Project…" only
 * surfaces when the user has no project yet; otherwise we point them
 * at the sidebar filter (`⌘K`) since search now scopes to the sidebar.
 */
export function WorkspaceEmptyState({
  activeProjectId,
  hydrated,
  onNewProject,
}: WorkspaceEmptyStateProps) {
  if (!hydrated) {
    return <div className="h-full w-full" />;
  }

  return (
    <div className="relative flex h-full items-center justify-center px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage:
            "radial-gradient(ellipse 60% 60% at 50% 45%, #000, transparent)",
          WebkitMaskImage:
            "radial-gradient(ellipse 60% 60% at 50% 45%, #000, transparent)",
        }}
      />
      <div className="relative max-w-surface-md text-center">
        <p className="mb-3.5 text-[32px] font-normal leading-none tracking-normal text-text-primary">
          parasor
        </p>
        {activeProjectId ? (
          <p className="mx-auto max-w-[440px] text-base leading-[1.6] text-text-secondary">
            Pick a worktree from the sidebar, or filter it with{" "}
            <span className="inline-flex shrink-0 gap-[3px] align-middle">
              <PaKbd>⌘</PaKbd>
              <PaKbd>K</PaKbd>
            </span>
            .
          </p>
        ) : (
          <>
            <p className="mb-7 text-base leading-[1.6] text-text-secondary">
              No project yet. Add one to get started.
            </p>
            <PaButton kind="submit" size="sm" onClick={onNewProject}>
              New Project…
            </PaButton>
          </>
        )}
      </div>
    </div>
  );
}

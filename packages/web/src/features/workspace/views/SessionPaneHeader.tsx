import type { ReactNode } from "react";
import {
  MonitorSwitchButton,
  PaGlyph,
  PaMenu,
  PaneIconButton,
} from "../../../components/primitives/index.js";
import type { PaMenuItem } from "../../../components/primitives/PaMenu.js";
import { useLongPressCopy } from "../../../hooks/use-long-press-copy.js";
import { PaneCloseButton } from "./PaneCloseButton.js";
import { WorktreeTabBar } from "./WorktreeTabBar.js";

export interface SessionCrumb {
  label: string;
  /** Render this crumb in subdued tone (text-text-secondary). */
  dim?: boolean;
  maxWidth?: number;
  /** Optional leading glyph (e.g. ⎇ branch icon for the worktree crumb). */
  glyph?: ReactNode;
}

export type SessionPaneView = "files" | "git";

interface SessionPaneHeaderProps {
  /** Multi-segment path (project / worktree / branch). */
  crumbs: ReadonlyArray<SessionCrumb>;
  /** If provided, renders a back arrow on mobile; otherwise returns to root navigation. */
  onBack?: (() => void) | null;
  onToggleDrawer: () => void;
  /** Row 2 -- segmented Files|Git (mobile worktree screens only). */
  view?: SessionPaneView;
  onChangeView?: (next: SessionPaneView) => void;
  /** Row 2 -- uncommitted change count (Δ). */
  dirty?: number;
  /** Inline Pin chip mirroring desktop terminal header. Hidden if omitted. */
  pin?: { pinned: boolean; onToggle: () => void } | null;
  /** Right-edge × close button (terminal/browser panes). Hidden if omitted. */
  onClose?: () => void;
  /** Right-edge ⋯ overflow menu (worktree-scoped lifecycle actions). */
  moreMenuItems?: PaMenuItem[];
}

/**
 * Workspace pane chrome shared by mobile (every pane) and desktop
 * (sidebar-direct panes only -- terminal / browser). Single identity row
 * carrying multi-segment crumbs (project / branch / [child]). Mobile
 * adds root navigation / back arrow at the leading edge and may render
 * Row 2 (Files|Git tabs + dirty) for worktree screens. Desktop hides
 * those mobile-only affordances.
 */
export function SessionPaneHeader({
  crumbs,
  onBack,
  onToggleDrawer,
  view,
  onChangeView,
  dirty,
  pin,
  onClose,
  moreMenuItems,
}: SessionPaneHeaderProps) {
  const showDirty = (dirty ?? 0) > 0;
  const seenCrumbLabels = new Map<string, number>();

  return (
    <div
      className="relative shrink-0 border-b border-border bg-bg-secondary"
      role="toolbar"
      aria-label="Workspace"
    >
      <div className="flex h-bar items-center gap-2 px-2 md:px-3">
        {onBack ? (
          <PaneIconButton
            onClick={onBack}
            label="Back"
            size="md"
            tone="active"
            className="md:hidden"
          >
            <PaGlyph.back />
          </PaneIconButton>
        ) : (
          <PaneIconButton
            onClick={onToggleDrawer}
            label="Go to sessions"
            size="md"
            tone="active"
            className="md:hidden"
          >
            <PaGlyph.menu />
          </PaneIconButton>
        )}
        <div className="-ml-2 flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold tracking-[-0.005em] md:ml-0 md:gap-1.5 md:px-1">
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1;
            const occurrence = seenCrumbLabels.get(crumb.label) ?? 0;
            seenCrumbLabels.set(crumb.label, occurrence + 1);
            return (
              <CrumbCell
                key={`${crumb.label}:${occurrence}`}
                crumb={crumb}
                showSep={i > 0}
                isLast={isLast}
                trailing={
                  isLast && pin ? (
                    <MonitorSwitchButton
                      pressed={pin.pinned}
                      className="bg-bg-secondary"
                      onClick={pin.onToggle}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2.5">
          {showDirty && (
            <span
              className="inline-flex shrink-0 items-center gap-1.5 px-1 text-sm font-medium text-[var(--theme-git-modified)]"
              title={`${dirty} uncommitted changes`}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-tag bg-[var(--theme-git-modified)]"
              />
              {dirty}Δ
            </span>
          )}
          {onClose && <PaneCloseButton onClick={onClose} />}
          {moreMenuItems && moreMenuItems.length > 0 && (
            <PaMenu
              align="end"
              items={moreMenuItems}
              renderTrigger={({
                toggle,
                triggerRef,
                menuId,
                open: menuOpen,
              }) => (
                <PaneIconButton
                  ref={triggerRef}
                  onClick={toggle}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls={menuId}
                  label="Workspace menu"
                  size="md"
                >
                  <PaGlyph.more />
                </PaneIconButton>
              )}
            />
          )}
        </div>
      </div>

      {view !== undefined && onChangeView ? (
        <div className="h-bar border-t border-border bg-tab-strip-bg md:hidden">
          <WorktreeTabBar activeTab={view} onChangeTab={onChangeView} />
        </div>
      ) : null}
    </div>
  );
}

function CrumbCell({
  crumb,
  showSep,
  isLast,
  trailing,
}: {
  crumb: SessionCrumb;
  showSep: boolean;
  isLast: boolean;
  trailing?: ReactNode;
}) {
  const press = useLongPressCopy(crumb.label, "name");
  return (
    <span
      className="flex min-w-0 items-center gap-1.5"
      style={{ flex: isLast ? "1 1 auto" : "0 1 auto" }}
    >
      {showSep && (
        <span aria-hidden className="shrink-0 text-text-secondary/50">
          ·
        </span>
      )}
      {crumb.glyph && (
        <span
          aria-hidden
          className={`shrink-0 ${crumb.dim ? "text-text-secondary/70" : "text-accent"}`}
        >
          {crumb.glyph}
        </span>
      )}
      <span
        title={crumb.label}
        onTouchStart={press.onTouchStart}
        onTouchMove={press.onTouchMove}
        onTouchEnd={press.onTouchEnd}
        onTouchCancel={press.onTouchCancel}
        className={`min-w-0 truncate transition-opacity ${
          crumb.dim ? "font-medium text-text-secondary/70" : "text-text-primary"
        } ${press.armed ? "opacity-60" : "opacity-100"}`}
        style={{ maxWidth: crumb.maxWidth }}
      >
        {crumb.label}
      </span>
      {trailing}
    </span>
  );
}

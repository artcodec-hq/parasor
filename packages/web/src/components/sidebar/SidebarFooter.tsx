import type { PortInfo } from "@parasor/shared";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { PaGlyph, PaneFooter } from "../primitives/index.js";
import { NetworkPortCenter } from "./NetworkPortCenter.js";
import {
  SIDEBAR_ROW_INSET_CLASS,
  SidebarRowActionButton,
} from "./primitives/index.js";

interface SidebarFooterProps {
  connected: boolean;
  portsByProjectId?: Record<string, PortInfo[]>;
  projectNames?: Record<string, string>;
  onOpenUrl?: (url: string, options?: OpenUrlOptions) => void;
  onOpenSettings?: () => void;
  onNewProject?: () => void;
  searchOpen?: boolean;
  onToggleSearch?: () => void;
}

export function SidebarFooter({
  connected,
  portsByProjectId,
  projectNames,
  onOpenUrl,
  onOpenSettings,
  onNewProject,
  searchOpen = false,
  onToggleSearch,
}: SidebarFooterProps) {
  return (
    <PaneFooter
      tone="sidebar"
      horizontalPaddingClassName={SIDEBAR_ROW_INSET_CLASS[0]}
      status={
        <NetworkPortCenter
          connected={connected}
          portsByProjectId={portsByProjectId}
          projectNames={projectNames}
          onOpenUrl={onOpenUrl}
        />
      }
      actions={
        <span className="flex items-center gap-3">
          {onNewProject && (
            <SidebarRowActionButton
              title="New project"
              aria-label="New project"
              onClick={onNewProject}
              tone="accentHover"
            >
              <PaGlyph.add />
            </SidebarRowActionButton>
          )}
          <SidebarRowActionButton
            title="Filter sidebar"
            aria-label={searchOpen ? "Close sidebar filter" : "Filter sidebar"}
            aria-pressed={searchOpen}
            onClick={onToggleSearch}
            tone={searchOpen ? "accent" : "default"}
          >
            <PaGlyph.search />
          </SidebarRowActionButton>
          <SidebarRowActionButton
            title="Settings"
            aria-label="Open settings"
            onClick={onOpenSettings}
          >
            <PaGlyph.settings />
          </SidebarRowActionButton>
        </span>
      }
    />
  );
}

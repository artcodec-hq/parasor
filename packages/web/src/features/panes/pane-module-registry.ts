import type { PaneEntry, PaneKind } from "@parasor/shared";
import { PaGlyph } from "../../components/primitives/index.js";
import type { SidebarChild } from "../../components/sidebar/model/types.js";
import type { PaneDescriptor } from "../../components/sidebar/panes/types.js";

type ClosablePaneKind = "work-item" | "terminal" | "browser";

interface PaneModule {
  presentation: "body" | "layer";
  closableKind: ClosablePaneKind | null;
  ownsInnerChrome: boolean;
  describeSidebar?: (child: SidebarChild) => PaneDescriptor;
}

/**
 * Shared UI behavior for every pane kind. Keeping this record exhaustive makes
 * a new shared PaneKind fail type-checking until its workspace/sidebar behavior
 * is declared. Terminal remains a layer so its PTY lifecycle stays isolated
 * from ordinary focused-pane body rendering.
 */
const PANE_MODULES = {
  files: {
    presentation: "body",
    closableKind: null,
    ownsInnerChrome: false,
  },
  "work-item": {
    presentation: "body",
    closableKind: "work-item",
    ownsInnerChrome: true,
    describeSidebar: () => ({ defaultIcon: PaGlyph.doc }),
  },
  terminal: {
    presentation: "layer",
    closableKind: "terminal",
    ownsInnerChrome: true,
    describeSidebar: (child) => ({
      defaultIcon: child.agentType ? PaGlyph.agent : PaGlyph.terminal,
    }),
  },
  browser: {
    presentation: "body",
    closableKind: "browser",
    ownsInnerChrome: true,
    describeSidebar: () => ({ defaultIcon: PaGlyph.browser }),
  },
  git: {
    presentation: "body",
    closableKind: null,
    ownsInnerChrome: false,
  },
} satisfies Record<PaneKind, PaneModule>;

type WorkspaceBodyPaneKind = {
  [Kind in PaneKind]: (typeof PANE_MODULES)[Kind]["presentation"] extends "body"
    ? Kind
    : never;
}[PaneKind];

export type WorkspaceBodyPane = PaneEntry & {
  state: Extract<PaneEntry["state"], { kind: WorkspaceBodyPaneKind }>;
};

export function getPaneModule(kind: PaneKind): PaneModule {
  return PANE_MODULES[kind];
}

export function isWorkspaceBodyPane(
  pane: PaneEntry,
): pane is WorkspaceBodyPane {
  return getPaneModule(pane.state.kind).presentation === "body";
}

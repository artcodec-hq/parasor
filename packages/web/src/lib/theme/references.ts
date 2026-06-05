/**
 * VSCode color token reference defaults.
 *
 * Each entry expresses a `target ← source [* alpha]` relationship that
 * mirrors VSCode's `registerColor(id, { dark: <other-key> })` chains in
 * `colorRegistry.ts` / `theme/common/colors/*.ts`. When the target is
 * undefined after merging the user theme over the baseline, the resolver
 * fills it from the source (optionally applying an alpha modifier).
 *
 * Keep this list to entries VSCode itself defines as references -- parasor-
 * specific "smart fallbacks" do not belong here. If a key needs a fixed
 * color, put the hex in `_baseline/vscode-{dark,light}.json` instead.
 */
export type ColorReference = {
  target: string;
  source: string;
  /** Multiplied into the source's alpha channel (0..1). */
  alpha?: number;
};

export const VSCODE_REFERENCES: ColorReference[] = [
  // editor -> tab/terminal mirrors
  { target: "tab.activeBackground", source: "editor.background" },
  { target: "terminal.background", source: "editor.background" },
  {
    target: "terminal.selectionBackground",
    source: "editor.selectionBackground",
  },

  // terminal cursor -> terminal fg/bg
  { target: "terminalCursor.foreground", source: "terminal.foreground" },
  { target: "terminalCursor.background", source: "terminal.background" },

  // workbench foregrounds -> editor.foreground
  { target: "sideBar.foreground", source: "editor.foreground" },

  // descriptionForeground = transparent(foreground, 0.7)
  { target: "descriptionForeground", source: "editor.foreground", alpha: 0.7 },

  // editorWidget.border = transparent(editorWidgetForeground, 0.2),
  // and editorWidgetForeground itself defaults to editor.foreground.
  { target: "editorWidget.border", source: "editor.foreground", alpha: 0.2 },

  // button.secondaryBackground = list.hoverBackground
  { target: "button.secondaryBackground", source: "list.hoverBackground" },
];

import {
  makeBrowserPane,
  makeFilesPane,
  makeGitPane,
  makeTerminalPane,
  type PaneKind,
} from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { PaGlyph } from "../../components/primitives/index.js";
import type { SidebarChild } from "../../components/sidebar/model/types.js";
import { getPaneModule, isWorkspaceBodyPane } from "./pane-module-registry.js";

function sidebarChild(
  kind: SidebarChild["kind"],
  agentType?: string,
): SidebarChild {
  return {
    id: `${kind}:1`,
    kind,
    label: kind,
    status: "idle",
    pinned: false,
    ...(agentType ? { agentType } : {}),
  };
}

describe("pane module registry", () => {
  it("declares the presentation and chrome behavior for every pane kind", () => {
    const kinds: PaneKind[] = ["files", "terminal", "browser", "git"];

    expect(
      kinds.map((kind) => {
        const module = getPaneModule(kind);
        return [
          kind,
          module.presentation,
          module.closableKind,
          module.ownsInnerChrome,
        ];
      }),
    ).toEqual([
      ["files", "body", null, false],
      ["terminal", "layer", "terminal", true],
      ["browser", "body", "browser", true],
      ["git", "body", null, false],
    ]);
  });

  it("keeps terminal panes out of ordinary body rendering", () => {
    expect(isWorkspaceBodyPane(makeFilesPane("/repo"))).toBe(true);
    expect(isWorkspaceBodyPane(makeGitPane("/repo"))).toBe(true);
    expect(
      isWorkspaceBodyPane(
        makeBrowserPane("browser:1", "/repo", "https://example.com"),
      ),
    ).toBe(true);
    expect(
      isWorkspaceBodyPane(makeTerminalPane("terminal:1", "/repo", "s1")),
    ).toBe(false);
  });

  it("provides sidebar icons from the same pane modules", () => {
    const terminalModule = getPaneModule("terminal");
    const browserModule = getPaneModule("browser");

    expect(
      terminalModule.describeSidebar?.(sidebarChild("terminal")).defaultIcon,
    ).toBe(PaGlyph.terminal);
    expect(
      terminalModule.describeSidebar?.(sidebarChild("terminal", "codex"))
        .defaultIcon,
    ).toBe(PaGlyph.agent);
    expect(
      browserModule.describeSidebar?.(sidebarChild("browser")).defaultIcon,
    ).toBe(PaGlyph.browser);
  });
});

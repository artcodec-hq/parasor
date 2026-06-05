import type { ReactNode } from "react";
import { PaGlyph } from "../../../components/primitives/index.js";
import type { WorktreeTab } from "./WorktreeView.js";

interface WorktreeTabBarProps {
  activeTab: WorktreeTab;
  onChangeTab: (tab: WorktreeTab) => void;
}

interface TabOption {
  value: WorktreeTab;
  label: string;
  glyph: ReactNode;
}

const OPTIONS: readonly TabOption[] = [
  {
    value: "files",
    label: "Files",
    glyph: <PaGlyph.files />,
  },
  {
    value: "git",
    label: "Git",
    glyph: <PaGlyph.git />,
  },
];

/**
 * Files / Git tab bar -- each tab is `flex-1` so the bar always fills its
 * container with a 50/50 split. `h-full` lets the parent decide the row
 * height.
 *
 * Active state is a tinted background (`bg-bg-primary` over the secondary
 * chrome) plus accent-colored glyph + bold label -- no underline. This
 * reads as a true tab swap regardless of where the bar sits, and avoids
 * conflicting with the chrome row's own `border-b`.
 */
export function WorktreeTabBar({
  activeTab,
  onChangeTab,
}: WorktreeTabBarProps) {
  return (
    <div role="tablist" aria-label="Worktree view" className="flex h-full">
      {OPTIONS.map((opt) => {
        const active = opt.value === activeTab;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChangeTab(opt.value)}
            className={`inline-flex flex-1 items-center justify-center gap-2 text-sm transition-colors ${
              active
                ? "bg-bg-primary font-semibold text-text-primary"
                : "bg-transparent font-medium text-text-secondary hover:bg-row-hover-bg hover:text-text-primary"
            }`}
          >
            <span aria-hidden className={active ? "text-accent" : undefined}>
              {opt.glyph}
            </span>
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

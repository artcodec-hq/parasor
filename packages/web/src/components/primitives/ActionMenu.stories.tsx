import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  type ActionItem,
  ActionSheet,
  FloatingActionMenu,
} from "./ActionMenu.js";
import { PaButton } from "./PaButton.js";

const noop = () => undefined;

const ITEMS: ActionItem[] = [
  { id: "rename", label: "Rename", onSelect: noop },
  { id: "duplicate", label: "Duplicate", onSelect: noop },
  {
    id: "push",
    label: "Push branch",
    disabled: true,
    title: "No upstream branch",
    onSelect: noop,
  },
  {
    id: "remove",
    label: "Remove worktree",
    tone: "danger",
    separatorBefore: true,
    onSelect: noop,
  },
];

const meta = {
  title: "Foundations/Primitives/Action surfaces",
  parameters: {
    layout: "centered",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function ContextMenuExample() {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  return (
    <button
      type="button"
      className="h-[220px] w-[360px] rounded-window border border-border bg-bg-primary p-6 text-left text-sm text-text-secondary"
      onContextMenu={(event) => {
        event.preventDefault();
        setPoint({ x: event.clientX, y: event.clientY });
      }}
    >
      Right-click in this surface
      {point && (
        <FloatingActionMenu
          open={true}
          anchorPoint={point}
          items={ITEMS}
          onClose={() => setPoint(null)}
        />
      )}
    </button>
  );
}

function ActionSheetExample() {
  const [open, setOpen] = useState(true);
  return (
    <div className="h-[360px] w-[320px] bg-bg-primary p-6 text-text-primary">
      <PaButton onClick={() => setOpen(true)}>Open sheet</PaButton>
      <ActionSheet
        open={open}
        ariaLabel="File actions"
        title="docs/README.md"
        items={ITEMS}
        onDismiss={() => setOpen(false)}
        manageFocus={false}
      />
    </div>
  );
}

export const DropdownMenu: Story = {
  render: () => (
    <div className="min-h-[220px] w-[360px] bg-bg-primary p-6 text-text-primary">
      <FloatingActionMenu
        items={ITEMS}
        align="start"
        renderTrigger={({ open, toggle, triggerRef, menuId }) => (
          <PaButton
            ref={triggerRef}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={toggle}
          >
            Worktree menu
          </PaButton>
        )}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    );
    button?.click();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    const menu = canvasElement.querySelector('[role="menu"]');
    if (!menu) throw new Error("Expected inline dropdown menu to open");
  },
};

export const ClippedDropdown: Story = {
  render: () => (
    <div className="w-[260px] overflow-hidden rounded-window border border-border bg-bg-primary p-4 text-text-primary">
      <div className="flex w-[520px] items-center gap-2">
        <span className="text-sm text-text-secondary">feature branch</span>
        <FloatingActionMenu
          items={ITEMS}
          align="start"
          portal={true}
          renderTrigger={({ open, toggle, triggerRef, menuId }) => (
            <button
              ref={triggerRef}
              type="button"
              className="cm-mono rounded-tag border border-accent/40 bg-accent/10 px-1.5 text-xs text-accent"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={menuId}
              onClick={toggle}
            >
              origin/topic
            </button>
          )}
        />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    );
    button?.click();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    const menu = document.querySelector('[role="menu"]');
    if (!menu) throw new Error("Expected portalled dropdown menu to open");
    if (canvasElement.contains(menu)) {
      throw new Error("Expected clipped dropdown menu to be portalled");
    }
  },
};

export const ContextMenu: Story = {
  render: () => <ContextMenuExample />,
};

export const ActionSheetOpen: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  render: () => <ActionSheetExample />,
  play: async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("Expected action sheet dialog to render");
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaButton } from "./PaButton.js";
import { PaMenu, type PaMenuItem } from "./PaMenu.js";

const noop = () => undefined;

const ITEMS: PaMenuItem[] = [
  { id: "rename", label: "Rename", onSelect: noop },
  { id: "duplicate", label: "Duplicate", onSelect: noop },
  {
    id: "push",
    label: "Push branch",
    disabled: true,
    title: "No upstream branch",
    onSelect: noop,
  },
  { id: "remove", label: "Remove worktree", onSelect: noop },
];

const meta = {
  title: "Foundations/Primitives/Core controls",
  component: PaMenu,
  parameters: {
    layout: "centered",
    controls: {
      include: ["align", "placement"],
    },
  },
  argTypes: {
    align: {
      control: "radio",
      options: ["start", "end"],
    },
    placement: {
      control: "radio",
      options: ["bottom", "top"],
    },
    items: {
      table: { disable: true },
    },
    renderTrigger: {
      table: { disable: true },
    },
  },
  args: {
    items: ITEMS,
    align: "start",
    placement: "bottom",
    renderTrigger: () => null,
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const DropdownMenu: Story = {
  render: (args) => (
    <div className="min-h-[220px] w-[360px] bg-bg-primary p-6 text-text-primary">
      <PaMenu
        items={ITEMS}
        align={args.align}
        placement={args.placement}
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
    const menu = document.querySelector('[role="menu"]');
    if (!menu) throw new Error("Expected menu to open");
  },
};

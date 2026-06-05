import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaButton } from "./PaButton.js";
import { PaGlyph } from "./PaGlyph.js";
import { PaneHeader, type PaneHeaderIconTone } from "./PaneHeader.js";

const noop = () => undefined;

const ICON_TONE_OPTIONS: PaneHeaderIconTone[] = ["accent", "warning"];

const meta = {
  title: "Foundations/Primitives/Core controls",
  component: PaneHeader,
  parameters: {
    layout: "centered",
    controls: {
      include: ["title", "subtitle", "iconTone", "titleMono", "desktopOnly"],
    },
  },
  argTypes: {
    iconTone: {
      control: "radio",
      options: ICON_TONE_OPTIONS,
    },
    titleMono: {
      control: "boolean",
    },
    desktopOnly: {
      control: "boolean",
    },
  },
  args: {
    title: "codex",
    subtitle: "/Users/akibe/Repos/parasor",
    iconTone: "accent",
    titleMono: false,
    desktopOnly: false,
  },
} satisfies Meta<typeof PaneHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PaneHeaderChrome: Story = {
  render: (args) => (
    <div className="w-[680px] overflow-hidden rounded-window border border-border bg-bg-primary text-text-primary">
      <PaneHeader
        {...args}
        icon={<PaGlyph.terminal />}
        actions={
          <div className="flex items-center gap-1.5">
            <span className="cm-mono text-xs text-text-secondary">120x34</span>
            <PaButton size="xs" kind="dismiss" onClick={noop}>
              Restart
            </PaButton>
          </div>
        }
      />
      <div className="h-24 p-4 text-sm text-text-secondary">
        Waiting for command output...
      </div>
    </div>
  ),
};

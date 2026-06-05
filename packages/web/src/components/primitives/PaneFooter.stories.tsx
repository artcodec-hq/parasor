import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaButton } from "./PaButton.js";
import { PaneFooter, type PaneFooterTone } from "./PaneFooter.js";

const noop = () => undefined;

const TONE_OPTIONS: PaneFooterTone[] = ["pane", "sidebar"];

const meta = {
  title: "Foundations/Primitives/Core controls",
  component: PaneFooter,
  parameters: {
    layout: "centered",
    controls: {
      include: ["status", "tone", "desktopOnly"],
    },
  },
  argTypes: {
    status: {
      control: "text",
    },
    tone: {
      control: "radio",
      options: TONE_OPTIONS,
    },
    desktopOnly: {
      control: "boolean",
    },
  },
  args: {
    status: "Connected",
    tone: "pane",
    desktopOnly: false,
  },
} satisfies Meta<typeof PaneFooter>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PaneFooterChrome: Story = {
  render: (args) => (
    <div className="w-[620px] overflow-hidden rounded-window border border-border bg-bg-primary text-text-primary">
      <div className="h-24 p-4 text-sm text-text-secondary">Pane content</div>
      <PaneFooter
        {...args}
        actions={
          <div className="flex items-center gap-1.5">
            <PaButton size="xs" kind="normal" onClick={noop}>
              Open logs
            </PaButton>
            <PaButton size="xs" kind="dismiss" onClick={noop}>
              Clear
            </PaButton>
          </div>
        }
      />
    </div>
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { StateCard, type StateCardTone } from "./StateCard.js";

const noop = () => undefined;

const TONE_OPTIONS: StateCardTone[] = ["err", "warn", "info"];

const meta = {
  title: "Foundations/Primitives/Core controls",
  component: StateCard,
  parameters: {
    layout: "centered",
    controls: {
      include: ["tone", "tag", "title", "body"],
    },
  },
  argTypes: {
    tone: {
      control: "radio",
      options: TONE_OPTIONS,
    },
    tag: {
      control: "text",
    },
    title: {
      control: "text",
    },
    body: {
      control: "text",
    },
  },
  args: {
    tone: "err",
    tag: undefined,
    title: "Session failed",
    body: "The PTY host exited unexpectedly.",
  },
} satisfies Meta<typeof StateCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const StateCardMessage: Story = {
  render: (args) => (
    <StateCard
      {...args}
      primary={{ label: "Retry", onClick: noop }}
      secondary={{ label: "Close", onClick: noop }}
    />
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AgentDotState } from "./AgentDot.js";
import { AgentDot } from "./AgentDot.js";

const STATE_OPTIONS: AgentDotState[] = [
  "idle",
  "working",
  "attention",
  "review",
  "none",
];

const meta = {
  title: "Foundations/Primitives/Core controls",
  component: AgentDot,
  parameters: {
    layout: "centered",
    controls: {
      include: ["state", "size", "title"],
    },
  },
  argTypes: {
    state: {
      control: "radio",
      options: STATE_OPTIONS,
    },
    size: {
      control: { type: "number", min: 8, max: 32, step: 1 },
    },
    title: {
      control: "text",
    },
  },
  args: {
    state: "working",
    size: 16,
    title: "working agent",
  },
} satisfies Meta<typeof AgentDot>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AgentStatusDot: Story = {};

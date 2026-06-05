import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaKbd } from "./PaKbd.js";

const meta = {
  title: "Foundations/Primitives/Core controls",
  component: PaKbd,
  parameters: {
    layout: "centered",
    controls: {
      include: ["children"],
    },
  },
  argTypes: {
    children: {
      control: "text",
    },
  },
  args: {
    children: "⌘",
  },
} satisfies Meta<typeof PaKbd>;

export default meta;

type Story = StoryObj<typeof meta>;

export const KeyboardGlyph: Story = {};

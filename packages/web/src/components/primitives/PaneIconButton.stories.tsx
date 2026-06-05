import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  PaGlyph,
  PaneIconButton,
  type PaneIconButtonSize,
  type PaneIconButtonTone,
} from "./index.js";

const noop = () => undefined;

const SIZE_OPTIONS: PaneIconButtonSize[] = ["sm", "md"];
const TONE_OPTIONS: PaneIconButtonTone[] = [
  "normal",
  "active",
  "accent",
  "danger",
];

const meta = {
  title: "Foundations/Primitives/Core controls",
  component: PaneIconButton,
  parameters: {
    layout: "centered",
    controls: {
      include: ["label", "size", "tone", "pressed", "disabled"],
    },
  },
  argTypes: {
    label: {
      control: "text",
    },
    size: {
      control: "radio",
      options: SIZE_OPTIONS,
    },
    tone: {
      control: "radio",
      options: TONE_OPTIONS,
    },
    pressed: {
      control: "boolean",
    },
    disabled: {
      control: "boolean",
    },
    children: {
      table: { disable: true },
    },
  },
  args: {
    label: "Refresh",
    size: "sm",
    tone: "normal",
    pressed: undefined,
    disabled: false,
    children: <PaGlyph.refresh />,
    onClick: noop,
  },
} satisfies Meta<typeof PaneIconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PaneIconAction: Story = {
  render: (args) => (
    <PaneIconButton {...args}>
      <PaGlyph.refresh />
    </PaneIconButton>
  ),
};

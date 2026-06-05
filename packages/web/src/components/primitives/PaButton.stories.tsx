import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PaButtonKind, PaButtonSize } from "./PaButton.js";
import { PaButton } from "./PaButton.js";

const noop = () => undefined;

const KIND_OPTIONS: PaButtonKind[] = ["submit", "destroy", "normal", "dismiss"];
const SIZE_OPTIONS: PaButtonSize[] = ["sm", "xs"];

const meta = {
  title: "Foundations/Primitives/Core controls",
  component: PaButton,
  parameters: {
    layout: "centered",
    controls: {
      include: ["children", "kind", "size", "disabled"],
    },
  },
  argTypes: {
    kind: {
      control: "radio",
      options: KIND_OPTIONS,
    },
    size: {
      control: "radio",
      options: SIZE_OPTIONS,
    },
    disabled: {
      control: "boolean",
    },
    children: {
      control: "text",
    },
  },
  args: {
    children: "Button",
    kind: "normal",
    size: "sm",
    disabled: false,
    onClick: noop,
  },
} satisfies Meta<typeof PaButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Buttons: Story = {};

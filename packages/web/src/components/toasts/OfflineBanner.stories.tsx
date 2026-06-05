import type { Meta, StoryObj } from "@storybook/react-vite";
import { OfflineDialog } from "./OfflineBanner.js";

const noop = () => undefined;

const meta = {
  title: "Patterns/Overlays/Offline blocking alert",
  component: OfflineDialog,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof OfflineDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Visible: Story = {
  args: {
    onReload: noop,
  },
};

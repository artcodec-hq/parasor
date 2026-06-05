import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClosePaneDialog } from "./ClosePaneDialog.js";
import { DeleteProjectDialog } from "./DeleteProjectDialog.js";

const noop = () => undefined;

const meta = {
  title: "Patterns/Dialogs/Workspace",
  parameters: {
    layout: "fullscreen",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const CloseTerminalPane: Story = {
  render: () => (
    <ClosePaneDialog
      paneTitle="codex"
      paneKind="terminal"
      onCancel={noop}
      onConfirm={noop}
    />
  ),
};

export const CloseBrowserPane: Story = {
  render: () => (
    <ClosePaneDialog
      paneTitle="Preview"
      paneKind="browser"
      onCancel={noop}
      onConfirm={noop}
    />
  ),
};

export const CloseProject: Story = {
  render: () => (
    <DeleteProjectDialog
      projectName="parasor"
      onCancel={noop}
      onConfirm={noop}
    />
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MOBILE_VIEWPORT_GLOBALS } from "../../stories/storybook-viewports.js";
import { CommitDialog, type CommitFileEntry } from "./CommitDialog.js";

const files: CommitFileEntry[] = [
  {
    path: "packages/web/src/components/primitives/DialogShell.tsx",
    status: "M",
  },
  {
    path: "packages/web/src/components/overlays/CommitDialog.tsx",
    status: "M",
  },
  { path: "docs/commit-dialog-shell.md", status: "A" },
];

const noop = () => undefined;

const meta = {
  title: "Patterns/Dialogs/Commit",
  parameters: {
    layout: "fullscreen",
  },
  args: {
    open: true,
    branchName: "feature/dialog-shell",
    files,
    isMobile: false,
    onClose: noop,
    onCommit: noop,
  },
  component: CommitDialog,
} satisfies Meta<typeof CommitDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const Busy: Story = {
  args: {
    busy: true,
  },
};

export const ErrorMessage: Story = {
  args: {
    error: "Commit failed: please resolve hooks and try again.",
  },
};

export const Mobile: Story = {
  args: {
    isMobile: true,
  },
  globals: MOBILE_VIEWPORT_GLOBALS,
};

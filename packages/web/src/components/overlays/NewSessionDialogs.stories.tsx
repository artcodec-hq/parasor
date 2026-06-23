import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  type CustomPaneCommand,
  paneCommandsWithBuiltins,
} from "../../lib/pane-command-store.js";
import { MOBILE_VIEWPORT_GLOBALS } from "../../stories/storybook-viewports.js";
import { NewSessionDialog } from "./NewSessionDialog.js";

const project = {
  id: "project-1",
  name: "parasor",
  path: "/Users/akibe/Repos/github.com/akibe/parasor",
};

const worktree = {
  id: "worktree-1",
  name: "feature/dialog-shell",
  path: "/Users/akibe/Repos/github.com/akibe/parasor",
};

const customCommands: CustomPaneCommand[] = [
  { id: "cmd:dev", label: "Dev server", initialInput: "pnpm dev" },
  {
    id: "cmd:test",
    label: "Focused tests",
    initialInput: "pnpm --filter @parasor/web test",
  },
];

const noop = () => undefined;

function StoryDialog({
  isMobile = false,
  includeWorktreeAction = false,
  emptyCommands = false,
}: {
  isMobile?: boolean;
  includeWorktreeAction?: boolean;
  emptyCommands?: boolean;
}) {
  return (
    <NewSessionDialog
      open
      project={project}
      worktree={worktree}
      commands={paneCommandsWithBuiltins(emptyCommands ? [] : customCommands)}
      commandConfigs={emptyCommands ? [] : customCommands}
      isMobile={isMobile}
      loadLocalFiles={async () => ({
        candidates: [
          { path: "config/local-preview.json", size: 128 },
          { path: "tmp/session-preview.log", size: 2048 },
        ],
        rememberedPaths: ["config/local-preview.json"],
      })}
      onClose={noop}
      onCommandsChange={noop}
      onRunCommand={noop}
      onCreateWorktreeSession={includeWorktreeAction ? noop : undefined}
    />
  );
}

const meta = {
  title: "Patterns/Dialogs/New session",
  parameters: {
    layout: "fullscreen",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  render: () => <StoryDialog />,
};

export const Mobile: Story = {
  render: () => <StoryDialog isMobile />,
  globals: MOBILE_VIEWPORT_GLOBALS,
};

export const WithNewWorktreeAction: Story = {
  render: () => <StoryDialog includeWorktreeAction />,
};

export const EmptyCommands: Story = {
  render: () => <StoryDialog emptyCommands />,
};

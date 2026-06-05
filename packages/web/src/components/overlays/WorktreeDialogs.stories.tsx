import type { Meta, StoryObj } from "@storybook/react-vite";
import { NewWorktreeDialog } from "./NewWorktreeDialog.js";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog.js";
import { RenameWorktreeDialog } from "./RenameWorktreeDialog.js";

const noop = () => undefined;
const project = {
  id: "p-parasor",
  name: "parasor",
  path: "/Users/akibe/Repos/github.com/akibe/parasor",
};

const meta = {
  title: "Patterns/Dialogs/Worktree",
  parameters: {
    layout: "fullscreen",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const RenameBranch: Story = {
  render: () => (
    <RenameWorktreeDialog
      open
      currentBranch="feature/dialog-shell"
      onClose={noop}
      onSubmit={noop}
    />
  ),
};

export const RenameBranchBusy: Story = {
  render: () => (
    <RenameWorktreeDialog
      open
      currentBranch="feature/dialog-shell"
      busy
      onClose={noop}
      onSubmit={noop}
    />
  ),
};

export const RenameBranchError: Story = {
  render: () => (
    <RenameWorktreeDialog
      open
      currentBranch="feature/dialog-shell"
      error="A branch with this name already exists."
      onClose={noop}
      onSubmit={noop}
    />
  ),
};

export const NewWorktree: Story = {
  render: () => (
    <NewWorktreeDialog
      open
      project={project}
      loadLocalFiles={async () => ({
        candidates: [],
        rememberedPaths: [],
      })}
      onClose={noop}
      onCreate={noop}
    />
  ),
};

export const NewWorktreeWithLocalFiles: Story = {
  render: () => (
    <NewWorktreeDialog
      open
      project={project}
      loadLocalFiles={async () => ({
        candidates: [
          { path: "config/local-preview.json", size: 237 },
          { path: "tmp/session-preview.json", size: 2476 },
        ],
        rememberedPaths: ["config/local-preview.json"],
      })}
      onClose={noop}
      onCreate={noop}
    />
  ),
};

export const NewWorktreeLoadingLocalFiles: Story = {
  render: () => (
    <NewWorktreeDialog
      open
      project={project}
      loadLocalFiles={() => new Promise(() => undefined)}
      onClose={noop}
      onCreate={noop}
    />
  ),
};

export const NewWorktreeBusy: Story = {
  render: () => (
    <NewWorktreeDialog
      open
      project={project}
      busy
      loadLocalFiles={async () => ({
        candidates: [],
        rememberedPaths: [],
      })}
      onClose={noop}
      onCreate={noop}
    />
  ),
};

export const NewWorktreeError: Story = {
  render: () => (
    <NewWorktreeDialog
      open
      project={project}
      error="A branch with this name already exists."
      loadLocalFiles={async () => ({
        candidates: [],
        rememberedPaths: [],
      })}
      onClose={noop}
      onCreate={noop}
    />
  ),
};

export const RemoveCleanWorktree: Story = {
  render: () => (
    <RemoveWorktreeDialog
      open
      branch="feature/dialog-shell"
      worktreePath="/Users/akibe/Repos/github.com/akibe/parasor-worktrees/dialog-shell"
      dirtyCount={0}
      onClose={noop}
      onSubmit={noop}
    />
  ),
};

export const RemoveDirtyWorktree: Story = {
  render: () => (
    <RemoveWorktreeDialog
      open
      branch="feature/dialog-shell"
      worktreePath="/Users/akibe/Repos/github.com/akibe/parasor-worktrees/dialog-shell"
      dirtyCount={3}
      onClose={noop}
      onSubmit={noop}
    />
  ),
};

export const RemoveOrphanWorktree: Story = {
  render: () => (
    <RemoveWorktreeDialog
      open
      branch="feature/dialog-shell"
      worktreePath="/Users/akibe/Repos/github.com/akibe/parasor-worktrees/dialog-shell"
      dirtyCount={3}
      orphan
      onClose={noop}
      onSubmit={noop}
    />
  ),
};

export const RemoveWorktreeError: Story = {
  render: () => (
    <RemoveWorktreeDialog
      open
      branch="feature/dialog-shell"
      worktreePath="/Users/akibe/Repos/github.com/akibe/parasor-worktrees/dialog-shell"
      dirtyCount={0}
      error="The worktree is locked by another process."
      onClose={noop}
      onSubmit={noop}
    />
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PaGlyph } from "../../components/primitives/index.js";
import { MOBILE_VIEWPORT_GLOBALS } from "../../stories/storybook-viewports.js";
import { AppShellSplit } from "./AppShellSplit.js";
import { EditablePaneTitle } from "./views/EditablePaneTitle.js";
import { PaneCloseButton } from "./views/PaneCloseButton.js";
import { PinToggleButton } from "./views/PinToggleButton.js";
import type { SessionPaneView } from "./views/SessionPaneHeader.js";
import { SessionPaneHeader } from "./views/SessionPaneHeader.js";
import { Split2Col } from "./views/Split2Col.js";
import { WorktreeTabBar } from "./views/WorktreeTabBar.js";
import type { WorktreeTab } from "./views/WorktreeView.js";
import { WorktreeView } from "./views/WorktreeView.js";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState.js";

const noop = () => undefined;

function Panel({
  label,
  tone = "secondary",
}: {
  label: string;
  tone?: "primary" | "secondary";
}) {
  return (
    <div
      className={`flex h-full min-h-[160px] items-center justify-center p-4 text-sm ${
        tone === "primary"
          ? "bg-bg-primary text-text-secondary"
          : "bg-bg-secondary text-text-secondary"
      }`}
    >
      {label}
    </div>
  );
}

const meta = {
  title: "Workspace/Chrome",
  parameters: {
    layout: "fullscreen",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptyNoProject: Story = {
  render: () => (
    <div className="h-screen bg-bg-primary text-text-primary">
      <WorkspaceEmptyState
        activeProjectId={null}
        hydrated
        onNewProject={noop}
      />
    </div>
  ),
};

export const EmptyWithProject: Story = {
  render: () => (
    <div className="h-screen bg-bg-primary text-text-primary">
      <WorkspaceEmptyState
        activeProjectId="project-parasor"
        hydrated
        onNewProject={noop}
      />
    </div>
  ),
};

export const EmptyHydrating: Story = {
  render: () => (
    <div className="h-screen bg-bg-primary text-text-primary">
      <WorkspaceEmptyState
        activeProjectId={null}
        hydrated={false}
        onNewProject={noop}
      />
    </div>
  ),
};

export const HeaderTerminal: Story = {
  render: function HeaderTerminalStory() {
    const [pinned, setPinned] = useState(true);
    return (
      <div className="h-screen bg-bg-primary pt-10 text-text-primary">
        <SessionPaneHeader
          crumbs={[
            { label: "parasor", dim: true },
            {
              label: "feature/storybook",
              glyph: <PaGlyph.git />,
              maxWidth: 220,
            },
            { label: "codex", maxWidth: 180 },
          ]}
          dirty={4}
          onToggleDrawer={noop}
          pin={{ pinned, onToggle: () => setPinned((current) => !current) }}
          onClose={noop}
          moreMenuItems={[
            { id: "rename", label: "Rename", onSelect: noop },
            { id: "restart", label: "Restart", onSelect: noop },
            {
              id: "push",
              label: "Push branch",
              disabled: true,
              title: "No upstream branch",
              onSelect: noop,
            },
          ]}
        />
        <Panel label="terminal pane" tone="primary" />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const pin = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-label="Unpin from Monitor"]',
    );
    pin?.click();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (
      !canvasElement.querySelector<HTMLButtonElement>(
        'button[aria-label="Pin to Monitor"]',
      )
    ) {
      throw new Error("Expected pin toggle to update aria-label");
    }
  },
};

export const HeaderMobileWorktree: Story = {
  render: function HeaderMobileWorktreeStory() {
    const [view, setView] = useState<SessionPaneView>("files");
    return (
      <div
        className="h-screen bg-bg-primary text-text-primary"
        style={{ width: 390 }}
      >
        <SessionPaneHeader
          crumbs={[
            { label: "parasor", dim: true },
            { label: "feature/storybook", glyph: <PaGlyph.git /> },
          ]}
          onBack={noop}
          onToggleDrawer={noop}
          view={view}
          onChangeView={setView}
          dirty={2}
        />
        <Panel label={`${view} view`} tone="primary" />
      </div>
    );
  },
  globals: MOBILE_VIEWPORT_GLOBALS,
};

export const WorktreeTabs: Story = {
  render: function WorktreeTabsStory() {
    const [activeTab, setActiveTab] = useState<WorktreeTab>("files");
    return (
      <div className="h-bar w-[360px] border border-border bg-tab-strip-bg text-text-primary">
        <WorktreeTabBar activeTab={activeTab} onChangeTab={setActiveTab} />
      </div>
    );
  },
};

export const EditableTitle: Story = {
  render: () => (
    <div className="flex h-screen items-start bg-bg-primary p-8 text-text-primary">
      <EditablePaneTitle value="codex" onSave={noop} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const rename = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-label="Rename terminal"]',
    );
    rename?.click();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (!canvasElement.querySelector('input[aria-label="Terminal title"]')) {
      throw new Error("Expected title to enter edit mode");
    }
  },
};

export const IconButtons: Story = {
  render: function IconButtonsStory() {
    const [pinned, setPinned] = useState(false);
    return (
      <div className="flex h-screen items-start gap-2 bg-bg-primary p-8 text-text-primary">
        <PinToggleButton
          pinned={pinned}
          onToggle={() => setPinned((current) => !current)}
        />
        <PaneCloseButton onClick={noop} />
      </div>
    );
  },
};

export const WorktreeContainer: Story = {
  render: () => (
    <div className="h-screen bg-bg-primary text-text-primary">
      <WorktreeView activeTab="files" worktreeName="feature/storybook">
        <Panel label="worktree body" tone="primary" />
      </WorktreeView>
    </div>
  ),
};

export const SplitDesktop: Story = {
  render: () => (
    <div className="h-screen bg-bg-primary text-text-primary">
      <Split2Col
        storageKey="storybook-worktree"
        defaultRatio={[35, 65]}
        isMobile={false}
        primary={<Panel label="file tree" />}
        secondary={<Panel label="editor" tone="primary" />}
      />
    </div>
  ),
};

export const SplitMobileSecondary: Story = {
  render: () => (
    <div
      className="h-screen bg-bg-primary text-text-primary"
      style={{ width: 390 }}
    >
      <Split2Col
        storageKey="storybook-worktree-mobile"
        defaultRatio={[35, 65]}
        isMobile
        secondaryActive
        primary={<Panel label="file tree" />}
        secondary={<Panel label="editor" tone="primary" />}
      />
    </div>
  ),
  globals: MOBILE_VIEWPORT_GLOBALS,
};

export const AppShell: Story = {
  render: () => (
    <div className="h-screen bg-bg-primary text-text-primary">
      <AppShellSplit
        navigation={<Panel label="sidebar" />}
        main={<Panel label="workspace" tone="primary" />}
      />
    </div>
  ),
};

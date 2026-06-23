import type { PortInfo } from "@parasor/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PaGlyph } from "../primitives/index.js";
import type {
  SidebarChild,
  SidebarProject,
  SidebarSelection,
  SidebarWorktree,
} from "./model/types.js";
import { NetworkPortCenter } from "./NetworkPortCenter.js";
import {
  SidebarRow,
  SidebarRowActionButton,
  SidebarRowIcon,
  SidebarRowLabel,
} from "./primitives/index.js";
import { ChildRow } from "./rows/ChildRow.js";
import { MonitorRow } from "./rows/MonitorRow.js";
import { ProjectGroup } from "./rows/ProjectGroup.js";
import { WorktreeChildren } from "./rows/WorktreeChildren.js";
import { WorktreeRow } from "./rows/WorktreeRow.js";
import { WorktreeRowActions } from "./rows/WorktreeRowActions.js";
import { SidebarFooter } from "./SidebarFooter.js";
import { SidebarSearchRow } from "./SidebarSearchRow.js";

const noop = () => undefined;

const selection: SidebarSelection = {
  monitor: false,
  selectedWorktreeId: "wt-main",
  selectedChildId: "terminal-codex",
};

const children: SidebarChild[] = [
  {
    id: "terminal-codex",
    kind: "terminal",
    label: "codex",
    hint: "gpt-5.5",
    status: "working",
    pinned: true,
  },
  {
    id: "terminal-review",
    kind: "terminal",
    label: "review",
    hint: "pnpm test",
    status: "attention",
    pinned: false,
  },
  {
    id: "browser-storybook",
    kind: "browser",
    label: "Storybook",
    hint: "localhost:6006",
    status: "idle",
    pinned: false,
    auto: true,
  },
];

const worktree: SidebarWorktree = {
  id: "wt-main",
  name: "feature/storybook",
  path: "/Users/akibe/Repos/github.com/akibe/parasor",
  active: true,
  dirty: 3,
  ahead: 1,
  behind: 0,
  children,
  hasWorkingChild: true,
  hasAlertChild: true,
};

const project: SidebarProject = {
  id: "project-parasor",
  name: "parasor",
  path: "/Users/akibe/Repos/github.com/akibe/parasor",
  pinned: false,
  readOnly: false,
  worktrees: [worktree],
};

function SidebarSurface({
  children,
  width = 320,
}: {
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      className="min-h-[360px] overflow-hidden rounded-window border border-border bg-bg-secondary text-text-primary"
      style={{ width }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Components/Navigation/Sidebar parts",
  parameters: {
    layout: "centered",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const RowPrimitives: Story = {
  render: () => (
    <SidebarSurface>
      <SidebarRow selected onClick={noop}>
        <SidebarRowIcon tone="accent">
          <PaGlyph.monitor />
        </SidebarRowIcon>
        <SidebarRowLabel selected>Selected row</SidebarRowLabel>
        <SidebarRowActionButton aria-label="Add" tone="accent">
          <PaGlyph.add />
        </SidebarRowActionButton>
      </SidebarRow>
      <SidebarRow depth={1} hint="Nested row" onClick={noop}>
        <SidebarRowIcon tone="secondary">
          <PaGlyph.terminal />
        </SidebarRowIcon>
        <SidebarRowLabel>Nested row</SidebarRowLabel>
        <SidebarRowActionButton aria-label="Remove" tone="dangerPrimaryHover">
          <PaGlyph.close />
        </SidebarRowActionButton>
      </SidebarRow>
      <SidebarRow>
        <SidebarRowIcon tone="warning">
          <PaGlyph.attention />
        </SidebarRowIcon>
        <SidebarRowLabel weight="medium">Static warning row</SidebarRowLabel>
      </SidebarRow>
    </SidebarSurface>
  ),
};

export const MonitorRows: Story = {
  render: () => (
    <SidebarSurface>
      <MonitorRow selected pinnedCount={4} onClick={noop} />
      <MonitorRow selected={false} pinnedCount={0} onClick={noop} />
    </SidebarSurface>
  ),
};

export const ChildRows: Story = {
  render: () => (
    <SidebarSurface>
      <ChildRow
        child={children[0]}
        selected
        onClick={noop}
        onTogglePin={noop}
      />
      <ChildRow
        child={children[1]}
        selected={false}
        onClick={noop}
        onTogglePin={noop}
      />
      <ChildRow child={children[2]} selected={false} onClick={noop} />
    </SidebarSurface>
  ),
};

export const WorktreeRows: Story = {
  render: () => (
    <SidebarSurface width={360}>
      <WorktreeRow
        project={project}
        worktree={worktree}
        selection={selection}
        forceOpen
        onSelectWorktree={noop}
        onSelectChild={noop}
        onNewSession={noop}
        onToggleChildPin={noop}
      />
      <WorktreeRow
        project={project}
        worktree={{
          ...worktree,
          id: "wt-agent",
          name: "agent/refactor",
          path: "/tmp/parasor-agent",
          active: false,
          dirty: 0,
          children: [],
          origin: "agent",
          orphan: true,
        }}
        selection={{ ...selection, selectedWorktreeId: null }}
        onSelectWorktree={noop}
        onNewSession={noop}
      />
    </SidebarSurface>
  ),
};

export const ProjectGroupFallback: Story = {
  render: () => (
    <SidebarSurface width={360}>
      <ProjectGroup
        project={{
          ...project,
          isRepo: false,
          readOnly: true,
          worktrees: [],
        }}
        selection={{
          monitor: false,
          selectedWorktreeId: null,
          selectedChildId: null,
        }}
        forceOpen
        onSelectWorktree={noop}
        onNewSession={noop}
      />
    </SidebarSurface>
  ),
};

export const WorktreeChildrenList: Story = {
  render: () => (
    <SidebarSurface>
      <WorktreeChildren
        project={project}
        worktree={worktree}
        selection={selection}
        onSelectChild={noop}
        onToggleChildPin={noop}
      />
    </SidebarSurface>
  ),
};

export const WorktreeChildrenEmpty: Story = {
  render: () => (
    <SidebarSurface>
      <WorktreeChildren
        project={project}
        worktree={{ ...worktree, children: [] }}
        selection={selection}
        onSelectChild={noop}
      />
      <div className="px-3 py-4 text-sm text-text-secondary">
        No child panes
      </div>
    </SidebarSurface>
  ),
};

export const WorktreeActions: Story = {
  render: () => (
    <SidebarSurface>
      <div className="flex h-bar items-center gap-2 px-3">
        <span className="flex-1 text-sm text-text-secondary">
          feature/storybook
        </span>
        <WorktreeRowActions label="feature/storybook" onNewSession={noop} />
      </div>
      <div className="flex h-bar items-center gap-2 px-3">
        <span className="flex-1 text-sm text-text-secondary">read only</span>
        <WorktreeRowActions label="read only" />
      </div>
    </SidebarSurface>
  ),
};

export const SearchRow: Story = {
  render: function SearchRowStory() {
    const [query, setQuery] = useState("story");
    return (
      <SidebarSurface>
        <SidebarSearchRow
          query={query}
          onQueryChange={setQuery}
          onClose={noop}
        />
      </SidebarSurface>
    );
  },
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>(
      'input[aria-label="Filter sidebar"]',
    );
    if (!input) throw new Error("Expected sidebar filter input");
  },
};

const portsByProjectId: Record<string, PortInfo[]> = {
  "project-parasor": [
    { port: 6006, pid: 10, bindsAll: false, reachable: true },
    { port: 7682, pid: 11, bindsAll: false, reachable: false },
  ],
};

export const NetworkPorts: Story = {
  render: () => (
    <SidebarSurface>
      <div className="p-3">
        <NetworkPortCenter
          connected
          portsByProjectId={portsByProjectId}
          projectNames={{ "project-parasor": "parasor" }}
          onOpenUrl={noop}
        />
      </div>
    </SidebarSurface>
  ),
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-label="Network ports"]',
    );
    trigger?.click();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (!document.body.textContent?.includes("Detected ports")) {
      throw new Error("Expected detected ports popover");
    }
  },
};

export const FooterStates: Story = {
  render: () => (
    <SidebarSurface>
      <div className="flex h-[304px] flex-col justify-end">
        <SidebarFooter
          connected
          portsByProjectId={portsByProjectId}
          projectNames={{ "project-parasor": "parasor" }}
          onOpenUrl={noop}
          onNewProject={noop}
          onOpenSettings={noop}
          onToggleSearch={noop}
        />
        <SidebarFooter
          connected={false}
          searchOpen
          onNewProject={noop}
          onOpenSettings={noop}
          onToggleSearch={noop}
        />
      </div>
    </SidebarSurface>
  ),
};

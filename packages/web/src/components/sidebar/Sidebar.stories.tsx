import type { PortInfo } from "@parasor/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type CSSProperties, type ReactNode, useState } from "react";
import { MOBILE_VIEWPORT_GLOBALS } from "../../stories/storybook-viewports.js";
import type { SidebarProject, SidebarSelection } from "./model/types.js";
import { Sidebar } from "./Sidebar.js";

const noop = () => undefined;

const selection: SidebarSelection = {
  monitor: false,
  selectedChildId: "terminal:codex",
  selectedWorktreeId: "wt:main",
};

const projects: SidebarProject[] = [
  {
    id: "project-parasor",
    name: "parasor",
    path: "/Users/akibe/Repos/github.com/akibe/parasor",
    pinned: false,
    readOnly: false,
    worktrees: [
      {
        id: "wt:main",
        name: "main",
        path: "/Users/akibe/Repos/github.com/akibe/parasor",
        active: true,
        dirty: 3,
        dirtyAdded: 24,
        dirtyDeleted: 1,
        ahead: 0,
        behind: 0,
        children: [
          {
            id: "terminal:codex",
            kind: "terminal",
            label: "codex",
            hint: "gpt-5.5",
            status: "working",
            pinned: true,
          },
          {
            id: "browser:storybook",
            kind: "browser",
            label: "Storybook",
            hint: "localhost:6006",
            status: "idle",
            pinned: false,
            auto: true,
          },
        ],
        hasWorkingChild: true,
        hasAlertChild: false,
      },
      {
        id: "wt:dialog-cleanup",
        name: "dialog-cleanup",
        path: "/Users/akibe/Repos/github.com/akibe/parasor-dialog-cleanup",
        active: false,
        dirty: 0,
        ahead: 0,
        behind: 0,
        children: [
          {
            id: "terminal:lint",
            kind: "terminal",
            label: "lint",
            hint: "pnpm lint",
            status: "attention",
            pinned: false,
          },
        ],
        hasWorkingChild: false,
        hasAlertChild: true,
        origin: "agent",
      },
    ],
  },
  {
    id: "project-docs",
    name: "docs",
    path: "/Users/akibe/Repos/github.com/akibe/docs",
    pinned: true,
    readOnly: true,
    isRepo: false,
    worktrees: [
      {
        id: "wt:docs-root",
        name: "root",
        path: "/Users/akibe/Repos/github.com/akibe/docs",
        active: true,
        dirty: 0,
        ahead: 0,
        behind: 0,
        children: [],
        hasWorkingChild: false,
        hasAlertChild: false,
      },
    ],
  },
];

const portsByProjectId: Record<string, PortInfo[]> = {
  "project-parasor": [
    { port: 6006, pid: 1300, bindsAll: false, reachable: true },
    { port: 7682, pid: 1301, bindsAll: false, reachable: false },
  ],
};

const projectNames = {
  "project-parasor": "parasor",
  "project-docs": "docs",
};

function SidebarFrame({
  children,
  mobileChrome = false,
}: {
  children: ReactNode;
  mobileChrome?: boolean;
}) {
  return (
    <div
      className="h-screen bg-bg-primary p-0 text-text-primary"
      style={
        mobileChrome
          ? ({ "--spacing-bar": "var(--spacing-tap-touch)" } as CSSProperties)
          : undefined
      }
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Components/Navigation/Workspace sidebar",
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
  render: () => (
    <SidebarFrame>
      <Sidebar
        projects={projects}
        selection={selection}
        connected
        width={288}
        resizable
        onWidthChange={noop}
        onSelectMonitor={noop}
        onSelectWorktree={noop}
        onSelectChild={noop}
        onOpenContainer={noop}
        onToggleChildPin={noop}
        onNewProject={noop}
        onOpenSettings={noop}
        portsByProjectId={portsByProjectId}
        projectNames={projectNames}
        onOpenUrl={noop}
      />
    </SidebarFrame>
  ),
};

export const Filtered: Story = {
  render: function FilteredStory() {
    const [query, setQuery] = useState("story");
    return (
      <SidebarFrame>
        <Sidebar
          projects={projects}
          selection={selection}
          connected
          width={288}
          searchOpen
          searchQuery={query}
          onSearchQueryChange={setQuery}
          onCloseSearch={noop}
          onToggleSearch={noop}
          onSelectWorktree={noop}
          onSelectChild={noop}
          onOpenContainer={noop}
          onNewProject={noop}
          onOpenSettings={noop}
        />
      </SidebarFrame>
    );
  },
};

export const NetworkPorts: Story = {
  render: () => (
    <SidebarFrame>
      <Sidebar
        projects={projects}
        selection={selection}
        connected
        width={288}
        portsByProjectId={portsByProjectId}
        projectNames={projectNames}
        onOpenUrl={noop}
        onNewProject={noop}
        onOpenSettings={noop}
        onToggleSearch={noop}
      />
    </SidebarFrame>
  ),
};

export const Disconnected: Story = {
  render: () => (
    <SidebarFrame>
      <Sidebar
        projects={projects}
        selection={selection}
        connected={false}
        width={288}
        onNewProject={noop}
        onOpenSettings={noop}
        onToggleSearch={noop}
      />
    </SidebarFrame>
  ),
};

export const FillPanel: Story = {
  render: () => (
    <SidebarFrame>
      <div className="h-full w-[390px]">
        <Sidebar
          projects={projects}
          selection={selection}
          connected
          fill
          pinnedMonitorCount={2}
          onSelectMonitor={noop}
          onSelectWorktree={noop}
          onSelectChild={noop}
          onOpenContainer={noop}
          onToggleChildPin={noop}
          onNewProject={noop}
          onOpenSettings={noop}
          onToggleSearch={noop}
        />
      </div>
    </SidebarFrame>
  ),
};

export const Mobile: Story = {
  render: () => (
    <SidebarFrame mobileChrome>
      <div className="h-full w-[390px]">
        <Sidebar
          projects={projects}
          selection={selection}
          connected
          fill
          pinnedMonitorCount={2}
          onSelectMonitor={noop}
          onSelectWorktree={noop}
          onSelectChild={noop}
          onOpenContainer={noop}
          onToggleChildPin={noop}
          onNewProject={noop}
          onOpenSettings={noop}
          onToggleSearch={noop}
        />
      </div>
    </SidebarFrame>
  ),
  globals: MOBILE_VIEWPORT_GLOBALS,
};

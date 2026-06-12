import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import {
  PaButton,
  PaGlyph,
  PaMenu,
  PaneFooter,
  PaneHeader,
  PaneIconButton,
} from "../../components/primitives/index.js";
import type { PaMenuItem } from "../../components/primitives/PaMenu.js";

const noop = () => undefined;

function PaneFrame({
  children,
  width = 360,
}: {
  children: ReactNode;
  width?: number;
}) {
  return (
    <div
      className="flex h-[220px] min-h-0 flex-col overflow-hidden rounded-window border border-border bg-bg-primary text-text-primary"
      style={{ width }}
    >
      {children}
    </div>
  );
}

function PaneBody({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 p-4 text-sm text-text-secondary">
      {children}
    </div>
  );
}

function SyncAction({
  label,
  glyph,
  count,
}: {
  label: string;
  glyph: ReactNode;
  count?: number;
}) {
  return (
    <PaneIconButton
      label={count ? `${label} (${count})` : label}
      className="relative"
    >
      {glyph}
      {count ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-tag bg-accent px-1 text-[11px] leading-none font-bold text-white drop-shadow-sm"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </PaneIconButton>
  );
}

const addMenuItems: PaMenuItem[] = [
  { id: "new-file", label: "New file", onSelect: noop },
  { id: "new-folder", label: "New folder", onSelect: noop },
];

const meta = {
  title: "Workspace/Pane chrome",
  parameters: {
    layout: "centered",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const TerminalHeader: Story = {
  render: function TerminalHeaderStory() {
    const [pinned, setPinned] = useState(true);
    return (
      <PaneFrame width={420}>
        <PaneHeader
          title="codex"
          titleAttr="codex"
          actions={
            <>
              <PaneIconButton
                label={pinned ? "Unpin from Monitor" : "Pin to Monitor"}
                title={
                  pinned
                    ? "Pinned to Monitor - click to unpin"
                    : "Pin to Monitor"
                }
                size="md"
                tone={pinned ? "accent" : "normal"}
                pressed={pinned}
                onClick={() => setPinned((value) => !value)}
              >
                <PaGlyph.pin />
              </PaneIconButton>
              <PaneIconButton
                label="Close pane"
                title="Close pane"
                size="md"
                tone="danger"
                onClick={noop}
              >
                <PaGlyph.close />
              </PaneIconButton>
            </>
          }
        />
        <PaneBody>
          <div className="cm-mono text-xs">npm run dev</div>
        </PaneBody>
      </PaneFrame>
    );
  },
};

export const FilesFooter: Story = {
  render: () => (
    <PaneFrame width={360}>
      <PaneBody>
        <div className="cm-mono text-xs">src/</div>
      </PaneBody>
      <PaneFooter
        status="12 files"
        actions={
          <div className="flex items-center gap-1">
            <PaMenu
              align="end"
              placement="top"
              items={addMenuItems}
              renderTrigger={({ toggle, triggerRef, menuId, open }) => (
                <PaneIconButton
                  ref={triggerRef}
                  label="New file or folder"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-controls={menuId}
                  onClick={toggle}
                >
                  <PaGlyph.add />
                </PaneIconButton>
              )}
            />
            <PaneIconButton label="Refresh" onClick={noop}>
              <PaGlyph.refresh />
            </PaneIconButton>
          </div>
        }
      />
    </PaneFrame>
  ),
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    );
    button?.click();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    const menu = document.querySelector('[role="menu"]');
    if (!menu) throw new Error("Expected file actions menu to open");
  },
};

export const GitGraphFooter: Story = {
  render: function GitGraphFooterStory() {
    const [includeRemotes, setIncludeRemotes] = useState(true);
    return (
      <PaneFrame width={420}>
        <PaneBody>
          <div className="cm-mono text-xs">main origin/main</div>
        </PaneBody>
        <PaneFooter
          status="main ahead 2 / behind 1"
          actions={
            <>
              <SyncAction label="Pull" count={1} glyph={<PaGlyph.pull />} />
              <SyncAction label="Push" count={2} glyph={<PaGlyph.push />} />
              <PaneIconButton
                label={
                  includeRemotes
                    ? "Hide remote branches"
                    : "Show remote branches"
                }
                pressed={includeRemotes}
                tone={includeRemotes ? "active" : "normal"}
                onClick={() => setIncludeRemotes((value) => !value)}
              >
                {includeRemotes ? <PaGlyph.eye /> : <PaGlyph.eyeOff />}
              </PaneIconButton>
              <PaneIconButton label="Refresh" onClick={noop}>
                <PaGlyph.refresh />
              </PaneIconButton>
            </>
          }
        />
      </PaneFrame>
    );
  },
};

export const WorkingTreeCommit: Story = {
  render: () => (
    <PaneFrame width={460}>
      <PaneHeader
        icon={<PaGlyph.diff />}
        iconTone="warning"
        title="Working tree"
      />
      <PaneBody>
        <div className="text-xs">3 changed files</div>
      </PaneBody>
      <PaneFooter
        status="2/3 selected"
        actions={
          <PaButton kind="submit" onClick={noop}>
            Commit
          </PaButton>
        }
      />
    </PaneFrame>
  ),
};

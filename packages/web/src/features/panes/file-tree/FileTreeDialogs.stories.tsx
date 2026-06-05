import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { MOBILE_VIEWPORT_GLOBALS } from "../../../stories/storybook-viewports.js";
import { FileContextMenu } from "./FileContextMenu.js";
import { FileTreeUploadConflictDialog } from "./FileTreeUploadConflictDialog.js";

const noop = () => undefined;
const sampleEntry = {
  name: "README.md",
  path: "docs/README.md",
  type: "file" as const,
};

function TouchEnvironment({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const hadTouchStart = "ontouchstart" in window;
    const previousTouchStart = window.ontouchstart;

    Object.defineProperty(window, "ontouchstart", {
      configurable: true,
      value: null,
    });
    setReady(true);

    return () => {
      if (hadTouchStart) {
        Object.defineProperty(window, "ontouchstart", {
          configurable: true,
          value: previousTouchStart,
        });
      } else {
        delete (window as { ontouchstart?: unknown }).ontouchstart;
      }
    };
  }, []);

  return ready ? children : null;
}

const meta = {
  title: "Patterns/Dialogs/File tree actions",
  parameters: {
    layout: "fullscreen",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const UploadConflict: Story = {
  render: () => (
    <FileTreeUploadConflictDialog
      open
      conflicts={["README.md"]}
      totalCount={1}
      targetLabel="."
      onCancel={noop}
      onResolve={noop}
    />
  ),
};

export const UploadConflictBatch: Story = {
  render: () => (
    <FileTreeUploadConflictDialog
      open
      conflicts={[
        "README.md",
        "src/App.tsx",
        "src/features/panes/file-tree/FileTree.tsx",
      ]}
      totalCount={8}
      targetLabel="src"
      onCancel={noop}
      onResolve={noop}
    />
  ),
};

export const ContextMenuDesktop: Story = {
  render: () => (
    <div className="min-h-screen bg-bg-primary p-6 text-text-primary">
      <FileContextMenu entry={sampleEntry} x={24} y={40} onClose={noop} />
    </div>
  ),
};

export const ContextMenuMobileSheet: Story = {
  render: () => (
    <TouchEnvironment>
      <div className="min-h-screen bg-bg-primary p-6 text-text-primary">
        <FileContextMenu entry={sampleEntry} x={0} y={0} onClose={noop} />
      </div>
    </TouchEnvironment>
  ),
  globals: MOBILE_VIEWPORT_GLOBALS,
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MOBILE_VIEWPORT_GLOBALS } from "../../stories/storybook-viewports.js";
import {
  BottomSheet,
  ConfirmDialog,
  DialogButton,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  PaButton,
} from "./index.js";

const noop = () => undefined;

function PrimitiveFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[360px] w-[620px] overflow-hidden rounded-window border border-border bg-bg-primary text-text-primary">
      {children}
    </div>
  );
}

const meta = {
  title: "Foundations/Primitives/Dialog and sheet",
  parameters: {
    layout: "centered",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const ModalDialog: Story = {
  render: () => (
    <PrimitiveFrame>
      <DialogRoot open ariaLabel="Story dialog" onClose={noop}>
        <DialogHeader
          title="Rename"
          subject="feature/storybook"
          onClose={noop}
        />
        <div className="flex flex-col gap-3 p-4 text-sm text-text-secondary">
          <p>Rename this worktree branch before starting a new session.</p>
          <DialogFooter>
            <DialogButton onClick={noop}>Cancel</DialogButton>
            <DialogButton variant="primary" onClick={noop}>
              Save
            </DialogButton>
            <DialogButton variant="danger" disabled onClick={noop}>
              Disabled danger
            </DialogButton>
          </DialogFooter>
        </div>
      </DialogRoot>
    </PrimitiveFrame>
  ),
};

export const ConfirmDanger: Story = {
  render: () => (
    <PrimitiveFrame>
      <ConfirmDialog
        ariaLabel="Remove worktree"
        confirmLabel="Remove"
        confirmVariant="danger"
        onCancel={noop}
        onConfirm={noop}
      >
        Remove <span className="cm-mono">feature/storybook</span>? Local changes
        in this worktree will be discarded.
      </ConfirmDialog>
    </PrimitiveFrame>
  ),
};

export const BottomSheetOpen: Story = {
  render: function BottomSheetOpenStory() {
    const [open, setOpen] = useState(true);
    return (
      <PrimitiveFrame>
        <div className="p-5">
          <PaButton onClick={() => setOpen(true)}>Open sheet</PaButton>
        </div>
        <BottomSheet
          open={open}
          onDismiss={() => setOpen(false)}
          ariaLabel="Mobile actions"
        >
          <div className="flex flex-col gap-3 px-5 py-4">
            <div className="text-sm font-semibold text-text-primary">
              Upload files
            </div>
            <div className="text-sm text-text-secondary">
              Choose a source for files that should be attached to this session.
            </div>
            <PaButton kind="submit" onClick={() => setOpen(false)}>
              Done
            </PaButton>
          </div>
        </BottomSheet>
      </PrimitiveFrame>
    );
  },
  globals: MOBILE_VIEWPORT_GLOBALS,
  play: async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("Expected bottom sheet dialog to render");
  },
};

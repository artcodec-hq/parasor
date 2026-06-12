import type { Meta, StoryObj } from "@storybook/react-vite";
import { MOBILE_VIEWPORT_GLOBALS } from "../../stories/storybook-viewports.js";
import { MobileKeyBar } from "./MobileKeyBar.js";

const noop = () => undefined;

function MobileFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[360px] w-[390px] flex-col justify-end overflow-hidden rounded-window border border-border bg-bg-primary text-text-primary">
      <div className="flex-1 p-4 cm-mono text-xs text-text-secondary">
        $ pnpm test
      </div>
      {children}
    </div>
  );
}

const meta = {
  title: "Components/Input/Mobile key bars",
  globals: MOBILE_VIEWPORT_GLOBALS,
  parameters: {
    layout: "centered",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const TerminalDefault: Story = {
  render: () => (
    <MobileFrame>
      <MobileKeyBar
        onSend={noop}
        ctrlActive={false}
        onCtrlToggle={noop}
        keyboardOpen={false}
        onKeyboardToggle={noop}
      />
    </MobileFrame>
  ),
};

export const TerminalCtrlAndKeyboardActive: Story = {
  render: () => (
    <MobileFrame>
      <MobileKeyBar
        onSend={noop}
        ctrlActive
        onCtrlToggle={noop}
        keyboardOpen
        onKeyboardToggle={noop}
        onAttachFiles={noop}
      />
    </MobileFrame>
  ),
};

export const TerminalAttachFiles: Story = {
  render: () => (
    <MobileFrame>
      <MobileKeyBar
        onSend={noop}
        ctrlActive={false}
        onCtrlToggle={noop}
        keyboardOpen={false}
        onKeyboardToggle={noop}
        onAttachFiles={noop}
      />
    </MobileFrame>
  ),
};

export const EditorDefault: Story = {
  render: () => (
    <MobileFrame>
      <MobileKeyBar
        onSend={noop}
        ctrlActive={false}
        onCtrlToggle={noop}
        keyboardOpen={false}
        onKeyboardToggle={noop}
      />
    </MobileFrame>
  ),
};

export const EditorKeyboardActive: Story = {
  render: () => (
    <MobileFrame>
      <MobileKeyBar
        onSend={noop}
        ctrlActive={false}
        onCtrlToggle={noop}
        keyboardOpen
        onKeyboardToggle={noop}
      />
    </MobileFrame>
  ),
};

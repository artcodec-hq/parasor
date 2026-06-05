import type { Meta, StoryObj } from "@storybook/react-vite";
import { MOBILE_VIEWPORT_GLOBALS } from "../../stories/storybook-viewports.js";
import { SettingsOverlay } from "./SettingsOverlay.js";
import { SettingsProvider } from "./SettingsProvider.js";

const noop = () => undefined;

function installStoryMatchMedia(matches: boolean) {
  globalThis.matchMedia = (() => ({
    matches,
    media: "(min-width: 768px)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof globalThis.matchMedia;
}

function StoryOverlay({ desktop }: { desktop: boolean }) {
  installStoryMatchMedia(desktop);
  return (
    <SettingsProvider>
      <SettingsOverlay open onClose={noop} />
    </SettingsProvider>
  );
}

const meta = {
  title: "Features/Settings/Overlay",
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
  render: () => <StoryOverlay desktop />,
};

export const Mobile: Story = {
  render: () => <StoryOverlay desktop={false} />,
  globals: MOBILE_VIEWPORT_GLOBALS,
};

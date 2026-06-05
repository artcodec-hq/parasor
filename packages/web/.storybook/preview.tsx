import type { Preview } from "@storybook/react-vite";
import { MINIMAL_VIEWPORTS } from "storybook/viewport";
import "../src/app.css";

const preview: Preview = {
  decorators: [
    (Story) => (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--theme-editor-bg)",
          color: "var(--theme-editor-fg)",
        }}
      >
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      options: MINIMAL_VIEWPORTS,
    },
  },
  initialGlobals: {
    viewport: { value: "desktop", isRotated: false },
  },
};

export default preview;

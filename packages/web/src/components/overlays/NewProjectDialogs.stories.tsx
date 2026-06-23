import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { MOBILE_VIEWPORT_GLOBALS } from "../../stories/storybook-viewports.js";
import { NewProjectDialog } from "./NewProjectDialog.js";

const noop = () => undefined;

let restoreStoryFetch: (() => void) | null = null;

function installStoryFetchMock() {
  if (restoreStoryFetch) return;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("/api/fs/browse")) {
      return new Response(
        JSON.stringify({
          path: "/Users/akibe/Repos/github.com",
          parent: "/Users/akibe/Repos",
          entries: [
            {
              name: "parasor",
              path: "/Users/akibe/Repos/github.com/akibe/parasor",
              type: "directory",
            },
            {
              name: "parasor-labs",
              path: "/Users/akibe/Repos/github.com/akibe/parasor-labs",
              type: "directory",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("Not found", { status: 404 });
  };
  restoreStoryFetch = () => {
    globalThis.fetch = originalFetch;
    restoreStoryFetch = null;
  };
}

function NewProjectDialogStory({ isMobile = false }: { isMobile?: boolean }) {
  installStoryFetchMock();

  useEffect(() => {
    return () => restoreStoryFetch?.();
  }, []);

  return (
    <NewProjectDialog open isMobile={isMobile} onClose={noop} onCreate={noop} />
  );
}

const meta = {
  title: "Patterns/Dialogs/Project setup",
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
  render: () => <NewProjectDialogStory />,
};

export const Mobile: Story = {
  render: () => <NewProjectDialogStory isMobile />,
  globals: MOBILE_VIEWPORT_GLOBALS,
};

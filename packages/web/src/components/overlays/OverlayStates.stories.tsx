import type { SessionCommand, SessionEndReason } from "@parasor/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MissingSessionRouteState } from "./MissingSessionRouteState.js";
import { ReconnectingOverlay } from "./ReconnectingOverlay.js";
import { SessionErrorState } from "./SessionErrorState.js";

const noop = () => undefined;

function PaneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-[360px] w-[620px] overflow-hidden rounded-window border border-border bg-bg-primary text-text-primary">
      {children}
    </div>
  );
}

const meta = {
  title: "Patterns/Overlays/Session states",
  parameters: {
    layout: "centered",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const SessionEndedExit: Story = {
  render: () => {
    const command: SessionCommand = {
      type: "custom",
      command: "pnpm",
      args: ["build"],
    };
    const endReason: SessionEndReason = { type: "exit", code: 1 };
    return (
      <PaneFrame>
        <SessionErrorState
          sessionTitle="build"
          command={command}
          endReason={endReason}
          onRestart={noop}
          onClose={noop}
        />
      </PaneFrame>
    );
  },
};

export const SessionDisconnected: Story = {
  render: () => (
    <PaneFrame>
      <SessionErrorState
        sessionTitle="codex"
        command={{ type: "custom", command: "codex", args: [] }}
        endReason={undefined}
        socketDisconnectedReason="Session unavailable"
        onClose={noop}
      />
    </PaneFrame>
  ),
};

export const MissingSessionLoading: Story = {
  render: () => (
    <PaneFrame>
      <MissingSessionRouteState
        sessionId="session_01HX_storybook"
        hydrated={false}
        connected
        onClose={noop}
      />
    </PaneFrame>
  ),
};

export const MissingSessionHydrated: Story = {
  render: () => (
    <PaneFrame>
      <MissingSessionRouteState
        sessionId="session_01HX_storybook"
        hydrated
        connected={false}
        onClose={noop}
      />
    </PaneFrame>
  ),
};

export const ReconnectingVisible: Story = {
  render: () => (
    <PaneFrame>
      <div className="h-full p-4 cm-mono text-xs text-text-secondary">
        $ pnpm build
      </div>
      <ReconnectingOverlay showDelayMs={0} />
    </PaneFrame>
  ),
  play: async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (!document.body.textContent?.includes("Reconnecting")) {
      throw new Error("Expected reconnecting overlay to become visible");
    }
  },
};

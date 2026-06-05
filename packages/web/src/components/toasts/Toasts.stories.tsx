import type { ServerNoticesResponse } from "@parasor/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { showCopyToast } from "../../lib/copy-toast.js";
import { dismissSyncToast, showSyncToast } from "../../lib/sync-toast.js";
import { CopyToast } from "./CopyToast.js";
import { ServerNoticesBanner } from "./ServerNoticesBanner.js";
import { SyncToastSet } from "./SyncToastSet.js";

function ToastSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[280px] overflow-hidden rounded-window border border-border bg-bg-primary text-text-primary">
      {children}
    </div>
  );
}

function MockNoticesFetch({
  body,
  children,
}: {
  body: ServerNoticesResponse;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith("/api/notices")) {
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        return Response.json(body);
      }
      return originalFetch(input, init);
    };
    return () => {
      globalThis.fetch = originalFetch;
    };
  }, [body]);

  return children;
}

const meta = {
  title: "Components/Feedback/Toasts",
  parameters: {
    layout: "centered",
    controls: {
      disable: true,
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const ServerNoticeVisible: Story = {
  render: () => (
    <ToastSurface>
      <MockNoticesFetch
        body={{
          notices: [
            {
              kind: "daemon-auto-restarted",
              occurredAt: "2026-06-01T01:45:00.000Z",
            },
          ],
        }}
      >
        <ServerNoticesBanner />
      </MockNoticesFetch>
    </ToastSurface>
  ),
};

export const ServerNoticeEmpty: Story = {
  render: () => (
    <ToastSurface>
      <MockNoticesFetch body={{ notices: [] }}>
        <ServerNoticesBanner />
      </MockNoticesFetch>
      <div className="p-4 text-sm text-text-secondary">No server notices</div>
    </ToastSurface>
  ),
};

export const CopyToastVisible: Story = {
  render: function CopyToastVisibleStory() {
    useEffect(() => {
      showCopyToast("Copied branch name", 60_000);
    }, []);
    return (
      <ToastSurface>
        <CopyToast />
      </ToastSurface>
    );
  },
  play: async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (!document.body.textContent?.includes("Copied branch name")) {
      throw new Error("Expected copy toast");
    }
  },
};

export const SyncToasts: Story = {
  render: function SyncToastsStory() {
    useEffect(() => {
      showSyncToast({
        id: "story-working",
        tone: "working",
        title: "Pulling",
        sub: "origin/main",
        mono: true,
      });
      showSyncToast({
        id: "story-ok",
        tone: "ok",
        title: "Push complete",
        sub: "feature/storybook",
        mono: true,
      });
      showSyncToast({
        id: "story-err",
        tone: "err",
        title: "Merge failed",
        sub: "Resolve conflicts before retrying.",
      });
      return () => {
        dismissSyncToast("story-working");
        dismissSyncToast("story-ok");
        dismissSyncToast("story-err");
      };
    }, []);
    return (
      <ToastSurface>
        <SyncToastSet />
      </ToastSurface>
    );
  },
};

export const SyncToastActions: Story = {
  render: function SyncToastActionsStory() {
    useEffect(() => {
      showSyncToast({
        id: "story-actions",
        tone: "err",
        title: "Push failed",
        sub: "origin/feature/storybook rejected the update.",
        actions: [
          { label: "Open diff", kind: "primary", onSelect: () => undefined },
          { label: "Dismiss", onSelect: () => undefined },
        ],
      });
      return () => dismissSyncToast("story-actions");
    }, []);
    return (
      <ToastSurface>
        <SyncToastSet />
      </ToastSurface>
    );
  },
};

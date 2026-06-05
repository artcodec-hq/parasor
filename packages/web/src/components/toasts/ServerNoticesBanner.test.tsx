import type { ServerNotice } from "@parasor/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerNoticesBanner } from "./ServerNoticesBanner.js";

interface FetchCall {
  url: string;
  method: string;
}

function installFetchStub(
  initialNotices: ServerNotice[],
  options: { failGet?: boolean; failDelete?: boolean } = {},
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      if (method === "GET" && url === "/api/notices") {
        if (options.failGet) {
          return new Response("nope", { status: 500 });
        }
        return Response.json({ notices: initialNotices });
      }
      if (method === "DELETE" && url.startsWith("/api/notices/")) {
        if (options.failDelete) throw new Error("network");
        return Response.json({ dismissed: true });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return { calls };
}

describe("ServerNoticesBanner", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing when the server reports no notices", async () => {
    installFetchStub([]);
    const { container } = render(<ServerNoticesBanner />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders nothing when the notices fetch fails", async () => {
    installFetchStub([], { failGet: true });
    const { container } = render(<ServerNoticesBanner />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders the daemon-auto-restarted banner with Japanese explanation", async () => {
    installFetchStub([
      {
        kind: "daemon-auto-restarted",
        occurredAt: new Date().toISOString(),
        serverProtocolVersion: "1.1.0",
        daemonProtocolVersion: "1.0.0",
      },
    ]);
    render(<ServerNoticesBanner />);
    const row = await screen.findByRole("status");
    expect(row.textContent).toContain("セッションがリセットされました");
    expect(row.textContent).toContain(
      "parasor が新しいバージョンに更新されたため",
    );
  });

  it("dismisses the banner locally and DELETEs the notice on the server", async () => {
    const { calls } = installFetchStub([
      {
        kind: "daemon-auto-restarted",
        occurredAt: new Date().toISOString(),
      },
    ]);
    const { container } = render(<ServerNoticesBanner />);
    const dismiss = await screen.findByRole("button", { name: /dismiss/i });
    fireEvent.click(dismiss);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.method === "DELETE" &&
            c.url === "/api/notices/daemon-auto-restarted",
        ),
      ).toBe(true);
    });
  });

  it("keeps the banner removed even when the DELETE request fails", async () => {
    installFetchStub(
      [
        {
          kind: "daemon-auto-restarted",
          occurredAt: new Date().toISOString(),
        },
      ],
      { failDelete: true },
    );
    const { container } = render(<ServerNoticesBanner />);
    const dismiss = await screen.findByRole("button", { name: /dismiss/i });
    fireEvent.click(dismiss);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });
});
